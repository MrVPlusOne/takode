import { useEffect, useMemo } from "react";
import { api } from "../api.js";
import type { ChatMessage, SessionNotification } from "../types.js";
import type { FeedMessageModel } from "../utils/feed-render-model.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { isAllThreadsKey, isMainThreadKey, normalizeThreadKey } from "../utils/thread-projection.js";

/**
 * Ready results of other threads whose message this quest tab shows, such as an
 * answer posted in one quest tab that also appears in the tab where it was asked.
 * Reading a message in a quest tab reads it everywhere it appears, Main included.
 * The rule is one-way: Main and All Threads show many answers shared with quest
 * tabs, so seeing them there never clears another thread's result. Results the
 * selected tab owns are left to the owner-thread clearing in ChatView.
 */
export function sharedReviewNotificationIdsForThread(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  displayedMessages: ReadonlyArray<Pick<ChatMessage, "id">>,
  threadKey: string,
): string[] {
  const selected = normalizeThreadKey(threadKey);
  if (isMainThreadKey(selected) || isAllThreadsKey(selected) || !notifications?.length) return [];
  const displayedIds = new Set(displayedMessages.map((message) => message.id));
  return notifications
    .filter(
      (notification) =>
        notification.category === "review" &&
        !notification.done &&
        !!notification.messageId &&
        displayedIds.has(notification.messageId) &&
        resolveNotificationOwnerThreadKey(notification) !== selected,
    )
    .map((notification) => notification.id);
}

/** Mark the shared Ready results a quest tab's feed shows as read while `enabled`. */
export function useMarkSharedResultsRead(
  sessionId: string,
  threadKey: string,
  feed: Pick<FeedMessageModel, "displayNotifications" | "messages">,
  enabled: boolean,
): void {
  const { displayNotifications, messages } = feed;
  const idsKey = useMemo(
    () => (enabled ? sharedReviewNotificationIdsForThread(displayNotifications, messages, threadKey).join("\n") : ""),
    [displayNotifications, enabled, messages, threadKey],
  );
  useEffect(() => {
    if (!idsKey) return;
    for (const notificationId of idsKey.split("\n")) {
      api.markNotificationDone(sessionId, notificationId, true).catch(console.error);
    }
  }, [idsKey, sessionId]);
}
