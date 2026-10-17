import type { SessionNotification } from "../types.js";

export function getSingleAnchoredNotification(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  messageId: string,
): SessionNotification | null {
  if (!notifications || notifications.length === 0) return null;

  let match: SessionNotification | null = null;
  for (const notification of notifications) {
    if (notification.messageId !== messageId) continue;
    if (isLeaderReadMarkerNotification(notification)) continue;
    if (match) return null;
    match = notification;
  }

  return match;
}

/**
 * Leader read markers only make a thread unread; they are not questions, so the
 * feed shows no chip for them. Tabs, attention lists and navigation still use them.
 * Covers today's answer, report and quest-completion markers and the retired
 * "Thread ready:" ones still stored in older sessions.
 */
export function isLeaderReadMarkerNotification(
  notification: Pick<SessionNotification, "category" | "summary" | "unreadReason">,
): boolean {
  if (notification.category !== "review") return false;
  return notification.unreadReason != null || /^\s*thread ready\s*:/i.test((notification.summary ?? "").trim());
}

/**
 * Messages carrying a notification. Read markers stay included: they keep their
 * message visible in a collapsed turn, so jumping to an unread result lands on it.
 */
export function collectAnchoredNotificationMessageIds(
  notifications: ReadonlyArray<Pick<SessionNotification, "messageId">> | undefined,
): string[] {
  if (!notifications || notifications.length === 0) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const notification of notifications) {
    if (!notification.messageId || seen.has(notification.messageId)) continue;
    seen.add(notification.messageId);
    ids.push(notification.messageId);
  }
  return ids;
}
