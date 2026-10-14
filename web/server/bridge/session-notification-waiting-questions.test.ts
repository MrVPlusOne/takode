import { describe, expect, it } from "vitest";
import { listWaitingUserQuestions } from "./session-notification-controller.js";

// Follow-up reminders summarize the questions still waiting for the user. Only open, unmuted needs-input
// prompts count (a snoozed prompt is muted until it wakes), and only from sessions the caller says address
// the user, which leaves out archived sessions and herded workers.

const notif = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  category: "needs-input",
  timestamp: 1000,
  messageId: null,
  done: false,
  ...extra,
});

describe("listWaitingUserQuestions", () => {
  it("lists open, unmuted questions from sessions addressed to the user", () => {
    const sessions = [
      {
        id: "leader",
        notifications: [
          notif("n-1", { questId: "q-7", timestamp: 2000 }),
          notif("n-2", { done: true }),
          notif("n-3", { muted: true }),
          notif("n-4", { muted: true, snoozedUntil: 9_999_999 }),
          notif("n-5", { category: "review" }),
        ],
      },
      { id: "worker", notifications: [notif("n-1")] },
      { id: "plain", notifications: [notif("n-9", { timestamp: 500 })] },
    ];

    const waiting = listWaitingUserQuestions(sessions, (sessionId) => sessionId !== "worker");

    expect(waiting).toEqual([
      { key: "leader:n-1", sessionId: "leader", questId: "q-7", askedAt: 2000 },
      { key: "plain:n-9", sessionId: "plain", questId: undefined, askedAt: 500 },
    ]);
  });
});
