import { Activity, type ReactNode } from "react";

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
  return conversations.map(({ sessionId, view }) => (
    <Activity key={sessionId} mode={sessionId === visibleSessionId ? "visible" : "hidden"}>
      {view}
    </Activity>
  ));
}
