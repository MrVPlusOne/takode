import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { useStore } from "../store.js";
import type { FeedViewportPosition } from "../utils/thread-viewport.js";
import { readLeaderViewportPosition } from "../utils/thread-viewport.js";

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
