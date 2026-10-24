import { create } from "zustand";

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
