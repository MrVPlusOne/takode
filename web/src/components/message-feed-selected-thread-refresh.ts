import { useEffect, useRef } from "react";
import type { ThreadWindowState } from "../types.js";

export function useSelectedThreadWindowRefresh(input: {
  activeThreadWindow: ThreadWindowState | null;
  connectionStatus: string;
  normalizedThreadKey: string;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number, targetMessageId?: string) => boolean;
  selectedFeedWindowEnabled: boolean;
  selectedThreadWindowNeedsRefresh: boolean;
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
    input.sessionId,
    input.targetMessageId,
  ]);
}
