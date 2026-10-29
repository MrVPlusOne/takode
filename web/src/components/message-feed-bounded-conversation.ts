import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import {
  getHistoryWindowTurnCount,
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../../shared/history-window.js";
import { useStore } from "../store.js";
import { getCachedHistoryWindowHash } from "../utils/history-window-cache.js";
import { ALL_THREADS_KEY, isAllThreadsKey } from "../utils/thread-projection.js";
import { sendToSession } from "../ws.js";

/** Keep scroll handlers synchronous while making follow changes observable to subscriptions. */
export function useMessageFeedFollowState(initiallyFollowing: boolean) {
  const autoFollowEnabledRef = useRef(initiallyFollowing);
  const [followRevision, setFollowRevision] = useState(0);
  const setAutoFollowEnabled = useCallback((enabled: boolean) => {
    if (autoFollowEnabledRef.current === enabled) return;
    autoFollowEnabledRef.current = enabled;
    setFollowRevision((revision) => revision + 1);
  }, []);
  return { autoFollowEnabledRef, followRevision, setAutoFollowEnabled };
}

export function useMessageFeedBoundedConversation(input: {
  sessionId: string;
  connectionStatus: string | undefined;
  normalizedThreadKey: string;
  selectedFeedWindowEnabled: boolean;
  activeHistoryWindow: HistoryWindowState | null;
  activeThreadWindow: ThreadWindowState | null;
  autoFollowEnabledRef: { current: boolean };
  followRevision: number;
  /** A feed beside the main one never announces its window as this browser's view. */
  secondary?: boolean;
}): {
  historyWindowRevision: number;
  noteWindowRequest: (window: HistoryWindowState | ThreadWindowState | null) => void;
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
  const lastAnnouncementRef = useRef<string | null>(null);
  const requestedFromWindowRef = useRef<HistoryWindowState | ThreadWindowState | null | undefined>(undefined);
  const noteWindowRequest = useCallback((window: HistoryWindowState | ThreadWindowState | null) => {
    requestedFromWindowRef.current = window;
    lastAnnouncementRef.current = null;
  }, []);
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
      // The server sizes a latest window itself, so only the held window can match it.
      const cachedWindowHash =
        fromTurn < 0 && !targetMessageId && input.activeHistoryWindow?.window_hash
          ? input.activeHistoryWindow.window_hash
          : getCachedHistoryWindowHash(input.sessionId, { fromTurn, turnCount, sectionTurnCount, visibleSectionCount });
      const delivered = sendToSession(input.sessionId, {
        type: "history_window_request",
        from_turn: fromTurn,
        turn_count: turnCount,
        section_turn_count: sectionTurnCount,
        visible_section_count: visibleSectionCount,
        activate_view: true,
        ...(cachedWindowHash ? { cached_window_hash: cachedWindowHash } : {}),
        ...(targetMessageId ? { target_message_id: targetMessageId } : {}),
      });
      if (delivered) noteWindowRequest(input.activeHistoryWindow);
      return delivered;
    },
    [input.activeHistoryWindow, input.sessionId, noteWindowRequest],
  );

  const requestLatestHistoryWindow = useCallback(() => {
    const sectionTurnCount = input.activeHistoryWindow?.section_turn_count ?? HISTORY_WINDOW_SECTION_TURN_COUNT;
    const visibleSectionCount =
      input.activeHistoryWindow?.visible_section_count ?? HISTORY_WINDOW_VISIBLE_SECTION_COUNT;
    const turnCount = getHistoryWindowTurnCount(visibleSectionCount, sectionTurnCount);
    const delivered = requestHistoryWindow(-1, turnCount, sectionTurnCount, visibleSectionCount);
    // With no window held there is nothing to show yet; the arriving window ends the loading state.
    if (delivered && !input.activeHistoryWindow) useStore.getState().setHistoryLoading(input.sessionId, true);
    return delivered;
  }, [input.activeHistoryWindow, input.sessionId, requestHistoryWindow]);
  useAllThreadsWindowRefresh({
    enabled: isAllThreadsKey(input.normalizedThreadKey),
    connectionStatus: input.connectionStatus,
    sessionId: input.sessionId,
    requestLatestHistoryWindow,
  });

  useEffect(() => {
    if (input.secondary) return;
    if (input.connectionStatus !== "connected") {
      lastAnnouncementRef.current = null;
      requestedFromWindowRef.current = undefined;
      return;
    }
    const thread = input.selectedFeedWindowEnabled ? input.activeThreadWindow : null;
    const history = input.selectedFeedWindowEnabled ? null : input.activeHistoryWindow;
    if (!thread && !history) return;
    // An explicit request has activated its destination. Do not overwrite it
    // with the old applied window while waiting for a replacement delivery.
    if (requestedFromWindowRef.current === (thread ?? history)) return;
    requestedFromWindowRef.current = undefined;
    const sectionCount = thread?.section_item_count ?? history!.section_turn_count;
    const visibleCount = thread?.visible_item_count ?? history!.visible_section_count;
    // Read after layout: restoring an older viewport or aligning a local send
    // may have changed follow intent since this render began.
    const announcement = {
      type: "conversation_view_update" as const,
      view: thread ? ("thread" as const) : ("history" as const),
      ...(thread ? { thread_key: input.normalizedThreadKey } : {}),
      from: input.autoFollowEnabledRef.current ? -1 : (thread?.from_item ?? history!.from_turn),
      count: Math.max(thread?.item_count ?? history!.turn_count, sectionCount * visibleCount),
      section_count: sectionCount,
      visible_count: visibleCount,
      cached_window_hash: thread?.window_hash ?? history?.window_hash,
    };
    const signature = JSON.stringify([input.sessionId, announcement]);
    if (signature === lastAnnouncementRef.current) return;
    if (sendToSession(input.sessionId, announcement)) lastAnnouncementRef.current = signature;
  }, [
    input.activeHistoryWindow,
    input.activeThreadWindow,
    input.connectionStatus,
    input.normalizedThreadKey,
    input.selectedFeedWindowEnabled,
    input.sessionId,
    input.autoFollowEnabledRef,
    input.followRevision,
    input.secondary,
  ]);

  return {
    historyWindowRevision: historyWindowRevisionRef.current.revision,
    noteWindowRequest,
    requestHistoryWindow,
  };
}

/**
 * All Threads shows the session's history window, which nothing keeps current
 * while a thread tab is shown: the subscribe and live events follow the shown
 * view, so the held window may be missing or stale. Ask for the latest window
 * once each time All Threads is selected, unless the subscribe that opened it
 * already did; an unchanged window comes back as a small cache hit.
 */
function useAllThreadsWindowRefresh(input: {
  /** Only leader sessions have an All Threads view. */
  enabled: boolean;
  connectionStatus: string | undefined;
  sessionId: string;
  requestLatestHistoryWindow: () => boolean;
}): void {
  const refreshedSessionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!input.enabled) {
      refreshedSessionRef.current = null;
      return;
    }
    if (input.connectionStatus !== "connected" || refreshedSessionRef.current === input.sessionId) return;
    const subscribeRequestedIt =
      useStore.getState().pendingThreadWindowRequests.get(input.sessionId) === ALL_THREADS_KEY;
    if (subscribeRequestedIt || input.requestLatestHistoryWindow()) refreshedSessionRef.current = input.sessionId;
  }, [input.connectionStatus, input.enabled, input.requestLatestHistoryWindow, input.sessionId]);
}
