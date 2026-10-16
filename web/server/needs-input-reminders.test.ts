import { describe, expect, it, vi } from "vitest";
import { DEFAULT_NEEDS_INPUT_REMINDER_SETTINGS } from "../shared/needs-input-reminder-settings.js";
import {
  ATTENTION_LIST_PATH,
  NeedsInputReminders,
  TODOS_PAGE_PATH,
  isQuietHour,
  type OverdueTodo,
  type WaitingQuestion,
} from "./needs-input-reminders.js";

/**
 * Follow-up reminder rules: first reminder after the inactivity time, doubling gaps,
 * a daily cap, quiet hours that hold a due reminder until they end, and any user
 * activity restarting the cycle. Time is driven through the injected clock and
 * `check()`, so nothing is sent anywhere.
 */

const MINUTE = 60_000;

/** Local time on Oct 14, 2026 (quiet hours are local). */
function at(hour: number, minute = 0, day = 14): number {
  return new Date(2026, 9, day, hour, minute).getTime();
}

interface Question extends WaitingQuestion {
  name: string;
}

function setup(options: { start: number; questions?: Question[]; lastMessageAt?: number }) {
  let now = options.start;
  let questions: Question[] = options.questions ?? [];
  let todos: OverdueTodo[] = [];
  let lastMessageAt = options.lastMessageAt ?? 0;
  let settings = { ...DEFAULT_NEEDS_INPUT_REMINDER_SETTINGS };
  const send = vi.fn();
  const reminders = new NeedsInputReminders<Question>({
    getSettings: () => settings,
    getWaitingQuestions: () => questions,
    getOverdueTodos: async () => todos,
    getLastUserMessageAt: () => lastMessageAt,
    describe: async (q) => q.name,
    send,
    now: () => now,
  });
  return {
    reminders,
    send,
    setNow: (value: number) => (now = value),
    setQuestions: (value: Question[]) => (questions = value),
    setTodos: (value: OverdueTodo[]) => (todos = value),
    setLastMessageAt: (value: number) => (lastMessageAt = value),
    setSettings: (patch: Partial<typeof settings>) => (settings = { ...settings, ...patch }),
    /** Run the per-minute check from now until `end`, returning the times a reminder was sent. */
    async runUntil(end: number): Promise<number[]> {
      const sentAt: number[] = [];
      for (; now <= end; now += MINUTE) {
        if (await reminders.check()) sentAt.push(now);
      }
      now = end;
      return sentAt;
    },
  };
}

const question = (key: string, askedAt: number, name = key): Question => ({ key, askedAt, name });

