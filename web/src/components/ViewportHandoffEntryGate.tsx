import type { ReactNode } from "react";
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
  return ready ? children : fallback;
}
