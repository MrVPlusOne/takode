import { useCallback, useEffect, useLayoutEffect, type MutableRefObject } from "react";
import { useStore } from "../store.js";
import {
  SAVE_THREAD_VIEWPORT_EVENT,
  type FeedViewportPosition,
  type ThreadViewportSnapshotDetail,
  persistLeaderViewportPosition,
  readLeaderViewportPosition,
} from "../utils/thread-viewport.js";
import { publishViewportHandoff } from "../utils/viewport-handoff-client.js";
import * as viewportAnchor from "./message-feed-viewport-anchor.js";
import { getRouteMessageTargetForThread } from "./message-feed-route-target.js";
import type { PendingExactViewportRestore } from "./message-feed-viewport-state.js";

export function useMessageFeedViewportPersistence({
  autoFollowEnabledRef,
  containerRef,
  exactRestoreRef,
  findVisibleFeedAnchor,
  getRealContentBottom,
  isLeaderSession,
  isNearBottom,
  lastSeenContentBottomRef,
  normalizedThreadKey,
  pendingScrollToMessageId,
  scrollToMessageId,
  sessionId,
  viewportKey,
}: {
  autoFollowEnabledRef: MutableRefObject<boolean>;
  containerRef: MutableRefObject<HTMLDivElement | null>;
  exactRestoreRef: MutableRefObject<PendingExactViewportRestore | null>;
  findVisibleFeedAnchor: (container: HTMLDivElement) => viewportAnchor.FeedViewportAnchor | null;
  getRealContentBottom: () => number | null;
  isLeaderSession: boolean;
  isNearBottom: MutableRefObject<boolean>;
  lastSeenContentBottomRef: MutableRefObject<number | null>;
  normalizedThreadKey: string;
  pendingScrollToMessageId: string | null | undefined;
  scrollToMessageId: string | null | undefined;
  sessionId: string;
  viewportKey: string;
}) {
  const persistFeedViewport = useCallback((): FeedViewportPosition | null => {
    const container = containerRef.current;
    if (!container) return null;
    const pendingExactRestore = exactRestoreRef.current;
    if (pendingExactRestore) {
      if (!viewportAnchor.isViewportAnchorAtSavedOffset(container, pendingExactRestore.position)) return null;
      exactRestoreRef.current = null;
    }
    const previousPosition =
      (isLeaderSession ? readLeaderViewportPosition(sessionId, normalizedThreadKey) : null) ??
      useStore.getState().feedScrollPosition.get(viewportKey);
    const currentRouteTargetId = getRouteMessageTargetForThread(normalizedThreadKey);
    const anchor =
      viewportAnchor.findVisiblePreviousAnchorForPersistence({
        container,
        previousAnchorId: previousPosition?.anchorMessageId ?? null,
        explicitTargetId: scrollToMessageId ?? pendingScrollToMessageId ?? currentRouteTargetId,
      }) ?? findVisibleFeedAnchor(container);
    const position: FeedViewportPosition = {
      scrollTop: Math.max(0, container.scrollTop),
      scrollHeight: Math.max(0, container.scrollHeight),
      isAtBottom: autoFollowEnabledRef.current && isNearBottom.current,
      anchorMessageId: anchor?.messageId ?? null,
      anchorTurnId: anchor?.turnId ?? null,
      anchorOffsetTop: anchor?.offsetTop,
      lastSeenContentBottom: lastSeenContentBottomRef.current ?? getRealContentBottom(),
    };
    useStore.getState().setFeedScrollPosition(viewportKey, position);
    if (isLeaderSession) persistLeaderViewportPosition(sessionId, normalizedThreadKey, position);
    return position;
  }, [
    autoFollowEnabledRef,
    containerRef,
    exactRestoreRef,
    findVisibleFeedAnchor,
    getRealContentBottom,
    isLeaderSession,
    isNearBottom,
    lastSeenContentBottomRef,
    normalizedThreadKey,
    pendingScrollToMessageId,
    scrollToMessageId,
    sessionId,
    viewportKey,
  ]);

  useLayoutEffect(() => () => void persistFeedViewport(), [persistFeedViewport]);

  useEffect(() => {
    const handleSnapshotRequest = (event: Event) => {
      const detail = (event as CustomEvent<ThreadViewportSnapshotDetail>).detail;
      if (!detail?.sessionId || detail.sessionId !== sessionId) return;
      if (detail.threadKey && detail.threadKey !== normalizedThreadKey) return;
      const position = persistFeedViewport();
      if (!detail.publishHandoff || !position) return;
      detail.pending.push(
        publishViewportHandoff(sessionId, normalizedThreadKey, position, {
          selectedThreadKey: detail.selectedThreadKey ?? normalizedThreadKey,
          keepalive: detail.keepalive,
          reason: detail.reason,
        }),
      );
    };
    window.addEventListener(SAVE_THREAD_VIEWPORT_EVENT, handleSnapshotRequest as EventListener);
    return () => window.removeEventListener(SAVE_THREAD_VIEWPORT_EVENT, handleSnapshotRequest as EventListener);
  }, [normalizedThreadKey, persistFeedViewport, sessionId]);

  return persistFeedViewport;
}