describe("NeedsInputReminders", () => {
  it("reminds after 2 hours of inactivity, then waits 4 and 8 hours, holding one due overnight until 9 AM", async () => {
    // Question asked at noon, when the user was last active.
    const t = setup({ start: at(12), questions: [question("s1:n-1", at(12))], lastMessageAt: at(12) });
    // 2 PM (2h), 6 PM (+4h), then +8h is 2 AM, in quiet hours, so 9 AM.
    expect(await t.runUntil(at(12, 0, 15))).toEqual([at(14), at(18), at(9, 0, 15)]);
  });

  it("holds a reminder that comes due in quiet hours until they end", async () => {
    // Active until 10 PM: the first reminder would be due at midnight, inside 11 PM-9 AM quiet hours.
    const t = setup({ start: at(22), questions: [question("s1:n-1", at(21))], lastMessageAt: at(22) });
    const sent = await t.runUntil(at(9, 30, 15));
    expect(sent).toEqual([at(9, 0, 15)]);
  });

  it("sends at most the daily limit per local day", async () => {
    const t = setup({ start: at(9), questions: [question("s1:n-1", at(9))], lastMessageAt: at(9) });
    t.setSettings({ inactivityMinutes: 30, quietStartHour: 0, quietEndHour: 0, dailyMax: 2 });
    // 9:30 and 10:30 (gap 1h); the next (12:30, gap 2h) is over the limit of 2 for Oct 14.
    expect(await t.runUntil(at(23, 59))).toEqual([at(9, 30), at(10, 30)]);
    // A new day lifts the cap: the overdue reminder goes out at midnight.
    expect(await t.runUntil(at(0, 1, 15))).toEqual([at(0, 0, 15)]);
  });

  it("starts the cycle over on any activity, from a message or from the browser", async () => {
    const t = setup({ start: at(9), questions: [question("s1:n-1", at(9))], lastMessageAt: at(9) });
    expect(await t.runUntil(at(11))).toEqual([at(11)]);

    // A tap in Takode at 12: the next reminder is 2h later, not 4h after the last one.
    t.reminders.recordUserActivity(at(12));
    expect(await t.runUntil(at(14, 30))).toEqual([at(14)]);

    // A message at 15:00 restarts it again.
    t.setLastMessageAt(at(15));
    expect(await t.runUntil(at(17))).toEqual([at(17)]);
  });

  it("waits the inactivity time after a newly waiting question, which had its own alert", async () => {
    // The user has been away since 6 AM; a new question appears at 9 AM.
    const t = setup({ start: at(9), lastMessageAt: at(6) });
    t.setQuestions([question("s1:n-1", at(9))]);
    expect(await t.runUntil(at(11, 30))).toEqual([at(11)]);
  });

  it("sends nothing with no waiting question and starts fresh when one waits again", async () => {
    const t = setup({ start: at(9), questions: [question("s1:n-1", at(9))], lastMessageAt: at(9) });
    expect(await t.runUntil(at(11))).toEqual([at(11)]);
    t.setQuestions([]);
    expect(await t.runUntil(at(13))).toEqual([]);
    // A later question gets a first reminder 2h after it appears, not the doubled 4h gap.
    t.setQuestions([question("s2:n-1", at(13))]);
    expect(await t.runUntil(at(15))).toEqual([at(15)]);
  });

  it("sends nothing while turned off", async () => {
    const t = setup({ start: at(9), questions: [question("s1:n-1", at(9))], lastMessageAt: at(9) });
    t.setSettings({ enabled: false });
    expect(await t.runUntil(at(20))).toEqual([]);
  });

  it("summarizes every waiting question, oldest first, and links to the attention list", async () => {
    const t = setup({
      start: at(9),
      questions: [
        question("s1:n-2", at(8), "Quest view redesign"),
        question("s2:n-1", at(4), "Phone reminders"),
        question("s1:n-3", at(8, 30), "Quest view redesign"),
      ],
      lastMessageAt: at(9),
    });
    await t.runUntil(at(11));
    expect(t.send).toHaveBeenCalledWith({
      title: "3 questions waiting for you (oldest 7h)",
      body: "Phone reminders, Quest view redesign",
      path: ATTENTION_LIST_PATH,
    });
  });

  it("reminds about overdue to-dos alone, 2 hours after their own alert, opening the To-dos page", async () => {
    // Away since 6 AM; a to-do turns overdue (and gets its own alert) at 9 AM, with no question waiting.
    const t = setup({ start: at(9), lastMessageAt: at(6) });
    t.setTodos([{ id: "td-1", due: "2026-10-14T09:00", title: "Send the report" }]);
    expect(await t.runUntil(at(11, 30))).toEqual([at(11)]);
    expect(t.send).toHaveBeenCalledWith({ title: "1 overdue to-do", body: "Send the report", path: TODOS_PAGE_PATH });
  });

  it("names overdue to-dos alongside waiting questions and links to the attention list", async () => {
    const t = setup({ start: at(9), questions: [question("s1:n-1", at(8), "Phone reminders")], lastMessageAt: at(9) });
    t.setTodos([
      { id: "td-1", due: "2026-10-13", title: "Send the report" },
      { id: "td-2", due: "2026-10-14T08:00", title: "Book flights" },
    ]);
    await t.runUntil(at(11));
    expect(t.send).toHaveBeenCalledWith({
      title: "1 question waiting for you (oldest 3h), 2 overdue to-dos",
      body: "Phone reminders. Overdue: Send the report, Book flights",
      path: ATTENTION_LIST_PATH,
    });
  });

  // A tap on any later alert closes a reminder once everything it names is settled. Overdue to-dos
  // have no such check, so a reminder that names any stays on the phone.
  it("names its questions' subjects only when it is about questions alone", async () => {
    const withSubject = (key: string, notificationId: string): Question => ({
      ...question(key, at(8), "Phone reminders"),
      subject: { kind: "question", sessionId: "s1", notificationId },
    });
    const t = setup({ start: at(9), questions: [withSubject("s1:n-1", "n-1")], lastMessageAt: at(9) });
    await t.runUntil(at(11));
    expect(t.send.mock.lastCall![0].subjects).toEqual([{ kind: "question", sessionId: "s1", notificationId: "n-1" }]);

    t.setTodos([{ id: "td-1", due: "2026-10-13", title: "Send the report" }]);
    await t.runUntil(at(15));
    expect(t.send).toHaveBeenCalledTimes(2);
    expect(t.send.mock.lastCall![0]).not.toHaveProperty("subjects");
  });

  it("checks once a minute after start and stops on destroy", async () => {
    vi.useFakeTimers();
    try {
      const t = setup({ start: at(9) });
      const check = vi.spyOn(t.reminders, "check");
      t.reminders.start();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(check).toHaveBeenCalledTimes(3);
      t.reminders.destroy();
      await vi.advanceTimersByTimeAsync(3 * MINUTE);
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("isQuietHour", () => {
  it("handles quiet hours that wrap past midnight, same-day ranges and no quiet hours", () => {
    const overnight = { quietStartHour: 23, quietEndHour: 9 };
    expect(isQuietHour(at(23), overnight)).toBe(true);
    expect(isQuietHour(at(8, 59), overnight)).toBe(true);
    expect(isQuietHour(at(9), overnight)).toBe(false);
    expect(isQuietHour(at(22, 59), overnight)).toBe(false);
    expect(isQuietHour(at(13), { quietStartHour: 12, quietEndHour: 14 })).toBe(true);
    expect(isQuietHour(at(14), { quietStartHour: 12, quietEndHour: 14 })).toBe(false);
    expect(isQuietHour(at(3), { quietStartHour: 5, quietEndHour: 5 })).toBe(false);
  });
});
