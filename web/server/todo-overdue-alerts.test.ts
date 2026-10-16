import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TodoItem } from "../shared/todo-types.js";
import { isQuietHour, TODOS_PAGE_PATH, type OverdueTodo } from "./needs-input-reminders.js";
import { overdueTodosIn, TodoOverdueAlerts } from "./todo-overdue-alerts.js";

/**
 * One phone alert per to-do when it passes its due date: batched, held through quiet
 * hours, never repeated (also across a restart, through the alert record file), and
 * sent again only for a new due date. Time is an injected clock and delivery a mock,
 * so nothing is sent anywhere; the record file lives in a temporary directory.
 */

const MINUTE = 60_000;

/** Local time on Oct 14, 2026 (quiet hours are local). */
function at(hour: number, minute = 0, day = 14): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "todo-overdue-alerts-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(start: number) {
  let now = start;
  let overdue: OverdueTodo[] = [];
  let enabled = true;
  const send = vi.fn();
  const create = () =>
    new TodoOverdueAlerts({
      listOverdueTodos: async () => overdue,
      isQuietHour: (time) => isQuietHour(time, { quietStartHour: 23, quietEndHour: 9 }),
      isEnabled: () => enabled,
      send,
      filePath: join(dir, "overdue-alerts.json"),
      now: () => now,
    });
  return {
    alerts: create(),
    /** A new instance on the same record file, as after a server restart. */
    restart: create,
    send,
    setNow: (value: number) => (now = value),
    setOverdue: (value: OverdueTodo[]) => (overdue = value),
    setEnabled: (value: boolean) => (enabled = value),
  };
}

const todo = (id: string, due: string, title = id): OverdueTodo => ({ id, due, title });

