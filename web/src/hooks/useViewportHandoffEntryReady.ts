import { useEffect, useMemo, useSyncExternalStore } from "react";
import {
  createViewportHandoffEntryId,
  getViewportHandoffClientVersion,
  getViewportHandoffSessionEntryStatus,
  getViewportHandoffThreadEntryStatus,
  loadViewportHandoffSession,
  loadViewportHandoffThread,
  subscribeViewportHandoffClient,
} from "../utils/viewport-handoff-client.js";

export interface ViewportHandoffEntryHookOptions {
  entryId?: string;
}

function useEntryId(explicitEntryId: string | undefined, entryScope: string): string {
  const generatedEntryId = useMemo(() => createViewportHandoffEntryId(), [entryScope]);
  return explicitEntryId?.trim() || generatedEntryId;
}

export function useViewportHandoffSessionEntryReady(
  sessionId: string | null | undefined,
  options: ViewportHandoffEntryHookOptions = {},
): boolean {
  const entryId = useEntryId(options.entryId, `session:${sessionId ?? "none"}`);
  useSyncExternalStore(subscribeViewportHandoffClient, getViewportHandoffClientVersion, () => 0);

  useEffect(() => {
    if (!sessionId) return;
    void loadViewportHandoffSession(sessionId, { entryId });
  }, [entryId, sessionId]);

  if (!sessionId) return true;
  const status = getViewportHandoffSessionEntryStatus(sessionId, entryId);
  return status === "ready" || status === "failed";
}

export function useViewportHandoffThreadEntryReady(
  sessionId: string | null | undefined,
  threadKey: string | null | undefined,
  options: ViewportHandoffEntryHookOptions = {},
): boolean {
  const entryId = useEntryId(options.entryId, `thread:${sessionId ?? "none"}:${threadKey ?? "none"}`);
  useSyncExternalStore(subscribeViewportHandoffClient, getViewportHandoffClientVersion, () => 0);

  useEffect(() => {
    if (!sessionId || !threadKey) return;
    void loadViewportHandoffThread(sessionId, threadKey, { entryId });
  }, [entryId, sessionId, threadKey]);

  if (!sessionId || !threadKey) return true;
  const status = getViewportHandoffThreadEntryStatus(sessionId, threadKey, entryId);
  return status === "ready" || status === "failed";
}
