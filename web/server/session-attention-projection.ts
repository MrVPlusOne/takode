import {
  SESSION_ATTENTION_PROJECTION,
  sessionAttentionProjectionEqual,
  type SessionAttentionProjectionValue,
  type SessionAttentionReason,
} from "../shared/session-attention-projection.js";
import { countPendingUserPermissions, getNotificationStatusSnapshot } from "./bridge/session-registry-controller.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { SyncedProjectionDefinition } from "./synced-projection-runtime.js";

type SessionAttentionDependencies = {
  attentionReason: SessionAttentionReason;
  pendingPermissionCount: number;
  notificationStatusVersion: number | undefined;
  notificationStatusUpdatedAt: number | undefined;
  manualUnread: boolean;
  lastReadAt: number;
  leaderOpenThreadTabs: unknown;
  isOrchestrator: boolean;
  suppressDirectNotifications: boolean;
};

export interface SessionAttentionProjectionDefinitionDeps<TSubscriber> {
  getSession: (sessionId: string) => Session | undefined;
  isHerdedWorkerSession: (session: Session) => boolean;
  authorizeSubscription: (subscriber: TSubscriber, session: Session) => boolean;
}

function dependenciesEqual(left: SessionAttentionDependencies, right: SessionAttentionDependencies): boolean {
  return (
    left.attentionReason === right.attentionReason &&
    left.pendingPermissionCount === right.pendingPermissionCount &&
    left.notificationStatusVersion === right.notificationStatusVersion &&
    left.notificationStatusUpdatedAt === right.notificationStatusUpdatedAt &&
    left.manualUnread === right.manualUnread &&
    left.lastReadAt === right.lastReadAt &&
    left.leaderOpenThreadTabs === right.leaderOpenThreadTabs &&
    left.isOrchestrator === right.isOrchestrator &&
    left.suppressDirectNotifications === right.suppressDirectNotifications
  );
}

function deriveValue(session: Session, dependencies: SessionAttentionDependencies): SessionAttentionProjectionValue {
  const rawReason = dependencies.attentionReason;
  const notificationStatus = dependencies.suppressDirectNotifications
    ? {
        activeNeedsInputNotificationCount: 0,
        activeReviewNotificationCount: 0,
        mutedNeedsInputNotificationCount: 0,
      }
    : getNotificationStatusSnapshot(session);

  const hasFreshNotificationStatus =
    (dependencies.notificationStatusVersion ?? 0) > 0 || (dependencies.notificationStatusUpdatedAt ?? 0) > 0;
  const allowRawFallback = !hasFreshNotificationStatus;
  const status =
    dependencies.pendingPermissionCount > 0
      ? {
          urgency: "needs-input" as const,
          count: dependencies.pendingPermissionCount,
        }
      : notificationStatus.activeNeedsInputNotificationCount > 0
        ? {
            urgency: "needs-input" as const,
            count: notificationStatus.activeNeedsInputNotificationCount,
          }
        : notificationStatus.activeReviewNotificationCount > 0
          ? {
              urgency: "review" as const,
              count: notificationStatus.activeReviewNotificationCount,
            }
          : dependencies.manualUnread
            ? { urgency: "review" as const, count: 1 }
            : notificationStatus.mutedNeedsInputNotificationCount > 0
              ? {
                  urgency: "muted-needs-input" as const,
                  count: notificationStatus.mutedNeedsInputNotificationCount,
                }
              : allowRawFallback && rawReason === "action"
                ? { urgency: "needs-input" as const, count: 1 }
                : allowRawFallback && rawReason === "review"
                  ? { urgency: "review" as const, count: 1 }
                  : null;

  const attentionReason: SessionAttentionReason =
    dependencies.pendingPermissionCount > 0 || status?.urgency === "needs-input"
      ? "action"
      : rawReason === "error"
        ? "error"
        : status?.urgency === "review"
          ? "review"
          : allowRawFallback
            ? rawReason
            : null;

  return { attentionReason, status };
}

export function createSessionAttentionProjectionDefinition<TSubscriber>(
  deps: SessionAttentionProjectionDefinitionDeps<TSubscriber>,
): SyncedProjectionDefinition<Session, SessionAttentionDependencies, SessionAttentionProjectionValue, TSubscriber> {
  return {
    projection: SESSION_ATTENTION_PROJECTION,
    dependencies: [
      "attention-reason",
      "pending-permissions",
      "notifications",
      "manual-unread",
      "last-read-at",
      "leader-open-thread-tabs",
      "notification-status-freshness",
      "herded-by",
    ],
    resolveSource: deps.getSession,
    selectDependencies: (session) => ({
      attentionReason: session.attentionReason ?? null,
      pendingPermissionCount: countPendingUserPermissions(session),
      notificationStatusVersion: session.notificationStatusVersion,
      notificationStatusUpdatedAt: session.notificationStatusUpdatedAt,
      manualUnread: session.manualUnread === true,
      lastReadAt: session.lastReadAt,
      leaderOpenThreadTabs: session.state.leaderOpenThreadTabs,
      isOrchestrator: session.state.isOrchestrator === true,
      suppressDirectNotifications: deps.isHerdedWorkerSession(session),
    }),
    dependenciesEqual,
    derive: (session, _key, dependencies) => deriveValue(session, dependencies),
    valueEqual: sessionAttentionProjectionEqual,
    authorizeSubscription: (subscriber, _key, session) => deps.authorizeSubscription(subscriber, session),
    maxValueBytes: 512,
  };
}
