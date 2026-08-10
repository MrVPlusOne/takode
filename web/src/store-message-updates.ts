import type { AppState } from "./store-types.js";
import type { ChatMessage } from "./types.js";

export function updateMessageAcrossSources(
  state: AppState,
  sessionId: string,
  messageId: string,
  updates: Partial<ChatMessage>,
): Partial<AppState> {
  const messages = new Map(state.messages);
  const list = messages.get(sessionId);
  let updatedFrozen = false;
  let canonicalChanged = false;
  const frozenCount = state.messageFrozenCounts.get(sessionId) ?? 0;
  const updated = list?.map((message, index) => {
    if (message.id !== messageId) return message;
    canonicalChanged = true;
    if (index < frozenCount) updatedFrozen = true;
    return { ...message, ...updates };
  });
  if (updated && canonicalChanged) messages.set(sessionId, updated);

  let threadWindowChanged = false;
  const threadWindowMessages = new Map(state.threadWindowMessages);
  const windows = threadWindowMessages.get(sessionId);
  if (windows) {
    const nextWindows = new Map(windows);
    for (const [threadKey, windowMessages] of windows) {
      let windowChanged = false;
      const nextMessages = windowMessages.map((message) => {
        if (message.id !== messageId) return message;
        windowChanged = true;
        return { ...message, ...updates };
      });
      if (windowChanged) {
        nextWindows.set(threadKey, nextMessages);
        threadWindowChanged = true;
      }
    }
    if (threadWindowChanged) threadWindowMessages.set(sessionId, nextWindows);
  }

  if (!canonicalChanged && !threadWindowChanged) return {};
  const result: Partial<AppState> = {
    ...(canonicalChanged ? { messages } : {}),
    ...(threadWindowChanged ? { threadWindowMessages } : {}),
  };
  if (!updatedFrozen) return result;
  const messageFrozenRevisions = new Map(state.messageFrozenRevisions);
  messageFrozenRevisions.set(sessionId, (messageFrozenRevisions.get(sessionId) ?? 0) + 1);
  return { ...result, messageFrozenRevisions };
}
