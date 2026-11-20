import type { ChatMessage } from "../types.js";

export const NEEDS_INPUT_REMINDER_SOURCE_ID = "system:needs-input-reminder";

/**
 * A needs-input reminder Takode stored in the feed before Nov 19, 2026. The reminder now goes to the
 * leader with the user's message only, since the open questions it named already show as "Needs you"
 * items; feeds leave out the copies older history still holds.
 */
export function isStoredNeedsInputReminder(message: Pick<ChatMessage, "agentSource">): boolean {
  return message.agentSource?.sessionId === NEEDS_INPUT_REMINDER_SOURCE_ID;
}
