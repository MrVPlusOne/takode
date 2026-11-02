import { useEffect, useMemo } from "react";
import { api } from "../api.js";
import type { SessionAttentionRecord, SessionNotification } from "../types.js";
import { isAttentionRecordActive, parseQuestIdsFromReviewSummary } from "../utils/attention-records.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { readsWhenSeen } from "./use-unread-messages-seen.js";

/**
 * A thread's results that read when the thread itself is on screen, not when their message is: a
 * finished quest's result (its Quest complete card) and results an agent sent. Both the main view
 * and a side pane read them this way; a leader's answers and reports read when seen instead
 * (`useUnreadMessagesSeen`).
 */
export function useThreadResultsRead({
  sessionId,
  threadKey,
  notifications,
  attentionRecords,
  readWhenSeen,
  onScreen,
}: {
  sessionId: string;
  /** The thread whose results the view shows, or null when it shows none (a leader's Home). */
  threadKey: string | null;
  notifications: ReadonlyArray<SessionNotification> | undefined;
  attentionRecords: ReadonlyArray<SessionAttentionRecord>;
  /** A leader's view: its answers and reports are left to reading by seeing. */
  readWhenSeen: boolean;
  /** Whether the thread has been on screen long enough to count (`useThreadReadOnScreen`). */
  onScreen: boolean;
}): void {
  const ids = useMemo(
    () =>
      onScreen && threadKey
        ? reviewNotificationIdsForSelectedThread(notifications, attentionRecords, threadKey, readWhenSeen)
        : [],
    [attentionRecords, notifications, onScreen, readWhenSeen, threadKey],
  );
  useEffect(() => {
    for (const notificationId of ids) api.markNotificationDone(sessionId, notificationId, true).catch(console.error);
  }, [ids, sessionId]);
}

/** The thread whose results a leader's view shows: its leader log shows Main's, its Home none. */
export function leaderResultsThreadKey(viewKey: string): string | null {
  const key = normalizeThreadKey(viewKey);
  if (key === ALL_THREADS_KEY) return MAIN_THREAD_KEY;
  return key === MAIN_THREAD_KEY ? null : viewKey;
}

export function reviewNotificationIdsForSelectedThread(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  attentionRecords: ReadonlyArray<SessionAttentionRecord>,
  selectedThreadKey: string,
  /** A leader's answers and reports are read when seen (`useUnreadMessagesSeen`), not here. */
  readWhenSeen = false,
): string[] {
  const selected = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);
  if (selected === ALL_THREADS_KEY) return [];

  const effectiveThreadsByNotificationId = new Map<string, Set<string>>();
  for (const record of attentionRecords) {
    if (record.priority !== "review" || record.source.kind !== "notification" || !record.source.id) continue;
    if (!isAttentionRecordActive(record)) continue;
    const threadKey = normalizeThreadKey(record.route.threadKey || record.threadKey);
    const threads = effectiveThreadsByNotificationId.get(record.source.id) ?? new Set<string>();
    threads.add(threadKey);
    effectiveThreadsByNotificationId.set(record.source.id, threads);
  }

  const ids: string[] = [];
  for (const notification of notifications ?? []) {
    if (notification.done || notification.category !== "review") continue;
    if (readWhenSeen && readsWhenSeen(notification)) continue;
    const parsedMultiQuestThreads = parseQuestIdsFromReviewSummary(notification.summary);
    const effectiveThreads =
      parsedMultiQuestThreads.length > 1
        ? new Set(parsedMultiQuestThreads.map((threadKey) => normalizeThreadKey(threadKey)))
        : effectiveThreadsByNotificationId.get(notification.id);
    if (
      effectiveThreads ? !effectiveThreads.has(selected) : resolveNotificationOwnerThreadKey(notification) !== selected
    ) {
      continue;
    }
    ids.push(notification.id);
  }
  return ids;
}
