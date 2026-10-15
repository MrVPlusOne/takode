/**
 * Follow-up phone reminders for questions and overdue to-dos the user has left waiting.
 *
 * Each needs-input question already gets one phone alert when it is asked, and each
 * overdue to-do one when it passes its due date. If the user then stays away from
 * Takode, this sends one summary of everything still waiting after a stretch of
 * inactivity, repeating with doubling gaps, capped per local day and held back
 * during quiet hours. Any user activity starts the cycle over.
 *
 * Activity means something the user did: a message or answer in any session
 * (known to the server), or a tap or key press in a Takode window (reported by
 * the browser). An open Takode screen that nobody touches is not activity.
 */

import type { NeedsInputReminderSettings } from "../shared/needs-input-reminder-settings.js";

/** One open, unmuted question addressed to the user. */
export interface WaitingQuestion {
  /** Stable per question, such as `<sessionId>:<notificationId>`. */
  key: string;
  /** When it was asked. */
  askedAt: number;
}

/** A current to-do past its due date (see `todo-overdue-alerts.ts`). */
export interface OverdueTodo {
  id: string;
  /** Its due date, in the to-do store's format. */
  due: string;
  /** Plain-text title for alerts. */
  title: string;
}

export interface ReminderAlert {
  title: string;
  body: string;
  /** App path the alert opens. */
  path: string;
}

export interface NeedsInputRemindersDeps<Q extends WaitingQuestion> {
  getSettings: () => NeedsInputReminderSettings;
  getWaitingQuestions: () => Q[];
  /** Overdue to-dos that already had their own alert. */
  getOverdueTodos: () => Promise<OverdueTodo[]>;
  /** The user's latest message or answer in any session. */
  getLastUserMessageAt: () => number;
  /** Short name for the summary, such as the quest title; resolved only when a reminder is sent. */
  describe: (question: Q) => Promise<string>;
  send: (alert: ReminderAlert) => void;
  now?: () => number;
}

/** Opens the top bar's attention list (see `ATTENTION_LIST_HASH` in the frontend routing). */
export const ATTENTION_LIST_PATH = "/#/attention";
/** Opens the To-dos & Timers page. */
export const TODOS_PAGE_PATH = "/#/scheduled";

const CHECK_INTERVAL_MS = 60_000;
const MAX_NAMES = 5;

export class NeedsInputReminders<Q extends WaitingQuestion = WaitingQuestion> {
  private readonly deps: NeedsInputRemindersDeps<Q>;
  private readonly now: () => number;
  private lastBrowserActivityAt = 0;
  /**
   * When this server first saw each waiting question. A question that comes
   * back from a snooze or mute counts as new (it gets a fresh alert), and after
   * a restart every question does, which also keeps restarts from sending one.
   */
  private firstSeenAt = new Map<string, number>();
  /** The reminders sent since the user's last activity. */
  private cycle = { activityAt: 0, sent: 0, lastSentAt: 0 };
  private day = { key: "", sent: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: NeedsInputRemindersDeps<Q>) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** A tap or key press in a Takode window. */
  recordUserActivity(at = this.now()): void {
    this.lastBrowserActivityAt = Math.max(this.lastBrowserActivityAt, at);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Send a reminder if one is due now. Returns whether one was sent. */
  async check(): Promise<boolean> {
    const settings = this.deps.getSettings();
    if (!settings.enabled) return false;
    const now = this.now();
    const questions = this.deps.getWaitingQuestions();
    const todos = await this.deps.getOverdueTodos();
    const keys = [...questions.map((q) => q.key), ...todos.map((todo) => `todo:${todo.id}:${todo.due}`)];
    this.trackFirstSeen(keys, now);

    const activityAt = Math.max(this.lastBrowserActivityAt, this.deps.getLastUserMessageAt());
    if (keys.length === 0 || activityAt > this.cycle.activityAt) {
      this.cycle = { activityAt, sent: 0, lastSentAt: 0 };
    }
    if (keys.length === 0) return false;

    // The first reminder also waits out the newest item, which just had its own alert.
    const inactivityMs = settings.inactivityMinutes * 60_000;
    const dueAt =
      this.cycle.sent === 0
        ? Math.max(activityAt, ...keys.map((key) => this.firstSeenAt.get(key) ?? now)) + inactivityMs
        : this.cycle.lastSentAt + inactivityMs * 2 ** this.cycle.sent;
    if (now < dueAt || isQuietHour(now, settings)) return false;

    const dayKey = new Date(now).toDateString();
    if (this.day.key !== dayKey) this.day = { key: dayKey, sent: 0 };
    if (this.day.sent >= settings.dailyMax) return false;

    // Count it before the names resolve, so a slow lookup cannot let a second check send it again.
    this.cycle.sent++;
    this.cycle.lastSentAt = now;
    this.day.sent++;
    this.deps.send(await this.buildAlert(questions, todos, now));
    return true;
  }

  private trackFirstSeen(keys: string[], now: number): void {
    const waiting = new Set(keys);
    for (const key of this.firstSeenAt.keys()) {
      if (!waiting.has(key)) this.firstSeenAt.delete(key);
    }
    for (const key of waiting) {
      if (!this.firstSeenAt.has(key)) this.firstSeenAt.set(key, now);
    }
  }

  /**
   * "3 questions waiting for you (oldest 5h)", naming them oldest first, and the overdue to-dos:
   * "2 questions waiting for you (oldest 3h), 1 overdue to-do". It opens the attention list, or the
   * To-dos page when only to-dos are waiting.
   */
  private async buildAlert(questions: Q[], todos: OverdueTodo[], now: number): Promise<ReminderAlert> {
    const todoTitles = todos.map((todo) => todo.title);
    const overdue = todos.length ? `${todos.length} overdue ${todos.length === 1 ? "to-do" : "to-dos"}` : "";
    if (questions.length === 0) return { title: overdue, body: nameList(todoTitles), path: TODOS_PAGE_PATH };

    const oldestFirst = [...questions].sort((a, b) => a.askedAt - b.askedAt);
    const names = [...new Set(await Promise.all(oldestFirst.map((q) => this.deps.describe(q))))];
    const count = questions.length;
    const waiting = `${count} ${count === 1 ? "question" : "questions"} waiting for you (oldest ${formatAge(now - oldestFirst[0]!.askedAt)})`;
    return {
      title: overdue ? `${waiting}, ${overdue}` : waiting,
      body: overdue ? `${nameList(names)}. Overdue: ${nameList(todoTitles)}` : nameList(names),
      path: ATTENTION_LIST_PATH,
    };
  }
}

/** Up to five names, then how many more. */
export function nameList(names: string[]): string {
  const shown = names.slice(0, MAX_NAMES).join(", ");
  return names.length > MAX_NAMES ? `${shown}, and ${names.length - MAX_NAMES} more` : shown;
}

/** Whether `at` falls in quiet hours, which may wrap past midnight (23 to 9). */
export function isQuietHour(at: number, settings: Pick<NeedsInputReminderSettings, "quietStartHour" | "quietEndHour">) {
  const hour = new Date(at).getHours();
  const { quietStartHour: start, quietEndHour: end } = settings;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function formatAge(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
