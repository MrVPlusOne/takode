import type { ChatMessage, SessionNotification } from "../types.js";
import { parseHerdEvents } from "./herd-event-parser.js";

export function getActionableNotificationMessageId(
  notification: Pick<SessionNotification, "category" | "messageId">,
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "content" | "agentSource">> | undefined,
): string | null {
  if (!notification.messageId) return null;
  if (notification.category !== "needs-input") return notification.messageId;
  const anchor = messages?.find((message) => message.id === notification.messageId);
  if (!anchor) return notification.messageId;
  return isRelevantNeedsInputAnchor(anchor) ? notification.messageId : null;
}

export function sanitizeNotificationMessageTargets(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  messages: ReadonlyArray<Pick<ChatMessage, "id" | "content" | "agentSource">>,
): ReadonlyArray<SessionNotification> | undefined {
  if (!notifications || notifications.length === 0 || messages.length === 0) return notifications;
  let changed = false;
  const sanitized = notifications.map((notification) => {
    if (getActionableNotificationMessageId(notification, messages) === notification.messageId) return notification;
    changed = true;
    return { ...notification, messageId: null };
  });
  return changed ? sanitized : notifications;
}

function isRelevantNeedsInputAnchor(message: Pick<ChatMessage, "content" | "agentSource">): boolean {
  if (message.agentSource?.sessionId !== "herd-events") return true;
  const events = parseHerdEvents(message.content);
  if (events.length === 0) return true;
  return events.some((event) => event.header.includes("| notification_needs_input"));
}
