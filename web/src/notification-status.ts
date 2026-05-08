import { useStore } from "./store.js";
import type { SdkSessionInfo, SessionNotification } from "./types.js";

export type NotificationUrgency = "needs-input" | "review" | null;

export interface NotificationStatusSnapshot {
  notificationUrgency?: NotificationUrgency;
  activeNotificationCount?: number;
  notificationStatusVersion?: number;
  notificationStatusUpdatedAt?: number;
}

export type AttentionReason = "action" | "error" | "review" | null;

export function isActionableNotificationCategory(category: unknown): category is SessionNotification["category"] {
  return category === "needs-input" || category === "review";
}

export function isActionableSessionNotification(notification: SessionNotification): boolean {
  return isActionableNotificationCategory(notification.category);
}

function summarizeNotifications(
  notifications: ReadonlyArray<SessionNotification>,
): Required<NotificationStatusSnapshot> {
  let activeNotificationCount = 0;
  let hasNeedsInput = false;
  let hasReview = false;
  for (const notification of notifications) {
    if (notification.done) continue;
    if (!isActionableSessionNotification(notification)) continue;
    activeNotificationCount += 1;
    if (notification.category === "needs-input") hasNeedsInput = true;
    if (notification.category === "review") hasReview = true;
  }
  return {
    notificationUrgency: hasNeedsInput ? "needs-input" : hasReview ? "review" : null,
    activeNotificationCount,
    notificationStatusVersion: 0,
    notificationStatusUpdatedAt: 0,
  };
}

export function summarizeNotificationStatus(
  notifications: ReadonlyArray<SessionNotification>,
  status: NotificationStatusSnapshot = {},
): NotificationStatusSnapshot {
  const summary = summarizeNotifications(notifications);
  return {
    notificationUrgency: summary.notificationUrgency,
    activeNotificationCount: summary.activeNotificationCount,
    notificationStatusVersion: status.notificationStatusVersion,
    notificationStatusUpdatedAt: status.notificationStatusUpdatedAt,
  };
}

function hasNotificationStatus(snapshot: NotificationStatusSnapshot): boolean {
  return (
    snapshot.notificationUrgency !== undefined ||
    snapshot.activeNotificationCount !== undefined ||
    snapshot.notificationStatusVersion !== undefined ||
    snapshot.notificationStatusUpdatedAt !== undefined
  );
}

function notificationStatusFromSession(session: SdkSessionInfo | undefined): NotificationStatusSnapshot {
  if (!session) return {};
  return {
    notificationUrgency: session.notificationUrgency,
    activeNotificationCount: session.activeNotificationCount,
    notificationStatusVersion: session.notificationStatusVersion,
    notificationStatusUpdatedAt: session.notificationStatusUpdatedAt,
  };
}

function isIncomingNotificationStatusStale(
  current: NotificationStatusSnapshot,
  incoming: NotificationStatusSnapshot,
): boolean {
  if (!hasNotificationStatus(incoming)) return false;
  const currentVersion = current.notificationStatusVersion;
  const incomingVersion = incoming.notificationStatusVersion;
  if (currentVersion !== undefined) {
    if (incomingVersion === undefined) return true;
    if (incomingVersion < currentVersion) return true;
    if (incomingVersion > currentVersion) return false;
  }
  const currentUpdatedAt = current.notificationStatusUpdatedAt;
  const incomingUpdatedAt = incoming.notificationStatusUpdatedAt;
  if (currentUpdatedAt !== undefined && incomingUpdatedAt !== undefined) {
    return incomingUpdatedAt < currentUpdatedAt;
  }
  return false;
}

function hasPendingPermissionAction(status: NotificationStatusSnapshot & { pendingPermissionCount?: number }): boolean {
  return typeof status.pendingPermissionCount === "number" && status.pendingPermissionCount > 0;
}

export function shouldApplyAttentionReasonWithNotificationFreshness(
  sessionId: string,
  attentionReason: AttentionReason | undefined,
  status: NotificationStatusSnapshot & { pendingPermissionCount?: number },
): boolean {
  if (attentionReason !== "action") return true;
  if (hasPendingPermissionAction(status)) return true;
  if (status.notificationUrgency !== "needs-input") return true;
  const current = notificationStatusFromSession(
    useStore.getState().sdkSessions.find((session) => session.sessionId === sessionId),
  );
  return !isIncomingNotificationStatusStale(current, status);
}

function applyNotificationStatus(session: SdkSessionInfo, status: NotificationStatusSnapshot): SdkSessionInfo {
  return {
    ...session,
    ...(status.notificationUrgency !== undefined ? { notificationUrgency: status.notificationUrgency } : {}),
    ...(status.activeNotificationCount !== undefined
      ? { activeNotificationCount: status.activeNotificationCount }
      : {}),
    ...(status.notificationStatusVersion !== undefined
      ? { notificationStatusVersion: status.notificationStatusVersion }
      : {}),
    ...(status.notificationStatusUpdatedAt !== undefined
      ? { notificationStatusUpdatedAt: status.notificationStatusUpdatedAt }
      : {}),
  };
}

