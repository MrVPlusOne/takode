import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import type { SessionNotification } from "../types.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

type NotificationThreadOwner = Pick<SessionNotification, "threadKey" | "questId">;

export function runAfterNotificationOwnerThreadSelected({
  notification,
  currentThreadKey,
  onSelectThread,
  action,
}: {
  notification: NotificationThreadOwner | null | undefined;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  action: () => void;
}) {
  if (notification && onSelectThread && !isNotificationOwnerSelected(notification, currentThreadKey)) {
    onSelectThread(resolveNotificationOwnerThreadKey(notification));
    setTimeout(action, 0);
    return;
  }
  action();
}

export function resolveNotificationOwnerThreadKey(notification: NotificationThreadOwner | null | undefined): string {
  const rawThreadKey = notification?.threadKey?.trim();
  if (rawThreadKey) return normalizeNotificationOwnerThreadKey(rawThreadKey);

  const questTarget = notification?.questId ? normalizeThreadTarget(notification.questId) : null;
  return questTarget?.threadKey ?? MAIN_THREAD_KEY;
}

export function isNotificationOwnerSelected(
  notification: NotificationThreadOwner | null | undefined,
  selectedThreadKey: string | undefined,
): boolean {
  const selected = normalizeThreadKey(selectedThreadKey ?? MAIN_THREAD_KEY);
  if (selected === ALL_THREADS_KEY) return false;
  return selected === resolveNotificationOwnerThreadKey(notification);
}

function normalizeNotificationOwnerThreadKey(rawThreadKey: string): string {
  const target = normalizeThreadTarget(rawThreadKey);
  return target?.threadKey ?? MAIN_THREAD_KEY;
}
