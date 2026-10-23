import { useCallback, useRef } from "react";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import type { FeedViewportPosition } from "../utils/thread-viewport.js";
import { DEFAULT_VISIBLE_SECTION_COUNT } from "./message-feed-sections.js";

/**
 * Asks once for the window that holds a saved viewport anchor the loaded window lacks, and reports
 * whether that lookup is still pending. `clear` forgets the pending lookup, such as when the anchor
 * was restored or the feed moved to another thread.
 */
export function useViewportAnchorWindowRequest(input: {
  normalizedThreadKey: string;
  selectedFeedWindowEnabled: boolean;
  activeThreadWindow: ThreadWindowState | null;
  activeHistoryWindow: HistoryWindowState | null;
  sectionTurnCount: number;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number, targetMessageId?: string) => boolean;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
    targetMessageId?: string,
  ) => boolean;
}) {
  const pendingRef = useRef<{ key: string; window: ThreadWindowState | HistoryWindowState | null } | null>(null);
  const {
    normalizedThreadKey,
    selectedFeedWindowEnabled,
    activeThreadWindow,
    activeHistoryWindow,
    sectionTurnCount,
    requestThreadWindow,
    requestHistoryWindow,
  } = input;

  const request = useCallback(
    (pos: FeedViewportPosition, restoreKey: string) => {
      const targetMessageId = pos.anchorMessageId ?? pos.anchorTurnId;
      const useThreadWindow = selectedFeedWindowEnabled && activeThreadWindow;
      const useHistoryWindow = !selectedFeedWindowEnabled && activeHistoryWindow;
      if (!targetMessageId || (!useThreadWindow && !useHistoryWindow)) return false;

      const requestKey = `${normalizedThreadKey}:${restoreKey}:${targetMessageId}`;
      const resolvedWindow = useThreadWindow ? activeThreadWindow : activeHistoryWindow;
      // A refresh revision is not a reply identity: it may remain unchanged
      // across replies, or change for an unrelated update while lookup is pending.
      const pending = pendingRef.current;
      if (pending?.key === requestKey) {
        if (resolvedWindow === pending.window || resolvedWindow?.target_message_id !== targetMessageId) return true;
        pendingRef.current = null;
        return false;
      }
      const requested = useThreadWindow
        ? requestThreadWindow(-1, undefined, targetMessageId)
        : requestHistoryWindow(
            -1,
            activeHistoryWindow?.turn_count || sectionTurnCount * DEFAULT_VISIBLE_SECTION_COUNT,
            activeHistoryWindow?.section_turn_count ?? sectionTurnCount,
            activeHistoryWindow?.visible_section_count ?? DEFAULT_VISIBLE_SECTION_COUNT,
            targetMessageId,
          );
      if (!requested) return false;
      pendingRef.current = { key: requestKey, window: resolvedWindow };
      return true;
    },
    [
      activeHistoryWindow,
      activeThreadWindow,
      normalizedThreadKey,
      requestHistoryWindow,
      requestThreadWindow,
      sectionTurnCount,
      selectedFeedWindowEnabled,
    ],
  );
  const clear = useCallback(() => {
    pendingRef.current = null;
  }, []);
  return { request, clear };
}
