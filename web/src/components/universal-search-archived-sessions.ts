import { useEffect, useState } from "react";
import { api, type SessionSearchResult } from "../api.js";
import type { SdkSessionInfo } from "../types.js";

/**
 * Archived sessions matching a Universal Search query, newest-ranked first.
 *
 * The browser only holds active sessions, so archived ones come from the
 * server's session search in metadata-only mode (name, #N, branch, folder,
 * keywords). Message content is deliberately not searched: over the archive
 * that scan blocks the server for about a second per query.
 */
export function useArchivedSessionMatches(query: string, enabled: boolean, leadersOnly: boolean): SdkSessionInfo[] {
  const [matches, setMatches] = useState<SdkSessionInfo[]>([]);
  const trimmed = query.trim();

  useEffect(() => {
    if (!enabled || !trimmed) {
      setMatches([]);
      return;
    }
    const controller = new AbortController();
    api
      .searchSessions(trimmed, {
        includeArchived: true,
        includeReviewers: false,
        leaderOnly: leadersOnly,
        matchMessages: false,
        signal: controller.signal,
      })
      .then((response) => {
        if (controller.signal.aborted) return;
        setMatches(response.results.flatMap(archivedSessionFromResult));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.warn("[universal-search] archived session search failed:", error);
        setMatches([]);
      });
    return () => controller.abort();
  }, [enabled, leadersOnly, trimmed]);

  return matches;
}

function archivedSessionFromResult(result: SessionSearchResult): SdkSessionInfo[] {
  return result.session?.archived ? [result.session] : [];
}
