import type { ChatMessage } from "../types.js";

/** Ordinary chat-feed surfaces show only root-owned activity.
 * Native Codex child rows remain in authoritative stores for the inspector. */
export function isRootAgentFeedMessage(message: Pick<ChatMessage, "metadata">): boolean {
  return message.metadata?.codexSubagent == null;
}

export function filterRootAgentFeedMessages<T extends Pick<ChatMessage, "metadata">>(messages: readonly T[]): T[] {
  return messages.filter(isRootAgentFeedMessage);
}
