import type { BrowserIncomingMessage } from "../session-types.js";

const RECENT_HISTORY_SCAN_LIMIT = 128;

export function attachRecentHistoryIndex(
  messageHistory: ReadonlyArray<BrowserIncomingMessage>,
  message: BrowserIncomingMessage,
): BrowserIncomingMessage {
  if (Number.isInteger(message.history_index) && (message.history_index ?? -1) >= 0) return message;

  const lastIndex = messageHistory.length - 1;
  const firstIndex = Math.max(0, lastIndex - RECENT_HISTORY_SCAN_LIMIT + 1);
  for (let index = lastIndex; index >= firstIndex; index--) {
    if (messageHistory[index] === message) return { ...message, history_index: index };
  }
  return message;
}
