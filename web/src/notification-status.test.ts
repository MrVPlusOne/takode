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

function reviewNotification(overrides: Partial<SessionNotification> = {}): SessionNotification {
  return {
    id: "review-1",
    category: "review",
    summary: "Ready for review",
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

  it("keeps authoritative snapshot counts from inflating to raw historical review rows", () => {
    // q-1735 producer sequence: the compact list says one, an equal-version
    // selection snapshot contains five raw unresolved rows, then the compact
    // list refresh says one again. The snapshot's server counts must win so the
    // store never exposes a transient five.
    const compactSummary = session({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 7,
      notificationStatusUpdatedAt: 7000,
    });
    useStore.getState().setSdkSessions([compactSummary]);

    const rawHistoricalReviews = [
      reviewNotification({ id: "n-old-1", timestamp: 1000, threadKey: "q-old-1" }),
      reviewNotification({ id: "n-old-2", timestamp: 1100, threadKey: "q-old-2" }),
      reviewNotification({ id: "n-old-3", timestamp: 1200, threadKey: "q-old-3" }),
      reviewNotification({ id: "n-old-4", timestamp: 1300, threadKey: "q-old-4" }),
      reviewNotification({ id: "n-current", timestamp: 3000, threadKey: "q-current" }),
    ];
    applySessionNotifications(
      "s1",
      rawHistoricalReviews,
      {
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeNeedsInputNotificationCount: 0,
        activeReviewNotificationCount: 1,
        mutedNeedsInputNotificationCount: 0,
        notificationStatusVersion: 7,
        notificationStatusUpdatedAt: 7000,
      },
      { authoritativeStatus: true },
    );

    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeReviewNotificationCount: 1,
      notificationStatusVersion: 7,
    });

    setSdkSessionsWithNotificationFreshness([compactSummary]);
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(1);
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
    expect(useStore.getState().sdkSessions[0]?.activeNeedsInputNotificationCount).toBe(1);
    expect(useStore.getState().sdkSessions[0]?.activeReviewNotificationCount).toBe(0);
  });

  it("keeps muted needs-input unresolved while removing it from active counts", () => {
    // Muting is not resolution. The prompt remains cached and separately counted,
    // but it stops driving active needs-input urgency.
    useStore.getState().setSdkSessions([session({})]);

    applySessionNotifications("s1", [needsInputNotification({ id: "muted", muted: true })], {
      notificationStatusVersion: 5,
      notificationStatusUpdatedAt: 5000,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual([
      needsInputNotification({ id: "muted", muted: true }),
    ]);
    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationUrgency: null,
      activeNotificationCount: 0,
      activeNeedsInputNotificationCount: 0,
      mutedNeedsInputNotificationCount: 1,
    });
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
