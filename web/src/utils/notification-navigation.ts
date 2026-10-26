import type { MessageJumpLanding } from "../store-types.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import { attentionLedgerMessageIdForNotificationId } from "./attention-records.js";
import { resolveNotificationOwnerThreadKey } from "./notification-thread.js";
import { navigateToSessionMessageId, navigateToSessionThread, routeSessionRefForId } from "./routing.js";
import { MAIN_THREAD_KEY } from "./thread-projection.js";

/**
 * Open a notification's session on its owner thread and scroll to the card's anchor message.
 * Unanchored quest-thread prompts fall back to their attention-ledger row; unanchored Main
 * prompts just open the thread.
 */
export function navigateToNotification(
  sessionId: string,
  notification: Pick<SessionNotification, "id" | "messageId" | "threadKey" | "questId" | "unreadReason">,
  sdkSessions: SdkSessionInfo[],
  options: { topicView?: boolean } = {},
): void {
  const threadKey = resolveNotificationOwnerThreadKey(notification);
  const routeSessionId = routeSessionRefForId(sessionId, sdkSessions);
  const fallbackMessageId =
    !notification.messageId && threadKey !== MAIN_THREAD_KEY
      ? attentionLedgerMessageIdForNotificationId(notification.id)
      : null;
  const messageId = notification.messageId ?? fallbackMessageId;

  if (messageId) {
    navigateToSessionMessageId(sessionId, messageId, {
      routeSessionId,
      threadKey,
      preserveMainThreadRoute: true,
      landing: resultLanding(notification),
      ...(options.topicView ? { topicView: true } : {}),
    });
    return;
  }

  navigateToSessionThread(sessionId, threadKey, false, routeSessionId, {
    preserveMainThreadRoute: true,
  });
}

/**
 * The first result the user hasn't read yet among the open review notifications with an
 * anchor message that `inThread` accepts. Opening an unread thread lands here.
 *
 * Answers and reports come first, oldest first; a finished quest only when nothing else is
 * unread. The leader's answer after a quest completes is what the user waits for, and the
 * Quest complete card sits right above it, so landing on the answer shows both.
 */
export function firstUnreadResult<
  T extends Pick<SessionNotification, "category" | "done" | "messageId" | "timestamp" | "unreadReason">,
>(notifications: ReadonlyArray<T> | undefined, inThread: (notification: T) => boolean): T | null {
  let first: T | null = null;
  for (const notification of notifications ?? []) {
    if (notification.category !== "review" || notification.done || !notification.messageId) continue;
    if (!inThread(notification)) continue;
    if (!first || readsBefore(notification, first)) first = notification;
  }
  return first;
}

/**
 * Where opening a result lands. A finished quest's result is its Quest complete card, which is
 * not a message: its notification names the last message before the quest completed, often
 * the leader's commentary, so the jump lands on the card instead.
 */
export function resultLanding(notification: Pick<SessionNotification, "unreadReason">): MessageJumpLanding | undefined {
  return notification.unreadReason === "quest-complete" ? "quest-completion" : undefined;
}

type RankedResult = Pick<SessionNotification, "timestamp" | "unreadReason">;

function readsBefore(a: RankedResult, b: RankedResult): boolean {
  const aCompletion = a.unreadReason === "quest-complete";
  if (aCompletion !== (b.unreadReason === "quest-complete")) return !aCompletion;
  return a.timestamp < b.timestamp;
}
