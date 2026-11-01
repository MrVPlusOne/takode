import { describe, expect, it } from "vitest";
import {
  applyLeaderThreadTabsProjectionPatch,
  createLeaderThreadTabsProjectionPatch,
} from "../shared/leader-thread-tabs-projection.js";
import { markNotificationDone } from "./bridge/session-notification-controller.js";
import type { BrowserIncomingMessage, SessionNotification } from "./session-types.js";
import { threadUserInteractionTimes } from "./thread-user-interaction.js";

/**
 * The sessions panel's Threads view lists threads by when the user last dealt with them (Jiayi,
 * Nov 1: like a chat app). Only the user's own actions count: their messages, and results and
 * questions they marked done in a browser. An answer arriving, or Takode resolving a question,
 * doesn't move a thread.
 */
const user = (threadKey: string, timestamp: number, extra: Record<string, unknown> = {}) =>
  ({ type: "user_message", content: "hi", timestamp, threadKey, ...extra }) as unknown as BrowserIncomingMessage;
const answer = (threadKey: string, timestamp: number) =>
  ({
    type: "assistant",
    timestamp,
    threadKey,
    message: { content: [] },
    threadAnswer: { answerUserMessageIds: ["u7"] },
  }) as unknown as BrowserIncomingMessage;
const notification = (
  id: string,
  threadKey: string,
  extra: Partial<SessionNotification> = {},
): SessionNotification => ({
  id,
  category: "review",
  timestamp: 1,
  messageId: null,
  threadKey,
  done: false,
  ...extra,
});

describe("threadUserInteractionTimes", () => {
  it("counts the user's messages and what they read, not answers arriving or agents' messages", () => {
    const history = [
      user("q-1", 100),
      answer("q-1", 900), // a new answer for the user: unread, it moves nothing
      user("q-2", 200, { agentSource: { sessionId: "herd-events" } }), // a herd event
      user("main", 300),
      user("topic:abcdef12", 400),
    ];
    const notifications = [
      notification("n-1", "q-3", { done: true, doneAt: 500, userDoneAt: 500 }), // the user read it
      notification("n-2", "q-4", { done: true, doneAt: 600 }), // Takode resolved it
      notification("n-3", "", { questId: "q-5", done: true, doneAt: 700, userDoneAt: 700 }),
    ];
    expect(Object.fromEntries(threadUserInteractionTimes(history, notifications))).toEqual({
      "q-1": 100,
      main: 300,
      "topic:abcdef12": 400,
      "q-3": 500,
      "q-5": 700,
    });
  });

  it("records the user reading a result only when the user marks it done", () => {
    const session = {
      id: "leader",
      notifications: [notification("n-1", "q-1"), notification("n-2", "q-2")],
      pendingPermissions: new Map(),
      board: new Map(),
      state: {},
    };
    const deps = { persistSession: () => {} };
    markNotificationDone(session as never, "n-1", true, deps as never, { byUser: true });
    markNotificationDone(session as never, "n-2", true, deps as never);
    expect(session.notifications[0]!.userDoneAt).toBe(session.notifications[0]!.doneAt);
    expect(session.notifications[1]!.userDoneAt).toBeUndefined();
  });
});

describe("userInteractionAt in the leader's tab projection", () => {
  it("travels in a patch when it changes", () => {
    const base = {
      currentQuestStateVersion: 1 as const,
      tabState: null,
      tabs: [],
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
      threadStatuses: {},
      activePhaseSummary: [],
      userInteractionAt: { main: 1 },
    };
    const next = { ...base, userInteractionAt: { main: 1, "q-1": 5 } };
    const patch = createLeaderThreadTabsProjectionPatch(base, next);
    expect(patch?.u).toEqual({ main: 1, "q-1": 5 });
    expect(applyLeaderThreadTabsProjectionPatch(base, patch)?.userInteractionAt).toEqual({ main: 1, "q-1": 5 });
  });
});
