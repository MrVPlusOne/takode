// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store.js";
import { handleNotificationUpdateMessage } from "./ws-notification-handler.js";
import type { SdkSessionInfo, SessionNotification } from "./types.js";

vi.mock("./utils/notification-sound.js", () => ({
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

function session(): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    archived: false,
  };
}

function review(id: string): SessionNotification {
  return {
    id,
    category: "review",
    summary: "Ready for review",
    timestamp: 1000,
    messageId: null,
    done: false,
  };
}

describe("handleNotificationUpdateMessage", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.getState().setSdkSessions([session()]);
    useStore.setState({ notificationSound: false });
  });

  it("preserves authoritative counts instead of recomputing raw rows", () => {
    const notifications = [review("n-1"), review("n-2"), review("n-3"), review("n-4"), review("n-5")];

    handleNotificationUpdateMessage("s1", {
      type: "notification_update",
      notifications,
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 1,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual(notifications);
    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 7,
    });
  });

  it("derives counts for backward-compatible updates without summary fields", () => {
    handleNotificationUpdateMessage("s1", {
      type: "notification_update",
      notifications: [review("n-1")],
      notificationStatusVersion: 6,
    });

    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 6,
    });
  });
});
