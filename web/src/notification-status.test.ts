// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  setSdkSessionsWithNotificationFreshness,
  shouldApplyAttentionReasonWithNotificationFreshness,
} from "./notification-status.js";
import { useStore } from "./store.js";
import type { SdkSessionInfo } from "./types.js";

function session(overrides: Partial<SdkSessionInfo>): SdkSessionInfo {
  return {
    sessionId: "s1",
    state: "connected",
    cwd: "/repo",
    createdAt: 1,
    archived: false,
    ...overrides,
  };
}

describe("notification status attention freshness", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("rejects stale REST action attention after a newer cleared notification status", () => {
    // Sidebar REST hydration first preserves the newer notification summary,
    // then uses this guard before copying attentionReason into sessionAttention.
    useStore.getState().setSdkSessions([
      session({
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      }),
    ]);

    const staleRestRow = session({
      attentionReason: "action",
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 4,
      notificationStatusUpdatedAt: 4000,
    });
    setSdkSessionsWithNotificationFreshness([staleRestRow]);

    const current = useStore.getState().sdkSessions[0]!;
    expect(current.notificationUrgency).toBeNull();
    expect(current.activeNotificationCount).toBe(0);
    expect(current.notificationStatusVersion).toBe(5);
    expect(shouldApplyAttentionReasonWithNotificationFreshness("s1", staleRestRow.attentionReason, staleRestRow)).toBe(
      false,
    );
  });

  it("keeps permission-derived action attention independent of notification freshness", () => {
    // Pending permissions also use action attention, so the freshness guard
    // must not hide a real permission badge.
    useStore.getState().setSdkSessions([
      session({
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      }),
    ]);

    expect(
      shouldApplyAttentionReasonWithNotificationFreshness("s1", "action", {
        pendingPermissionCount: 1,
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 4,
        notificationStatusUpdatedAt: 4000,
      }),
    ).toBe(true);
  });
});
