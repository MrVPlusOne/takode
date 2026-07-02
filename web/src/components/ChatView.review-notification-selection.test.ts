import { describe, expect, it } from "vitest";
import type { SessionNotification } from "../types.js";
import { reviewNotificationIdsForSelectedThread } from "./ChatView.js";

function threadReadyNotification(overrides: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id: "review-q1563",
    category: "review",
    summary: "Thread ready: q-1563 | rework complete",
    timestamp: 2,
    messageId: null,
    threadKey: "q-1563",
    questId: "q-1563",
    done: false,
    ...overrides,
  };
}

describe("reviewNotificationIdsForSelectedThread", () => {
  it("keeps a Thread Ready review unread when Main or another thread is selected", () => {
    // This models the live regression: q-1563 receives Thread Ready while the
    // user is viewing Main or a different tab. Only the target thread view may
    // resolve the backing review notification.
    const notifications = [threadReadyNotification()];

    expect(reviewNotificationIdsForSelectedThread(notifications, [], "main")).toEqual([]);
    expect(reviewNotificationIdsForSelectedThread(notifications, [], "q-1111")).toEqual([]);
    expect(reviewNotificationIdsForSelectedThread(notifications, [], "q-1563")).toEqual(["review-q1563"]);
  });

  it("ignores aggregate All Threads when resolving Thread Ready review unread", () => {
    const notifications = [threadReadyNotification()];

    expect(reviewNotificationIdsForSelectedThread(notifications, [], "all")).toEqual([]);
  });
});
