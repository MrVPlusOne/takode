import { useStore, getSessionSearchState } from "../store.js";
import { sessionSearchMessageMatchesCategory } from "../store-session-search.js";
import type { ChatMessage } from "../types.js";

export type SearchHighlightInfo = {
  query: string;
  mode: "strict" | "fuzzy";
  isCurrent: boolean;
} | null;

/** Derive search highlighting for one rendered message. */
export function useMessageSearchHighlight(sessionId: string | undefined, message: ChatMessage): SearchHighlightInfo {
  const query = useStore((state) => (sessionId ? getSessionSearchState(state, sessionId).query : ""));
  const mode = useStore((state) => (sessionId ? getSessionSearchState(state, sessionId).mode : ("strict" as const)));
  const category = useStore((state) => (sessionId ? getSessionSearchState(state, sessionId).category : "all"));
  const leaderSessionId = useStore((state) =>
    sessionId ? state.sdkSessions.find((sdk) => sdk.sessionId === sessionId)?.herdedBy : undefined,
  );
  const isCurrent = useStore((state) => {
    if (!sessionId) return false;
    const search = getSessionSearchState(state, sessionId);
    if (search.matches.length === 0 || search.currentMatchIndex < 0) return false;
    return search.matches[search.currentMatchIndex]?.messageId === message.id;
  });

  if (!sessionSearchMessageMatchesCategory(message, category, leaderSessionId)) return null;
  if (!query.trim()) return null;
  return { query, mode, isCurrent };
}
