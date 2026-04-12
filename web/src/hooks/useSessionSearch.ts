import { useEffect, useRef } from "react";
import { useStore, getSessionSearchState, type SearchMatch } from "../store.js";
import { normalizeForSearch } from "../../shared/search-utils.js";

/**
 * Hook that computes search matches whenever the query, mode, or messages change.
 * Writes results back to the store via setSessionSearchResults.
 *
 * Should be called once per active session (in ChatView).
 */
export function useSessionSearch(sessionId: string): void {
  const messages = useStore((s) => s.messages.get(sessionId));
  const searchState = useStore((s) => getSessionSearchState(s, sessionId));
  const setSearchResults = useStore((s) => s.setSessionSearchResults);

  const { query, mode, isOpen } = searchState;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOpen || !query.trim()) {
      setSearchResults(sessionId, []);
      return;
    }

    // Debounce the computation
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const msgs = messages ?? [];
      const matches = computeMatches(msgs, query, mode);
      setSearchResults(sessionId, matches);
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, mode, isOpen, messages, sessionId, setSearchResults]);
}

/**
 * Compute which messages match the search query.
 * Returns one SearchMatch per matching message, in message order.
 */
function computeMatches(
  messages: { id: string; content: string }[],
  query: string,
  mode: "strict" | "fuzzy",
): SearchMatch[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const matches: SearchMatch[] = [];
  for (const msg of messages) {
    if (!msg.content) continue;
    if (messageMatches(msg.content, trimmed, mode)) {
      matches.push({ messageId: msg.id });
    }
  }
  return matches;
}

/** Check if a message's text matches the query in the given mode. */
function messageMatches(text: string, query: string, mode: "strict" | "fuzzy"): boolean {
  const normalizedText = normalizeForSearch(text);
  const normalizedQuery = normalizeForSearch(query);
  if (mode === "strict") {
    return normalizedText.includes(normalizedQuery);
  }
  // Fuzzy: all query words must be present
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return words.every((w) => normalizedText.includes(w));
}

// Export pure functions for testing
export { computeMatches as _computeMatches, messageMatches as _messageMatches };