describe("TodoOverdueAlerts", () => {
  it("alerts once for to-dos that became overdue, batching them, and opens the To-dos page", async () => {
    const t = setup(at(14));
    t.setOverdue([todo("td-1", "2026-10-14T14:00", "Confirm the plan")]);
    expect(await t.alerts.check()).toBe(true);
    expect(t.send).toHaveBeenLastCalledWith({
      title: "To-do overdue",
      body: "Confirm the plan",
      path: TODOS_PAGE_PATH,
    });

    // Still overdue a minute later: no second alert.
    t.setNow(at(14, 1));
    expect(await t.alerts.check()).toBe(false);

    // Two more pass their due dates together: one alert names both, not the one already alerted.
    t.setNow(at(16));
    t.setOverdue([
      todo("td-1", "2026-10-14T14:00", "Confirm the plan"),
      todo("td-2", "2026-10-14T16:00", "Decide on context"),
      todo("td-3", "2026-10-14T16:00", "Check the PR"),
    ]);
    expect(await t.alerts.check()).toBe(true);
    expect(t.send).toHaveBeenLastCalledWith({
      title: "2 to-dos overdue",
      body: "Decide on context, Check the PR",
      path: TODOS_PAGE_PATH,
    });
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("holds an alert that falls in quiet hours until they end, also across a restart", async () => {
    // A date-only to-do for Oct 14 turns overdue at midnight, inside 11 PM-9 AM quiet hours.
    const t = setup(at(0, 0, 15));
    t.setOverdue([todo("td-1", "2026-10-14")]);
    expect(await t.alerts.check()).toBe(false);

    // The server restarts at 3 AM; the held alert still goes out when quiet hours end.
    const restarted = t.restart();
    t.setNow(at(3, 0, 15));
    expect(await restarted.check()).toBe(false);
    t.setNow(at(9, 0, 15));
    expect(await restarted.check()).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("does not repeat an alert after a restart", async () => {
    const t = setup(at(14));
    t.setOverdue([todo("td-1", "2026-10-14T14:00")]);
    expect(await t.alerts.check()).toBe(true);
    const restarted = t.restart();
    t.setNow(at(14, 5));
    expect(await restarted.check()).toBe(false);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("alerts again for a new due date, and forgets to-dos that are no longer overdue", async () => {
    const t = setup(at(14));
    t.setOverdue([todo("td-1", "2026-10-14T14:00"), todo("td-2", "2026-10-14T14:00")]);
    expect(await t.alerts.check()).toBe(true);

    // td-1 was moved to 3 PM and td-2 was finished: the record keeps neither.
    t.setNow(at(14, 30));
    t.setOverdue([]);
    expect(await t.alerts.check()).toBe(false);
    const record = JSON.parse(await readFile(join(dir, "overdue-alerts.json"), "utf-8"));
    expect(record).toEqual({ alerted: {} });

    // td-1 passes its new due date: a fresh alert.
    t.setNow(at(15));
    t.setOverdue([todo("td-1", "2026-10-14T15:00")]);
    expect(await t.alerts.check()).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(2);
  });

  it("lists only overdue to-dos that already had their alert, for the follow-up reminders", async () => {
    const t = setup(at(2));
    t.setOverdue([todo("td-1", "2026-10-13")]);
    // Held for quiet hours: not alerted yet, so not something to remind about either.
    await t.alerts.check();
    expect(await t.alerts.listAlerted()).toEqual([]);
    t.setNow(at(9));
    await t.alerts.check();
    expect(await t.alerts.listAlerted()).toEqual([todo("td-1", "2026-10-13")]);
  });

  it("sends nothing while switched off, and sends no backlog when switched back on", async () => {
    const t = setup(at(14));
    t.setEnabled(false);
    t.setOverdue([todo("td-1", "2026-10-14T14:00")]);
    expect(await t.alerts.check()).toBe(false);
    // Still counted as alerted, so the follow-up reminders include it.
    expect(await t.alerts.listAlerted()).toEqual([todo("td-1", "2026-10-14T14:00")]);

    t.setEnabled(true);
    t.setNow(at(15));
    expect(await t.alerts.check()).toBe(false);
    t.setOverdue([todo("td-1", "2026-10-14T14:00"), todo("td-2", "2026-10-14T15:00")]);
    expect(await t.alerts.check()).toBe(true);
    expect(t.send).toHaveBeenCalledTimes(1);
    expect(t.send).toHaveBeenLastCalledWith(expect.objectContaining({ title: "To-do overdue", body: "td-2" }));
  });

  it("does not repeat the first alert after a start when the follow-up reminders read the record too", async () => {
    // Both minute timers start together, so the first check and the reminders' listAlerted read the
    // record at the same moment. Regression: the second read replaced the record the check had just
    // added to, and the next minute's check sent the same alert again.
    const t = setup(at(14));
    t.setOverdue([todo("td-1", "2026-10-14T14:00"), todo("td-2", "2026-10-14T14:00")]);
    await Promise.all([t.alerts.check(), t.alerts.listAlerted()]);
    expect(t.send).toHaveBeenCalledTimes(1);

    t.setNow(at(14, 1));
    expect(await t.alerts.check()).toBe(false);
    expect(t.send).toHaveBeenCalledTimes(1);
  });

  it("starts over from an unreadable record instead of never alerting", async () => {
    await writeFile(join(dir, "overdue-alerts.json"), "{ not json", "utf-8");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const t = setup(at(14));
      t.setOverdue([todo("td-1", "2026-10-14T14:00")]);
      expect(await t.alerts.check()).toBe(true);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe("overdueTodosIn", () => {
  const item = (id: string, patch: Partial<TodoItem>): TodoItem =>
    ({ id, markdown: id, status: "todo", ...patch }) as TodoItem;

  it("keeps current to-dos past their due date, with plain-text titles", () => {
    const now = at(14, 30);
    const items = [
      item("td-1", { due: "2026-10-14T14:00", markdown: "Read [the report](https://example.com) `now`\nDetails" }),
      item("td-2", { due: "2026-10-14" }), // due today: overdue only from tomorrow
      item("td-3", { due: "2026-10-13", status: "done" }),
      item("td-4", { due: "2026-10-13", archivedAt: 1 }),
      item("td-5", {}),
      item("td-6", { due: "2026-10-13", status: "doing", markdown: "**Ship** it" }),
    ];
    expect(overdueTodosIn(items, now)).toEqual([
      { id: "td-1", due: "2026-10-14T14:00", title: "Read the report now" },
      { id: "td-6", due: "2026-10-13", title: "Ship it" },
    ]);
  });
});

describe("TodoOverdueAlerts timer", () => {
  it("checks once a minute after start and stops on destroy", async () => {
    vi.useFakeTimers();
    try {
      const t = setup(at(9));
      const check = vi.spyOn(t.alerts, "check");
      t.alerts.start();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(check).toHaveBeenCalledTimes(3);
      t.alerts.destroy();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
