import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../store.js";
import type { FeedViewportPosition } from "../utils/thread-viewport.js";
import { readLeaderViewportPosition } from "../utils/thread-viewport.js";
import { noteViewportDeliberateActivity } from "../utils/viewport-handoff-client.js";
import { retireSessionMessageRoute } from "../utils/routing.js";

export interface PendingExactViewportRestore {
  restoreKey: string;
  position: FeedViewportPosition;
}

export function useExactViewportRestore(
  restoredViewportRef: { current: { key: string; container: HTMLDivElement | null } | null },
  containerRef: { current: HTMLDivElement | null },
) {
  const pendingRef = useRef<PendingExactViewportRestore | null>(null);
  const cancel = useCallback(() => {
    const pending = pendingRef.current;
    if (pending) restoredViewportRef.current = { key: pending.restoreKey, container: containerRef.current };
    pendingRef.current = null;
  }, [containerRef, restoredViewportRef]);
  return [pendingRef, cancel] as const;
}

export function useUserViewportNavigationIntent(
  cancelPendingRestore: () => void,
  sessionId: string,
  threadKey: string,
) {
  return useCallback(() => {
    noteViewportDeliberateActivity(sessionId, threadKey);
    cancelPendingRestore();
    if (!retireSessionMessageRoute(sessionId, threadKey)) return;
    const store = useStore.getState();
    store.clearScrollToMessage(sessionId);
    store.clearPendingScrollToMessageId(sessionId);
    store.clearPendingScrollToMessageIndex(sessionId);
    store.clearExpandAllInTurn(sessionId);
  }, [cancelPendingRestore, sessionId, threadKey]);
}

export function useViewportBoundaryNavigation({
  cancelPendingRestore,
  containerRef,
  scrollToBottom,
}: {
  cancelPendingRestore: () => void;
  containerRef: { current: HTMLDivElement | null };
  scrollToBottom: () => void;
}) {
  const handleScrollToBottomClick = useCallback(() => {
    cancelPendingRestore();
    scrollToBottom();
  }, [cancelPendingRestore, scrollToBottom]);
  const handleScrollToTopClick = useCallback(() => {
    cancelPendingRestore();
    containerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [cancelPendingRestore, containerRef]);
  return [handleScrollToBottomClick, handleScrollToTopClick] as const;
}

export function useIdempotentState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initialState);
  const valueRef = useRef(value);
  valueRef.current = value;

  const setIfChanged = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const nextValue = typeof next === "function" ? (next as (current: T) => T)(valueRef.current) : next;
    if (Object.is(valueRef.current, nextValue)) return;
    valueRef.current = nextValue;
    setValue(nextValue);
  }, []);

  return [value, setIfChanged];
}

export function getSavedViewportRestoreKey(viewportKey: string, pos: FeedViewportPosition | null): string {
  if (!pos) return `${viewportKey}:latest`;
  return [
    viewportKey,
    pos.isAtBottom ? "bottom" : "position",
    pos.scrollTop,
    pos.scrollHeight,
    pos.anchorMessageId ?? "",
    pos.anchorTurnId ?? "",
    pos.anchorOffsetTop ?? "",
    pos.lastSeenContentBottom ?? "",
  ].join(":");
}

export function readSavedViewportPosition({
  sessionId,
  viewportKey,
  normalizedThreadKey,
  isLeaderSession,
}: {
  sessionId: string;
  viewportKey: string;
  normalizedThreadKey: string;
  isLeaderSession: boolean;
}): FeedViewportPosition | null {
  const memoryPosition = useStore.getState().feedScrollPosition.get(viewportKey) ?? null;
  if (!isLeaderSession) return memoryPosition;
  return readLeaderViewportPosition(sessionId, normalizedThreadKey) ?? memoryPosition;
}
