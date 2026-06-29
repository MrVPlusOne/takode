import type { ChatMessage, SessionState, StarredMessageRecord } from "../types.js";

export function isStarActionableMessage(message: ChatMessage): boolean {
  if (!message.id || message.pendingState) return false;
  if (!hasStableStarMessageId(message)) return false;
  if (message.role === "user") return true;
  if (message.role !== "assistant") return false;
  if (message.metadata?.leaderUserMessage) return true;
  return assistantMessageHasBubbleContent(message);
}

export function isMessageStarred(session: SessionState | undefined, messageId: string | undefined): boolean {
  return Boolean(messageId && session?.starredMessages?.[messageId]);
}

export function getStarredMessageRecord(
  session: SessionState | undefined,
  messageId: string | undefined,
): StarredMessageRecord | undefined {
  return messageId ? session?.starredMessages?.[messageId] : undefined;
}

function assistantMessageHasBubbleContent(message: ChatMessage): boolean {
  if (message.content.trim()) return true;
  return (message.contentBlocks ?? []).some((block) => {
    if (block.type === "text") return block.text.trim().length > 0;
    if (block.type === "thinking") return block.thinking.trim().length > 0;
    return false;
  });
}

function hasStableStarMessageId(message: ChatMessage): boolean {
  if (message.metadata?.starStableMessageId === false) return false;
  if (message.role === "user" && /^hist-user-\d+$/.test(message.id)) return false;
  if (message.metadata?.leaderUserMessage && /^hist-leader-user-\d+$/.test(message.id)) return false;
  return true;
}