function preserveCurrentNotificationStatus(
  incoming: SdkSessionInfo,
  current: SdkSessionInfo | undefined,
): SdkSessionInfo {
  const currentStatus = notificationStatusFromSession(current);
  const incomingStatus = notificationStatusFromSession(incoming);
  if (!hasNotificationStatus(incomingStatus) && hasNotificationStatus(currentStatus)) {
    return applyNotificationStatus(incoming, currentStatus);
  }
  if (!isIncomingNotificationStatusStale(currentStatus, incomingStatus)) return incoming;
  return applyNotificationStatus(incoming, currentStatus);
}

export function setSdkSessionsWithNotificationFreshness(sessions: SdkSessionInfo[]): void {
  const state = useStore.getState();
  const currentById = new Map(state.sdkSessions.map((session) => [session.sessionId, session]));
  const nextSessions = sessions.map((session) =>
    preserveCurrentNotificationStatus(session, currentById.get(session.sessionId)),
  );
  state.setSdkSessions(nextSessions);
  clearCachedActiveNotificationsForClearedStatuses(nextSessions);
}

export function applyNotificationStatusUpdate(sessionId: string, status: NotificationStatusSnapshot): boolean {
  if (!hasNotificationStatus(status)) return true;
  let applied = false;
  useStore.setState((state) => {
    const index = state.sdkSessions.findIndex((session) => session.sessionId === sessionId);
    if (index === -1) {
      if (isClearedNotificationStatus(status)) {
        const sessionNotifications = clearCachedActiveNotifications(state.sessionNotifications, sessionId);
        if (sessionNotifications !== state.sessionNotifications) return { sessionNotifications };
      }
      applied = true;
      return state;
    }
    const current = state.sdkSessions[index]!;
    if (isIncomingNotificationStatusStale(notificationStatusFromSession(current), status)) return state;
    const nextSession = applyNotificationStatus(current, status);
    const sessionNotifications = isClearedNotificationStatus(nextSession)
      ? clearCachedActiveNotifications(state.sessionNotifications, sessionId)
      : state.sessionNotifications;
    if (nextSession === current && sessionNotifications === state.sessionNotifications) {
      applied = true;
      return state;
    }
    const sdkSessions = state.sdkSessions.slice();
    sdkSessions[index] = nextSession;
    applied = true;
    return sessionNotifications === state.sessionNotifications
      ? { sdkSessions }
      : { sdkSessions, sessionNotifications };
  });
  return applied;
}

export function isClearedNotificationStatus(status: NotificationStatusSnapshot): boolean {
  return (
    status.activeNotificationCount === 0 &&
    (status.notificationStatusVersion !== undefined || status.notificationStatusUpdatedAt !== undefined)
  );
}

function hasActiveCachedNotifications(notifications: SessionNotification[] | undefined): boolean {
  return (
    notifications?.some((notification) => !notification.done && isActionableSessionNotification(notification)) ?? false
  );
}

function clearCachedActiveNotifications(
  sessionNotifications: Map<string, SessionNotification[]>,
  sessionId: string,
): Map<string, SessionNotification[]> {
  if (!hasActiveCachedNotifications(sessionNotifications.get(sessionId))) return sessionNotifications;
  const next = new Map(sessionNotifications);
  next.delete(sessionId);
  return next;
}

function clearCachedActiveNotificationsForClearedStatuses(sessions: SdkSessionInfo[]): void {
  const clearedSessionIds = sessions
    .filter((session) => isClearedNotificationStatus(notificationStatusFromSession(session)))
    .map((session) => session.sessionId);
  if (clearedSessionIds.length === 0) return;
  useStore.setState((state) => {
    let sessionNotifications = state.sessionNotifications;
    for (const sessionId of clearedSessionIds) {
      sessionNotifications = clearCachedActiveNotifications(sessionNotifications, sessionId);
    }
    if (sessionNotifications === state.sessionNotifications) return state;
    return { sessionNotifications };
  });
}

export function applySessionNotifications(
  sessionId: string,
  notifications: SessionNotification[],
  status: NotificationStatusSnapshot,
): boolean {
  const actionableNotifications = notifications.filter(isActionableSessionNotification);
  const incoming = summarizeNotificationStatus(actionableNotifications, status);
  let applied = false;
  useStore.setState((state) => {
    const sdkSession = state.sdkSessions.find((session) => session.sessionId === sessionId);
    if (isIncomingNotificationStatusStale(notificationStatusFromSession(sdkSession), incoming)) return state;

    const sessionNotifications = new Map(state.sessionNotifications);
    if (actionableNotifications.length === 0) sessionNotifications.delete(sessionId);
    else sessionNotifications.set(sessionId, actionableNotifications);

    const index = state.sdkSessions.findIndex((session) => session.sessionId === sessionId);
    if (index === -1) {
      applied = true;
      return { sessionNotifications };
    }
    const sdkSessions = state.sdkSessions.slice();
    sdkSessions[index] = applyNotificationStatus(sdkSessions[index]!, incoming);
    applied = true;
    return { sessionNotifications, sdkSessions };
  });
  return applied;
}
