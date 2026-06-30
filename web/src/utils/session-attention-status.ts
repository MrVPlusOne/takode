import { normalizeLeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import { isClearedNotificationStatus, type NotificationStatusSnapshot } from "../notification-status.js";
import type { SessionNotification } from "../types.js";
import { getHighestNotificationUrgency, type NotificationUrgency } from "./notification-urgency.js";
import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

export type SessionAttentionStatusUrgency = NotificationUrgency | "muted-needs-input";

export interface EffectiveSessionAttentionStatus {
  urgency: SessionAttentionStatusUrgency;
  count: number;
}

type AttentionReason = "action" | "error" | "review" | null;

type SessionAttentionSummary = NotificationStatusSnapshot &
  Pick<Partial<SidebarSessionItem>, "id" | "isOrchestrator"> & {
    leaderOpenThreadTabs?: import("../../shared/leader-open-thread-tabs.js").LeaderOpenThreadTabsState;
  };

function positiveCount(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function getSummaryCount(summary: SessionAttentionSummary | undefined, urgency: SessionAttentionStatusUrgency): number {
  if (!summary) return 1;
  if (urgency === "needs-input") {
    return (
      positiveCount(summary.activeNeedsInputNotificationCount) ?? positiveCount(summary.activeNotificationCount) ?? 1
    );
  }
  if (urgency === "review") {
    return positiveCount(summary.activeReviewNotificationCount) ?? positiveCount(summary.activeNotificationCount) ?? 1;
  }
  return positiveCount(summary.mutedNeedsInputNotificationCount) ?? 1;
}

function getFallbackStatus(
  fallbackUrgency: NotificationUrgency | null | undefined,
  fallbackSummary: SessionAttentionSummary | undefined,
): EffectiveSessionAttentionStatus | null {
  if (fallbackUrgency) {
    return { urgency: fallbackUrgency, count: getSummaryCount(fallbackSummary, fallbackUrgency) };
  }
  if ((fallbackSummary?.mutedNeedsInputNotificationCount ?? 0) > 0) {
    return {
      urgency: "muted-needs-input",
      count: getSummaryCount(fallbackSummary, "muted-needs-input"),
    };
  }
  return null;
}

function getEffectiveAttentionStatus({
  attention,
  permCount,
  fallbackSummary,
}: {
  attention: AttentionReason | undefined;
  permCount: number | undefined;
  fallbackSummary: SessionAttentionSummary | undefined;
}): EffectiveSessionAttentionStatus | null {
  if ((permCount ?? 0) > 0) return null;
  const hasFreshClearedNotificationSummary =
    fallbackSummary?.notificationStatusVersion !== undefined && fallbackSummary.activeNotificationCount === 0;
  if ((attention === "action" || attention === "review") && hasFreshClearedNotificationSummary) return null;
  if (attention === "action") {
    return { urgency: "needs-input", count: getSummaryCount(fallbackSummary, "needs-input") };
  }
  if (attention === "review") {
    return { urgency: "review", count: getSummaryCount(fallbackSummary, "review") };
  }
  return null;
}

function filterOpenNotifications(
  notifications: SessionNotification[],
  summary: SessionAttentionSummary | undefined,
): SessionNotification[] {
  const openThreadKeys = new Set<string>([MAIN_THREAD_KEY]);
  if (summary?.isOrchestrator) {
    const openTabs = normalizeLeaderOpenThreadTabsState(summary.leaderOpenThreadTabs);
    for (const key of openTabs?.orderedOpenThreadKeys ?? []) openThreadKeys.add(normalizeThreadKey(key));
  }
  return notifications
    .filter((notification) => !notification.done)
    .filter((notification) => {
      if (!summary?.isOrchestrator || notification.category !== "review") return true;
      const threadKey = normalizeThreadKey(notification.threadKey || notification.questId || MAIN_THREAD_KEY);
      return openThreadKeys.has(threadKey);
    });
}

function countActiveNeedsInput(notifications: SessionNotification[]): number {
  return notifications.filter((notification) => notification.category === "needs-input" && !notification.muted).length;
}

function countActiveReview(notifications: SessionNotification[]): number {
  return notifications.filter((notification) => notification.category === "review" && !notification.muted).length;
}

function countMutedNeedsInput(notifications: SessionNotification[]): number {
  return notifications.filter((notification) => notification.category === "needs-input" && notification.muted).length;
}

function statusFromLiveNotifications(
  urgency: NotificationUrgency,
  notifications: SessionNotification[],
): EffectiveSessionAttentionStatus | null {
  if (urgency === "needs-input") {
    return { urgency, count: Math.max(1, countActiveNeedsInput(notifications)) };
  }
  if (urgency === "review") {
    return { urgency, count: Math.max(1, countActiveReview(notifications)) };
  }
  return null;
}

function statusFromSummary(
  summary: SessionAttentionSummary | undefined,
  urgency: NotificationUrgency,
): EffectiveSessionAttentionStatus | null {
  if (!urgency) return null;
  return { urgency, count: getSummaryCount(summary, urgency) };
}

export function deriveEffectiveSessionAttentionStatus({
  sessionId,
  currentSessionId,
  notifications,
  summary,
  fallbackSummary,
  fallbackUrgency,
  attention,
  permCount,
}: {
  sessionId: string;
  currentSessionId?: string | null;
  notifications: SessionNotification[] | undefined;
  summary?: SessionAttentionSummary;
  fallbackSummary?: SessionAttentionSummary;
  fallbackUrgency?: NotificationUrgency | null;
  attention?: AttentionReason;
  permCount?: number;
}): EffectiveSessionAttentionStatus | null {
  const effectiveAttentionStatus = getEffectiveAttentionStatus({ attention, permCount, fallbackSummary });
  if (effectiveAttentionStatus) return effectiveAttentionStatus;

  if (!notifications) {
    return getFallbackStatus(fallbackUrgency, fallbackSummary ?? summary);
  }
  if (isClearedNotificationStatus(summary ?? {})) return null;

  const activeNotifications = filterOpenNotifications(notifications, summary);
  const activeAttentionNotifications = activeNotifications.filter(
    (notification) => !(notification.category === "needs-input" && notification.muted),
  );
  const liveUrgency = getHighestNotificationUrgency(activeNotifications);
  const summaryUrgency = summary?.notificationUrgency ?? null;
  const summaryActiveCount = summary?.activeNotificationCount;
  const hasFreshSummary =
    summary?.notificationStatusVersion !== undefined || summary?.notificationStatusUpdatedAt !== undefined;
  const summaryCanOverrideWithReview =
    summaryUrgency !== "review" || !summary?.isOrchestrator || activeNotifications.some((n) => n.category === "review");

  if (
    hasFreshSummary &&
    summaryUrgency &&
    summaryCanOverrideWithReview &&
    summaryActiveCount !== undefined &&
    summaryActiveCount > 0 &&
    (liveUrgency !== summaryUrgency || activeAttentionNotifications.length !== summaryActiveCount)
  ) {
    return statusFromSummary(summary, summaryUrgency);
  }

  const liveStatus = statusFromLiveNotifications(liveUrgency, activeNotifications);
  if (liveStatus) return liveStatus;

  const mutedCount =
    countMutedNeedsInput(activeNotifications) || positiveCount(summary?.mutedNeedsInputNotificationCount) || 0;
  if (mutedCount > 0) return { urgency: "muted-needs-input", count: mutedCount };

  if (summaryActiveCount === 0 || (hasFreshSummary && summaryUrgency === null)) return null;
  if (currentSessionId === sessionId) return null;
  return getFallbackStatus(fallbackUrgency, fallbackSummary ?? summary);
}
