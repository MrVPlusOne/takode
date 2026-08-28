import type { ActiveTurnRoute } from "../session-types.js";

export interface QueuedTurnLifecycleSessionLike {
  queuedTurnStarts: number;
  queuedTurnReasons: string[];
  queuedTurnUserMessageIds: number[][];
  queuedTurnInterruptSources: Array<"user" | "leader" | "system" | null>;
  queuedTurnActiveRoutes?: Array<ActiveTurnRoute | null>;
}

export interface QueuedTurnLifecycleEntry {
  reason: string;
  userMessageIds: number[];
  interruptSource: "user" | "leader" | "system" | null;
  activeTurnRoute: ActiveTurnRoute | null;
}

export function getQueuedTurnLifecycleEntries(session: QueuedTurnLifecycleSessionLike): QueuedTurnLifecycleEntry[] {
  return Array.from({ length: session.queuedTurnStarts }, (_, index) => ({
    reason: session.queuedTurnReasons[index] ?? "queued_user_message",
    userMessageIds: Array.isArray(session.queuedTurnUserMessageIds[index])
      ? [...session.queuedTurnUserMessageIds[index]!]
      : [],
    interruptSource: session.queuedTurnInterruptSources[index] ?? null,
    activeTurnRoute: session.queuedTurnActiveRoutes?.[index] ?? null,
  }));
}

export function replaceQueuedTurnLifecycleEntries(
  session: QueuedTurnLifecycleSessionLike,
  entries: QueuedTurnLifecycleEntry[],
): void {
  session.queuedTurnStarts = entries.length;
  session.queuedTurnReasons = entries.map((entry) => entry.reason);
  session.queuedTurnUserMessageIds = entries.map((entry) => [...entry.userMessageIds]);
  session.queuedTurnInterruptSources = entries.map((entry) => entry.interruptSource);
  session.queuedTurnActiveRoutes = entries.map((entry) => entry.activeTurnRoute);
}

export function clearRecoveredCodexGenerationIfIdle<Session extends { pendingCodexTurns: Array<{ status: string }> }>(
  session: Session,
  reason: string,
  deps: { setGenerating: (session: Session, generating: boolean, reason: string) => void },
): void {
  if (session.pendingCodexTurns.some((turn) => turn.status !== "completed")) return;
  deps.setGenerating(session, false, reason);
}
