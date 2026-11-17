import { useEffect, useRef } from "react";
import type { ThreadWindowState } from "../types.js";

export function useSelectedThreadWindowRefresh(input: {
  activeThreadWindow: ThreadWindowState | null;
  connectionStatus: string;
  normalizedThreadKey: string;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number, targetMessageId?: string) => boolean;
  selectedFeedWindowEnabled: boolean;
  selectedThreadWindowNeedsRefresh: boolean;
  /**
   * The session's connection generation (bumped whenever its socket opens). A feed still without
   * a window asks again on each one: its last request may have been dropped while the session had
   * no socket, and a switch onto an already-open socket changes no connection status it could see.
   */
  threadWindowRefreshRevision: number;
  sessionId: string;
  targetMessageId?: string;
}): void {
  const refreshedSelectionScopeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!input.selectedFeedWindowEnabled) return;
    const selectionScope = `${input.sessionId}:${input.normalizedThreadKey}`;
    const selectionChanged = refreshedSelectionScopeRef.current !== selectionScope;
    refreshedSelectionScopeRef.current = selectionScope;

    // Unselected leader windows can become stale because live events are
    // intentionally filtered to the active socket view. Revalidate once per
    // real tab selection; unchanged windows return cheaply through hash sync.
    const selectionNeedsRevalidation =
      selectionChanged && (!input.activeThreadWindow || Boolean(input.activeThreadWindow.window_hash));
    if (input.activeThreadWindow && !input.selectedThreadWindowNeedsRefresh && !selectionNeedsRevalidation) return;
    input.requestThreadWindow(-1, undefined, input.targetMessageId);
  }, [
    input.activeThreadWindow,
    input.connectionStatus,
    input.normalizedThreadKey,
    input.requestThreadWindow,
    input.selectedFeedWindowEnabled,
    input.selectedThreadWindowNeedsRefresh,
    input.threadWindowRefreshRevision,
    input.sessionId,
    input.targetMessageId,
  ]);
}
