/**
 * One phone alert when a personal to-do becomes overdue.
 *
 * Checked once a minute. Every current Todo or Doing item past its due date that
 * has not been alerted for that due date is sent in one alert, which opens the
 * To-dos page. An alert that falls in the follow-up reminders' quiet hours waits
 * until they end, so date-only to-dos (overdue from midnight) do not wake the
 * user. Which items were alerted is kept in a small file, so a server restart
 * neither repeats alerts nor drops ones held for quiet hours; changing a to-do's
 * due date lets it alert again when the new one passes.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isTodoOverdue } from "../shared/todo-due.js";
import { deriveTodoMarkdown } from "../shared/todo-markdown.js";
import type { TodoItem } from "../shared/todo-types.js";
import { nameList, TODOS_PAGE_PATH, type OverdueTodo, type ReminderAlert } from "./needs-input-reminders.js";

export interface TodoOverdueAlertsDeps {
  listOverdueTodos: () => Promise<OverdueTodo[]>;
  isQuietHour: (at: number) => boolean;
  /** The Overdue to-dos switch in Phone Alert Rules. */
  isEnabled: () => boolean;
  send: (alert: ReminderAlert) => void;
  /** Where alerted due dates are kept; defaults to `~/.companion/todos/overdue-alerts.json`. */
  filePath?: string;
  now?: () => number;
}

const CHECK_INTERVAL_MS = 60_000;
const DEFAULT_FILE = join(homedir(), ".companion", "todos", "overdue-alerts.json");

export class TodoOverdueAlerts {
  private readonly deps: TodoOverdueAlertsDeps;
  private readonly filePath: string;
  private readonly now: () => number;
  /**
   * The due date each overdue to-do was alerted for, by to-do ID; `null` until first read. One shared
   * read: the follow-up reminders ask on the same tick as the first check, and a second read would
   * replace the record that check just added to, repeating its alert a minute later.
   */
  private alerted: Promise<Map<string, string>> | null = null;
  private checking = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: TodoOverdueAlertsDeps) {
    this.deps = deps;
    this.filePath = deps.filePath ?? DEFAULT_FILE;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.check().catch((error) => console.error("[todo-overdue-alerts] Check failed:", error));
    }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Send an alert for to-dos that became overdue since the last one. Returns whether one was sent. */
  async check(): Promise<boolean> {
    if (this.checking) return false;
    this.checking = true;
    try {
      const alerted = await this.loadAlerted();
      const overdue = await this.deps.listOverdueTodos();
      // Forget to-dos no longer overdue (done, archived, re-dated), so a new due date alerts again.
      let changed = false;
      for (const [id, due] of alerted) {
        if (!overdue.some((todo) => todo.id === id && todo.due === due)) {
          alerted.delete(id);
          changed = true;
        }
      }
      const fresh = overdue.filter((todo) => alerted.get(todo.id) !== todo.due);
      // With alerts off, fresh to-dos count as alerted: turning them back on does not send a backlog,
      // and the follow-up reminders still include them.
      const enabled = this.deps.isEnabled();
      const settle = fresh.length > 0 && (!enabled || !this.deps.isQuietHour(this.now()));
      if (settle) {
        for (const todo of fresh) alerted.set(todo.id, todo.due);
        if (enabled) this.deps.send(overdueAlert(fresh));
      }
      if (settle || changed) await this.saveAlerted(alerted);
      return settle && enabled;
    } finally {
      this.checking = false;
    }
  }

  /** Overdue to-dos that already had their alert, for the follow-up reminders. */
  async listAlerted(): Promise<OverdueTodo[]> {
    const alerted = await this.loadAlerted();
    return (await this.deps.listOverdueTodos()).filter((todo) => alerted.get(todo.id) === todo.due);
  }

  private loadAlerted(): Promise<Map<string, string>> {
    this.alerted ??= this.readAlerted();
    return this.alerted;
  }

  private async readAlerted(): Promise<Map<string, string>> {
    try {
      const raw = JSON.parse(await readFile(this.filePath, "utf-8")) as { alerted?: Record<string, unknown> };
      const entries = Object.entries(raw.alerted ?? {}).filter((entry): entry is [string, string] => {
        return typeof entry[1] === "string";
      });
      return new Map(entries);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        // Starting over can repeat an alert once; refusing to alert at all would be worse.
        console.error("[todo-overdue-alerts] Unreadable alert record, starting over:", error);
      }
      return new Map();
    }
  }

  private async saveAlerted(alerted: Map<string, string>): Promise<void> {
    const tempPath = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(tempPath, JSON.stringify({ alerted: Object.fromEntries(alerted) }, null, 2), "utf-8");
    await rename(tempPath, this.filePath);
  }
}

/** The overdue to-dos among `items`, with plain-text titles. */
export function overdueTodosIn(items: TodoItem[], now: number): OverdueTodo[] {
  return items
    .filter((item) => isTodoOverdue(item, now))
    .map((item) => ({
      id: item.id,
      due: item.due!,
      title: deriveTodoMarkdown(item.markdown)
        .titleMarkdown.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/[`*~]/g, ""),
    }));
}

/** "To-do overdue" with its title, or "3 to-dos overdue" naming them. */
function overdueAlert(todos: OverdueTodo[]): ReminderAlert {
  return {
    title: todos.length === 1 ? "To-do overdue" : `${todos.length} to-dos overdue`,
    body: nameList(todos.map((todo) => todo.title)),
    path: TODOS_PAGE_PATH,
  };
}
