import { useEffect, useRef } from "react";
import type { ChatMessage } from "../types.js";
import {
  useStore,
  getSessionSearchState,
  computeSessionSearchMatches,
  type SearchMatch,
  type SessionSearchCategory,
} from "../store.js";
import { normalizeForSearch } from "../../shared/search-utils.js";

/**
 * Hook that computes search matches whenever the query, mode, category, or messages change.
 * Writes results back to the store via setSessionSearchResults.
 *
 * Should be called once per active session (in ChatView).
 */
export function useSessionSearch(sessionId: string): void {
  const messages = useStore((s) => s.messages.get(sessionId));
  const searchState = useStore((s) => getSessionSearchState(s, sessionId));
  const setSearchResults = useStore((s) => s.setSessionSearchResults);

  const { query, mode, category, isOpen } = searchState;
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
      const matches = computeMatches(msgs, query, mode, category);
      setSearchResults(sessionId, matches);
    }, 200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, mode, category, isOpen, messages, sessionId, setSearchResults]);
}

/**
 * Compute which messages match the search query.
 * Returns one SearchMatch per matching message, in message order.
 */
function computeMatches(
  messages: Pick<ChatMessage, "id" | "content" | "role">[],
  query: string,
  mode: "strict" | "fuzzy",
  category: SessionSearchCategory = "all",
): SearchMatch[] {
  return computeSessionSearchMatches(messages, query, mode, category);
}

function messageMatchesCategory(role: ChatMessage["role"], category: SessionSearchCategory): boolean {
  return category === "all" || role === category;
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
  return words.every((word: string) => normalizedText.includes(word));
}

// Export pure functions for testing
export { computeMatches as _computeMatches, messageMatches as _messageMatches, messageMatchesCategory as _messageMatchesCategory };
