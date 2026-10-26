import { describe, expect, it, vi } from "vitest";
import { cancelThreadReminder, setThreadReminder, wakeDueThreadReminders } from "./thread-reminders.js";

// A leader session as the reminder code reads it: state, notifications and boards.
function leader(id = "leader") {
  return {
    id,
    state: { isOrchestrator: true } as Record<string, any>,
    notifications: [] as any[],
    notificationCounter: 0,
    messageHistory: [] as any[],
    board: new Map([["q-7", { questId: "q-7", title: "Design the to-do page" }]]),
    completedBoard: new Map(),
  };
}

function deps() {
  return {
    persistSession: vi.fn(),
    promoteLeaderThreadTabForAttention: vi.fn(() => true),
    onMonitoredThreadResult: vi.fn(),
    getLauncherSessionInfo: vi.fn((): { archived?: boolean } | null => null),
  };
}

describe("thread reminders", () => {
  it("keeps the wake time on the session state, persisted, and lets it be cancelled", () => {
    const session = leader();
    const d = deps();
    setThreadReminder(session, { threadKey: "Q-7", remindAt: 5_000, messageId: "m-1" }, d);
    expect(session.state.leaderThreadReminders).toEqual({
      "q-7": expect.objectContaining({ remindAt: 5_000, messageId: "m-1" }),
    });
    // Persisting also republishes the projections browsers read reminders from.
    expect(d.persistSession).toHaveBeenCalledWith(session);

    expect(cancelThreadReminder(session, "q-7", d)).toBe(true);
    expect(session.state.leaderThreadReminders).toEqual({});
    expect(cancelThreadReminder(session, "q-7", d)).toBe(false);
  });

  it("brings a due thread back in Notify Me with a result to acknowledge and keeps later reminders", () => {
    // q-7 is due; Main is not yet. Waking puts q-7 in Notify Me with a pending result (named
    // after its board title), reopens its tab and hands it to the Notify Me alert path.
    const session = leader();
    const d = deps();
    setThreadReminder(session, { threadKey: "q-7", remindAt: 1_000 }, d);
    setThreadReminder(session, { threadKey: "main", remindAt: 9_000 }, d);

    expect(wakeDueThreadReminders([session], 2_000, d)).toBe(1);

    expect(Object.keys(session.state.leaderThreadReminders)).toEqual(["main"]);
    expect(session.state.threadMonitoring.threads["q-7"]).toEqual({
      trackedAt: 2_000,
      afterHistoryIndex: -1,
      pending: {
        id: "1",
        messageId: "",
        timestamp: 2_000,
        summary: "Reminder: q-7 Design the to-do page",
        // Marked as a reminder: the attention list shows it under Reminders, right after questions.
        reminder: true,
      },
    });
    expect(session.notifications).toEqual([]);
    expect(d.promoteLeaderThreadTabForAttention).toHaveBeenCalledWith("leader", "q-7", 2_000, "primary");
    expect(d.onMonitoredThreadResult).toHaveBeenCalledWith(session, "q-7");
  });

  it("opens a reminder set from a message at that message", () => {
    // "Remind me later" on one unread answer in the attention list records the answer's message;
    // when it comes back, opening it lands there rather than on the thread's latest result.
    const session = leader();
    const d = deps();
    setThreadReminder(session, { threadKey: "q-7", remindAt: 1_000, messageId: "answer-3" }, d);
    wakeDueThreadReminders([session], 2_000, d);
    expect(session.state.threadMonitoring.threads["q-7"].pending).toMatchObject({
      messageId: "answer-3",
      reminder: true,
    });
  });

  it("keeps a result already waiting in Notify Me instead of replacing it", () => {
    const session = leader();
    const d = deps();
    session.state.threadMonitoring = {
      revision: 3,
      alertVersion: 1,
      threads: {
        "q-7": {
          trackedAt: 1,
          afterHistoryIndex: 0,
          pending: { id: "3", messageId: "m", timestamp: 1, summary: "Done" },
        },
      },
    };
    setThreadReminder(session, { threadKey: "q-7", remindAt: 1_000 }, d);
    wakeDueThreadReminders([session], 2_000, d);
    expect(session.state.threadMonitoring.threads["q-7"].pending.id).toBe("3");
    expect(d.onMonitoredThreadResult).not.toHaveBeenCalled();
    expect(session.state.leaderThreadReminders).toEqual({});
  });

  it("leaves an archived leader's reminders alone", () => {
    const session = leader();
    const d = deps();
    setThreadReminder(session, { threadKey: "q-7", remindAt: 1_000 }, d);
    d.getLauncherSessionInfo.mockReturnValue({ archived: true });
    expect(wakeDueThreadReminders([session], 2_000, d)).toBe(0);
    expect(session.notifications).toEqual([]);
  });
});
