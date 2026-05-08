import type { ChatMessage, ContentBlock, SessionNotification } from "../types.js";

const SOURCE_CONTEXT_LIMIT = 1600;

export function getNotificationTitle(notification: Pick<SessionNotification, "category" | "summary">): string {
  if (notification.summary?.trim()) return notification.summary.trim();
  if (notification.category === "needs-input") return "Needs your input";
  if (notification.category === "waiting") return "Waiting";
  return "Ready for review";
}

export function getNotificationSourceContext(
  notification: Pick<SessionNotification, "summary" | "questions" | "messageId">,
  messages: ReadonlyArray<ChatMessage>,
  sourceMessageId?: string | null,
): string | null {
  const messageId = sourceMessageId ?? notification.messageId;
  if (!messageId) return null;
  const message = messages.find((entry) => entry.id === messageId);
  if (!message) return null;
  return normalizeNotificationSourceContext(extractChatMessageText(message), notification);
}

export function normalizeNotificationSourceContext(
  rawText: string | null | undefined,
  notification: Pick<SessionNotification, "summary" | "questions">,
): string | null {
  if (!rawText) return null;
  const text = normalizeVisibleText(rawText);
  if (!text) return null;

  const compactText = compactForComparison(text);
  if (duplicateTextCandidates(notification).some((candidate) => candidate === compactText)) return null;

  if (text.length <= SOURCE_CONTEXT_LIMIT) return text;
  return `${text.slice(0, SOURCE_CONTEXT_LIMIT).trimEnd()}...`;
}

export function shouldShowNeedsInputQuestionPrompt({
  prompt,
  title,
  questionCount,
}: {
  prompt: string;
  title: string;
  questionCount: number;
}): boolean {
  if (questionCount !== 1) return true;
  return compactForComparison(prompt) !== compactForComparison(title);
}

function extractChatMessageText(message: ChatMessage): string {
  const content = message.content.trim();
  if (content) return content;
  return extractTextFromBlocks(message.contentBlocks ?? []);
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
