import { Activity, createContext, useContext, type ReactNode } from "react";

const ConversationShownContext = createContext(true);

/**
 * Whether the conversation this component belongs to is on screen; true outside kept views.
 * A hidden Activity hides its own DOM but not what its components portal elsewhere, such as a
 * full-screen viewer on document.body, so those must check this to leave with their conversation.
 */
export function useConversationShown(): boolean {
  return useContext(ConversationShownContext);
}

/**
 * Recently viewed conversations, kept mounted. Only `visibleSessionId` is shown; the others
 * stay in a hidden Activity, which keeps their DOM and state but runs none of their effects,
 * so a hidden conversation does nothing nobody can see and never counts as being viewed:
 * it marks nothing read, records no viewed tab and listens for nothing.
 */
export function KeptConversationViews({
  conversations,
  visibleSessionId,
}: {
  /** In a stable order: a kept view's DOM never moves, which could lose its scroll position. */
  conversations: ReadonlyArray<{ sessionId: string; view: ReactNode }>;
  visibleSessionId: string | null;
}) {
  return conversations.map(({ sessionId, view }) => {
    const shown = sessionId === visibleSessionId;
    return (
      <Activity key={sessionId} mode={shown ? "visible" : "hidden"}>
        <ConversationShownContext.Provider value={shown}>{view}</ConversationShownContext.Provider>
      </Activity>
    );
  });
}
