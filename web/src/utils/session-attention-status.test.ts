import { describe, expect, it } from "vitest";
import { deriveEffectiveSessionAttentionStatus } from "./session-attention-status.js";
import type { SessionNotification } from "../types.js";

describe("deriveEffectiveSessionAttentionStatus", () => {
  it("keeps fresh backend review summaries visible for the selected orchestrator session", () => {
    // Regression coverage for selected-vs-unselected sidebar flicker: viewing a
    // leader session shell is not proof that a thread-scoped unread was viewed.
    // A fresh backend-authored active summary should therefore stay visible
    // until a real clear/read update arrives.
    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "leader",
      notifications: undefined,
      summary: {
        id: "leader",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 7,
      },
      fallbackUrgency: "review",
    });

    expect(status).toEqual({ urgency: "review", count: 1 });
  });

  it("does not use deprecated leader-tab state to filter the canonical notification inbox", () => {
    const closedReview: SessionNotification = {
      id: "n-closed",
      category: "review",
      summary: "Closed thread ready",
      timestamp: 3000,
      messageId: null,
      done: false,
      threadKey: "q-closed",
      questId: "q-closed",
    };

    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "other",
      notifications: [closedReview],
      summary: {
        id: "leader",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 7,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-closed", closedAt: 4000 }],
          updatedAt: 4000,
        },
      } as never,
      fallbackUrgency: "review",
    });

    expect(status).toEqual({ urgency: "review", count: 1 });
  });

  it("preserves a loaded unread review without consulting deprecated tab state", () => {
    const openReview: SessionNotification = {
      id: "n-open",
      category: "review",
      summary: "Open thread ready",
      timestamp: 3000,
      messageId: null,
      done: false,
      threadKey: "q-open",
      questId: "q-open",
    };

    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "leader",
      notifications: [openReview],
      summary: {
        id: "leader",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 8,
      },
      fallbackUrgency: "review",
    });

    expect(status).toEqual({ urgency: "review", count: 1 });
  });

  it("preserves legacy leader unread when authoritative tab state is absent", () => {
    const legacyReview: SessionNotification = {
      id: "n-legacy",
      category: "review",
      summary: "Legacy thread ready",
      timestamp: 3000,
      messageId: null,
      done: false,
      threadKey: "q-1000",
      questId: "q-1000",
    };

    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "leader",
      notifications: [legacyReview],
      summary: {
        id: "leader",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 9,
      },
      fallbackUrgency: "review",
    });

    expect(status).toEqual({ urgency: "review", count: 1 });
  });

  it("still suppresses stale fallback attention for the selected session without a fresh active summary", () => {
    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "leader",
      notifications: [],
      fallbackUrgency: "review",
    });

    expect(status).toBeNull();
  });

  it("continues to let fresh cleared summaries suppress stale cached review notifications", () => {
    const cachedReview: SessionNotification = {
      id: "n-review",
      category: "review",
      summary: "Older review",
      timestamp: 100,
      messageId: null,
      done: false,
    };

    const status = deriveEffectiveSessionAttentionStatus({
      sessionId: "leader",
      currentSessionId: "other",
      notifications: [cachedReview],
      summary: {
        id: "leader",
        isOrchestrator: true,
        notificationUrgency: null,
        activeNotificationCount: 0,
        activeReviewNotificationCount: 0,
        notificationStatusVersion: 8,
      },
      fallbackUrgency: "review",
    });

    expect(status).toBeNull();
  });
});
