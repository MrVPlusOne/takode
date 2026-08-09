import { useCallback, useEffect, useRef } from "react";
import { FEED_WINDOW_SYNC_VERSION } from "../../shared/feed-window-sync.js";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import { getCachedHistoryWindowHash } from "../utils/history-window-cache.js";
import { sendToSession } from "../ws.js";

export function useMessageFeedBoundedConversation(input: {
  sessionId: string;
  connectionStatus: string | undefined;
  normalizedThreadKey: string;
  selectedFeedWindowEnabled: boolean;
  activeHistoryWindow: HistoryWindowState | null;
  activeThreadWindow: ThreadWindowState | null;
}): {
  historyWindowRevision: number;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
    targetMessageId?: string,
  ) => boolean;
} {
  const historyWindowRevisionRef = useRef<{ window: HistoryWindowState | null; revision: number }>({
    window: null,
    revision: 0,
  });
  if (historyWindowRevisionRef.current.window !== input.activeHistoryWindow) {
    historyWindowRevisionRef.current = {
      window: input.activeHistoryWindow,
      revision: historyWindowRevisionRef.current.revision + 1,
    };
  }

  const requestHistoryWindow = useCallback(
    (
      fromTurn: number,
      turnCount: number,
      sectionTurnCount: number,
      visibleSectionCount: number,
      targetMessageId?: string,
    ) => {
      const cachedWindowHash = getCachedHistoryWindowHash(input.sessionId, {
        fromTurn,
        turnCount,
        sectionTurnCount,
        visibleSectionCount,
      });
      return sendToSession(input.sessionId, {
        type: "history_window_request",
        from_turn: fromTurn,
        turn_count: turnCount,
        section_turn_count: sectionTurnCount,
        visible_section_count: visibleSectionCount,
        activate_view: true,
        feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
        ...(cachedWindowHash ? { cached_window_hash: cachedWindowHash } : {}),
        ...(targetMessageId ? { target_message_id: targetMessageId } : {}),
      });
    },
    [input.sessionId],
  );

  useEffect(() => {
    if (input.connectionStatus !== "connected") return;
    if (input.selectedFeedWindowEnabled) {
      if (!input.activeThreadWindow) return;
      sendToSession(input.sessionId, {
        type: "conversation_view_update",
        view: "thread",
        thread_key: input.normalizedThreadKey,
        from: input.activeThreadWindow.from_item,
        count: input.activeThreadWindow.item_count,
        section_count: input.activeThreadWindow.section_item_count,
        visible_count: input.activeThreadWindow.visible_item_count,
        cached_window_hash: input.activeThreadWindow.window_hash,
        feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
      });
      return;
    }
    if (!input.activeHistoryWindow) return;
    sendToSession(input.sessionId, {
      type: "conversation_view_update",
      view: "history",
      from: input.activeHistoryWindow.from_turn,
      count: input.activeHistoryWindow.turn_count,
      section_count: input.activeHistoryWindow.section_turn_count,
      visible_count: input.activeHistoryWindow.visible_section_count,
      cached_window_hash: input.activeHistoryWindow.window_hash,
      feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
    });
  }, [
    input.activeHistoryWindow,
    input.activeThreadWindow,
    input.connectionStatus,
    input.normalizedThreadKey,
    input.selectedFeedWindowEnabled,
    input.sessionId,
  ]);

  return {
    historyWindowRevision: historyWindowRevisionRef.current.revision,
    requestHistoryWindow,
  };
}
