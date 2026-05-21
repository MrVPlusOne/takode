import { describe, expect, it } from "vitest";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { getGlobalNeedsInputEntries } from "./global-needs-input.js";

function sdk(sessionId: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId,
    createdAt: 1,
    cwd: "/repo",
    state: "connected",
    ...overrides,
  };
}

function needsInputNotification(overrides: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id: "n1",
    category: "needs-input",
    summary: "Needs input",
    timestamp: 1000,
    messageId: null,
    done: false,
    ...overrides,
  };
}

function entriesFor({
  sdkSessions,
  sessionNotifications,
}: {
  sdkSessions: SdkSessionInfo[];
  sessionNotifications: Map<string, SessionNotification[]>;
}) {
  return getGlobalNeedsInputEntries({
    sdkSessions,
    sessionNotifications,
    sessionNames: new Map(),
  });
}

describe("getGlobalNeedsInputEntries", () => {
  it("ignores cached needs-input notifications when a fresh session summary says none are active", () => {
    // The global aggregate can have a full cached inbox from an earlier fetch.
    // A newer lightweight session summary is authoritative for whether that
    // cache is still allowed to drive the top-bar count and popover.
    const entries = entriesFor({
      sdkSessions: [
        sdk("s1", {
          notificationUrgency: null,
          activeNotificationCount: 0,
          activeNeedsInputNotificationCount: 0,
          notificationStatusVersion: 5,
          notificationStatusUpdatedAt: 5000,
        }),
      ],
      sessionNotifications: new Map([["s1", [needsInputNotification()]]]),
    });

    expect(entries).toEqual([]);
  });

  it("ignores stale needs-input cache when a fresh session summary has only review notifications", () => {
    const entries = entriesFor({
      sdkSessions: [
        sdk("s1", {
          notificationUrgency: "review",
          activeNotificationCount: 1,
          activeNeedsInputNotificationCount: 0,
          activeReviewNotificationCount: 1,
          notificationStatusVersion: 6,
        }),
      ],
      sessionNotifications: new Map([["s1", [needsInputNotification()]]]),
    });

    expect(entries).toEqual([]);
  });

  it("keeps genuinely active needs-input notifications visible", () => {
    const active = needsInputNotification({ id: "active" });
    const entries = entriesFor({
      sdkSessions: [
        sdk("s1", {
          notificationUrgency: "needs-input",
          activeNotificationCount: 1,
          activeNeedsInputNotificationCount: 1,
          notificationStatusVersion: 7,
        }),
      ],
      sessionNotifications: new Map([["s1", [active]]]),
    });

    expect(entries.map((entry) => entry.notification.id)).toEqual(["active"]);
  });
});
