import { create } from "zustand";
import { navigateToSessionThread } from "./routing.js";

/**
 * Which quest tab of a leader shows its whole topic as one conversation instead of the quest
 * alone. Opened from the quest's strip or from a topic row in the Done list. Local UI state.
 */
const useTopicConversationState = create<{ open: Record<string, string> }>(() => ({ open: {} }));

export function openTopicConversation(sessionId: string, threadKey: string): void {
  useTopicConversationState.setState((state) => ({ open: { ...state.open, [sessionId]: threadKey.toLowerCase() } }));
}

export function closeTopicConversation(sessionId: string): void {
  useTopicConversationState.setState((state) => {
    const { [sessionId]: _closed, ...open } = state.open;
    return { open };
  });
}

/** The quest tab of this leader that shows its topic conversation, if any. */
export function useTopicConversationTab(sessionId: string): string | null {
  return useTopicConversationState((state) => state.open[sessionId] ?? null);
}

/**
 * Reads a topic's quests as one conversation: in the quest tab on screen when it is one of them,
 * otherwise in the tab of the topic's newest quest.
 */
export function readTopicConversation(sessionId: string, questIds: readonly string[], currentThreadKey: string): void {
  const current = currentThreadKey.toLowerCase();
  const questId = questIds.some((id) => id.toLowerCase() === current)
    ? current
    : [...questIds].sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))[0];
  if (!questId) return;
  navigateToSessionThread(sessionId, questId);
  openTopicConversation(sessionId, questId);
}
