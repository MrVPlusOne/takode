// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import {
  applySessionNotifications,
  applyNotificationStatusUpdate,
  setSdkSessionsWithNotificationFreshness,
  shouldApplyAttentionReasonWithNotificationFreshness,
} from "./notification-status.js";
import { useStore } from "./store.js";
import type { SdkSessionInfo, SessionNotification } from "./types.js";

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

function waitingNotification(): SessionNotification {
  return {
    id: "waiting-1",
    category: "waiting",
    summary: "Waiting on reviewer",
    timestamp: 1001,
    messageId: null,
    done: false,
  } as unknown as SessionNotification;
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

  it("prunes stale cached full notifications when REST hydration accepts a newer clear summary", () => {
    // /api/sessions carries only a lightweight summary. When that accepted
    // summary is newer and clear, a previously loaded full inbox must not keep
    // driving a sidebar amber dot.
    useStore.getState().setSdkSessions([
      session({
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 4,
        notificationStatusUpdatedAt: 4000,
      }),
    ]);
    useStore.setState({
      sessionNotifications: new Map([["s1", [needsInputNotification()]]]),
    });

    setSdkSessionsWithNotificationFreshness([
      session({
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      }),
    ]);

    expect(useStore.getState().sessionNotifications.get("s1")).toBeUndefined();
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(0);
  });

  it("keeps cached full notifications when a summary-only update is still active", () => {
    // Active summaries do not include full notification payloads, so they must
    // not erase the cached full inbox used by the open session UI.
    useStore.getState().setSdkSessions([session({})]);
    const cached = [needsInputNotification()];
    useStore.setState({ sessionNotifications: new Map([["s1", cached]]) });

    applyNotificationStatusUpdate("s1", {
      notificationUrgency: "needs-input",
      activeNotificationCount: 1,
      notificationStatusVersion: 5,
      notificationStatusUpdatedAt: 5000,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toBe(cached);
  });

  it("filters waiting markers out of unresolved notification state", () => {
    // `takode notify waiting` is a transient status marker, not a user-action
    // notification. Legacy/live waiting payloads must not drive chips/counts.
    useStore.getState().setSdkSessions([session({})]);

    const applied = applySessionNotifications(
      "s1",
      [waitingNotification(), needsInputNotification({ id: "n2", timestamp: 1002 })],
      {
        notificationStatusVersion: 3,
        notificationStatusUpdatedAt: 3000,
      },
    );

    expect(applied).toBe(true);
    expect(useStore.getState().sessionNotifications.get("s1")).toEqual([
      needsInputNotification({ id: "n2", timestamp: 1002 }),
    ]);
    expect(useStore.getState().sdkSessions[0]?.notificationUrgency).toBe("needs-input");
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(1);
  });

  it("clears cached notification state when only waiting markers arrive", () => {
    useStore.getState().setSdkSessions([session({})]);
    useStore.setState({ sessionNotifications: new Map([["s1", [needsInputNotification()]]]) });

    applySessionNotifications("s1", [waitingNotification()], {
      notificationStatusVersion: 4,
      notificationStatusUpdatedAt: 4000,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toBeUndefined();
    expect(useStore.getState().sdkSessions[0]?.notificationUrgency).toBeNull();
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(0);
  });

  it("does not let an older clear summary erase a newer active notification state", () => {
    // Crossed global updates should not delete a full inbox if the store already
    // knows about a newer active notification status.
    useStore.getState().setSdkSessions([
      session({
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      }),
    ]);
    const cached = [needsInputNotification()];
    useStore.setState({ sessionNotifications: new Map([["s1", cached]]) });

    const applied = applyNotificationStatusUpdate("s1", {
      notificationUrgency: null,
      activeNotificationCount: 0,
      notificationStatusVersion: 4,
      notificationStatusUpdatedAt: 4000,
    });

    expect(applied).toBe(false);
    expect(useStore.getState().sessionNotifications.get("s1")).toBe(cached);
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(1);
  });
});
