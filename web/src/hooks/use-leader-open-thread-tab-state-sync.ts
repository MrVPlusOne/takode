import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { LeaderOpenThreadTabsState, LeaderThreadTabUpdate } from "../../shared/leader-open-thread-tabs.js";
import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import type { BoardRowData } from "../components/BoardTable.js";
import { clearOpenThreadTabKeys, readOpenThreadTabKeys } from "../utils/leader-open-thread-tabs.js";
import { prioritizeLeaderThreadKeysForFallback } from "../utils/leader-thread-tabs-navigation.js";

interface LeaderOpenThreadTabStateSyncOptions {
  sessionId: string;
  isLeaderSession: boolean;
  preview: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
  boardStateKnown: boolean;
  projectionState: "accepted" | "invalid-supplied" | "legacy";
  authoritativeState: LeaderOpenThreadTabsState | null | undefined;
  activeBoard: ReadonlyArray<BoardRowData>;
  projection: LeaderThreadTabsProjectionValue | null;
  openThreadTabKeysRef: MutableRefObject<string[]>;
  setOpenThreadTabKeys: Dispatch<SetStateAction<string[]>>;
  sendUpdate: (operation: LeaderThreadTabUpdate) => boolean;
}

function stringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function updateOpenThreadTabKeys(
  openThreadTabKeysRef: MutableRefObject<string[]>,
  setOpenThreadTabKeys: Dispatch<SetStateAction<string[]>>,
  nextKeys: string[],
): void {
  if (stringArraysEqual(openThreadTabKeysRef.current, nextKeys)) return;
  openThreadTabKeysRef.current = nextKeys;
  setOpenThreadTabKeys(nextKeys);
}

/** Keep authoritative tab state and one-time legacy fallback restoration from overwriting each other's event edges. */
export function useLeaderOpenThreadTabStateSync({
  sessionId,
  isLeaderSession,
  preview,
  connectionStatus,
  boardStateKnown,
  projectionState,
  authoritativeState,
  activeBoard,
  projection,
  openThreadTabKeysRef,
  setOpenThreadTabKeys,
  sendUpdate,
}: LeaderOpenThreadTabStateSyncOptions): void {
  const migratedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isLeaderSession) {
      updateOpenThreadTabKeys(openThreadTabKeysRef, setOpenThreadTabKeys, []);
      return;
    }
    const authoritativeKeys = authoritativeState?.orderedOpenThreadKeys;
    if (!authoritativeKeys) return;
    updateOpenThreadTabKeys(openThreadTabKeysRef, setOpenThreadTabKeys, authoritativeKeys);
    clearOpenThreadTabKeys(sessionId);
  }, [authoritativeState, isLeaderSession, openThreadTabKeysRef, sessionId, setOpenThreadTabKeys]);

  useEffect(() => {
    if (!isLeaderSession || authoritativeState) return;
    const restoredKeys = prioritizeLeaderThreadKeysForFallback(
      readOpenThreadTabKeys(sessionId),
      activeBoard,
      projection,
    );
    updateOpenThreadTabKeys(openThreadTabKeysRef, setOpenThreadTabKeys, restoredKeys);
  }, [
    activeBoard,
    authoritativeState,
    isLeaderSession,
    openThreadTabKeysRef,
    projection,
    sessionId,
    setOpenThreadTabKeys,
  ]);

  useEffect(() => {
    if (
      !isLeaderSession ||
      preview ||
      authoritativeState ||
      connectionStatus !== "connected" ||
      migratedSessionsRef.current.has(sessionId)
    ) {
      return;
    }
    const migrationAuthorityReady =
      (projectionState === "accepted" && projection?.tabState === null) ||
      (projectionState === "legacy" && boardStateKnown);
    if (!migrationAuthorityReady) return;

    const restoredKeys = prioritizeLeaderThreadKeysForFallback(
      readOpenThreadTabKeys(sessionId),
      activeBoard,
      projection,
    );
    if (restoredKeys.length === 0) return;
    const sent = sendUpdate({
      type: "migrate",
      orderedOpenThreadKeys: restoredKeys,
      migratedAt: Date.now(),
    });
    if (sent) migratedSessionsRef.current.add(sessionId);
  }, [
    activeBoard,
    authoritativeState,
    boardStateKnown,
    connectionStatus,
    isLeaderSession,
    preview,
    projection,
    projectionState,
    sendUpdate,
    sessionId,
  ]);
}
