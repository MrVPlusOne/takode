import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { LeaderThreadTabUpdate } from "../../shared/leader-open-thread-tabs.js";
import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import { clearOpenThreadTabKeys, readOpenThreadTabKeys } from "../utils/leader-open-thread-tabs.js";
import { buildLeaderThreadMigrationKeys } from "../utils/leader-thread-tabs-navigation.js";

interface LeaderOpenThreadTabStateSyncOptions {
  sessionId: string;
  isLeaderSession: boolean;
  preview: boolean;
  connectionStatus: "connecting" | "connected" | "disconnected";
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

/** Mirror current projection state and perform only the accepted-null one-time browser-storage migration. */
export function useLeaderOpenThreadTabStateSync({
  sessionId,
  isLeaderSession,
  preview,
  connectionStatus,
  projection,
  openThreadTabKeysRef,
  setOpenThreadTabKeys,
  sendUpdate,
}: LeaderOpenThreadTabStateSyncOptions): void {
  const migratedSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isLeaderSession || !projection) {
      updateOpenThreadTabKeys(openThreadTabKeysRef, setOpenThreadTabKeys, []);
      return;
    }
    if (projection.tabState) {
      updateOpenThreadTabKeys(
        openThreadTabKeysRef,
        setOpenThreadTabKeys,
        projection.tabs.map((tab) => tab.threadKey),
      );
      clearOpenThreadTabKeys(sessionId);
      return;
    }

    const migrationKeys = buildLeaderThreadMigrationKeys(readOpenThreadTabKeys(sessionId), projection);
    updateOpenThreadTabKeys(openThreadTabKeysRef, setOpenThreadTabKeys, migrationKeys);
  }, [isLeaderSession, openThreadTabKeysRef, projection, sessionId, setOpenThreadTabKeys]);

  useEffect(() => {
    if (
      !isLeaderSession ||
      !projection ||
      projection.tabState ||
      preview ||
      connectionStatus !== "connected" ||
      migratedSessionsRef.current.has(sessionId)
    ) {
      return;
    }

    const migrationKeys = buildLeaderThreadMigrationKeys(readOpenThreadTabKeys(sessionId), projection);
    const sent = sendUpdate({
      type: "migrate",
      orderedOpenThreadKeys: migrationKeys,
      migratedAt: Date.now(),
    });
    if (sent) migratedSessionsRef.current.add(sessionId);
  }, [connectionStatus, isLeaderSession, preview, projection, sendUpdate, sessionId]);
}
