import type { Hono } from "hono";
import type { BrowserIncomingMessage, ContentBlock, SessionNotification } from "../session-types.js";
import type { RouteContext } from "./context.js";

const SOURCE_CONTEXT_LIMIT = 1600;

export function registerSessionNotificationContextRoute(api: Hono, ctx: Pick<RouteContext, "resolveId" | "wsBridge">) {
  api.get("/sessions/:id/notifications/:notifId/context", (c) => {
    const sessionId = ctx.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);

    const session = ctx.wsBridge.getSession(sessionId);
    if (!session) return c.json({ error: "Session not found in bridge" }, 404);

    const notifId = c.req.param("notifId");
    const notification = session.notifications.find((entry) => entry.id === notifId);
    if (!notification) return c.json({ error: "Notification not found" }, 404);

    const message = findHistoryMessageById(session.messageHistory, notification.messageId);
    const context = buildNotificationSourceContext(notification, message);
    return c.json({
      ok: true,
      sessionId,
      notificationId: notification.id,
      messageId: notification.messageId,
      context,
    });
  });
}

export function buildNotificationSourceContext(
  notification: Pick<SessionNotification, "summary" | "questions" | "messageId">,
  message: BrowserIncomingMessage | undefined,
): string | null {
  if (!notification.messageId || !message || isStaleHerdTurnMessage(message)) return null;
  return normalizeNotificationSourceContext(extractMessageText(message), notification);
}

function findHistoryMessageById(
  history: readonly BrowserIncomingMessage[],
  messageId: string | null | undefined,
): BrowserIncomingMessage | undefined {
  if (!messageId) return undefined;
  return history.find((entry) => {
    if (entry.type === "assistant") return entry.message?.id === messageId;
    if (entry.type === "leader_user_message") return entry.id === messageId;
    if (entry.type === "user_message") return entry.id === messageId;
    return false;
  });
}

function isStaleHerdTurnMessage(message: BrowserIncomingMessage): boolean {
  return (
    message.type === "user_message" &&
    message.agentSource?.sessionId === "herd-events" &&
    !message.content.includes("| notification_needs_input")
  );
}

function extractMessageText(message: BrowserIncomingMessage): string {
  if (message.type === "assistant") return extractTextFromBlocks(message.message?.content ?? []);
  if (message.type === "leader_user_message" || message.type === "user_message") return message.content;
  return "";
}

function extractTextFromBlocks(blocks: readonly ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeNotificationSourceContext(
  rawText: string,
  notification: Pick<SessionNotification, "summary" | "questions">,
): string | null {
  const text = normalizeVisibleText(rawText);
  if (!text) return null;

  const compactText = compactForComparison(text);
  const duplicateCandidates = duplicateTextCandidates(notification);
  if (duplicateCandidates.some((candidate) => candidate === compactText)) return null;

  if (text.length <= SOURCE_CONTEXT_LIMIT) return text;
  return `${text.slice(0, SOURCE_CONTEXT_LIMIT).trimEnd()}...`;
}

function duplicateTextCandidates(notification: Pick<SessionNotification, "summary" | "questions">): string[] {
  const candidates = [notification.summary ?? "", ...(notification.questions?.map((question) => question.prompt) ?? [])]
    .map(normalizeVisibleText)
    .filter(Boolean);
  return candidates.flatMap((candidate) => [
    compactForComparison(candidate),
    compactForComparison(`Needs input: ${candidate}`),
  ]);
}

function normalizeVisibleText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compactForComparison(text: string): string {
  return normalizeVisibleText(text).replace(/\s+/g, " ").toLocaleLowerCase();
}
