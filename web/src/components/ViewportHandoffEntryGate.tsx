import { Fragment, useSyncExternalStore, type ReactNode } from "react";
import { getViewportHandoffEntryCorrection, subscribeViewportHandoffClient } from "../utils/viewport-handoff-client.js";
import {
  useViewportHandoffSessionEntryReady,
  useViewportHandoffThreadEntryReady,
} from "../hooks/useViewportHandoffEntryReady.js";

export function ViewportHandoffSessionEntryGate({
  sessionId,
  entryId,
  fallback = null,
  children,
}: {
  sessionId: string | null | undefined;
  entryId?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const ready = useViewportHandoffSessionEntryReady(sessionId, { entryId });
  return ready ? children : fallback;
}

export function ViewportHandoffThreadEntryGate({
  sessionId,
  threadKey,
  entryId,
  fallback = null,
  children,
}: {
  sessionId: string | null | undefined;
  threadKey: string | null | undefined;
  entryId?: string;
  fallback?: ReactNode;
  children: ReactNode;
}) {
  const ready = useViewportHandoffThreadEntryReady(sessionId, threadKey, { entryId });
  // A corrected held entry remounts the conversation so it restores the corrected position.
  const correction = useSyncExternalStore(subscribeViewportHandoffClient, () =>
    sessionId && threadKey ? getViewportHandoffEntryCorrection(sessionId, threadKey) : 0,
  );
  return ready ? <Fragment key={correction}>{children}</Fragment> : fallback;
}
