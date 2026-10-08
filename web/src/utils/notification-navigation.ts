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
  notification: Pick<SessionNotification, "id" | "messageId" | "threadKey" | "questId">,
  sdkSessions: SdkSessionInfo[],
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
    });
    return;
  }

  navigateToSessionThread(sessionId, threadKey, false, routeSessionId, {
    preserveMainThreadRoute: true,
  });
}
