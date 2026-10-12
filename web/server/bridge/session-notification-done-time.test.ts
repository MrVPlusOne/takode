/**
 * Notifications remember when they were last marked done. The leader tab projection uses
 * that time to date when a tab left its prompt or unread-result group.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionNotification } from "../session-types.js";
import { markAllNotificationsDone, markNotificationDone } from "./session-notification-controller.js";

function session(notifications: SessionNotification[]) {
  return {
    id: "leader",
    notifications,
    board: new Map(),
    completedBoard: new Map(),
    pendingPermissions: new Map(),
    attentionReason: null,
  };
}

function review(id: string): SessionNotification {
  return { id, category: "review", summary: "Result", timestamp: 10, messageId: null, threadKey: "q-1", done: false };
}

const deps = { persistSession: vi.fn() };

afterEach(() => {
  vi.useRealTimers();
});

describe("notification done time", () => {
  it("records when a notification is marked done and forgets it when reopened", () => {
    vi.useFakeTimers();
    vi.setSystemTime(500);
    const target = session([review("n-1")]);

    markNotificationDone(target, "n-1", true, deps);
    expect(target.notifications[0]!.doneAt).toBe(500);

    markNotificationDone(target, "n-1", false, deps);
    expect(target.notifications[0]!.doneAt).toBeUndefined();
  });

  it("records the time for every notification marked done together", () => {
    vi.useFakeTimers();
    vi.setSystemTime(700);
    const target = session([review("n-1"), review("n-2")]);

    markAllNotificationsDone(target, true, deps);
    expect(target.notifications.map((notification) => notification.doneAt)).toEqual([700, 700]);
  });
});
