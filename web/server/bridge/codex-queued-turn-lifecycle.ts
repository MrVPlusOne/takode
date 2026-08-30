import type { ActiveTurnRoute, CodexOutboundTurn } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import type { UserDispatchTurnTarget } from "./generation-lifecycle.js";

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

export interface RecoveredQueuedTurnSessionLike extends QueuedTurnLifecycleSessionLike {
  id: string;
  pendingCodexTurns: CodexOutboundTurn[];
  isGenerating: boolean;
}

export function reconcileRecoveredQueuedTurnLifecycle<Session extends RecoveredQueuedTurnSessionLike>(
  session: Session,
  reason: string,
  deps: { getCodexHeadTurn: (session: Session) => CodexOutboundTurn | null },
  options: { releasedHeadQueuedTurn?: boolean } = {},
): boolean {
  const previousEntries = getQueuedTurnLifecycleEntries(session);
  const nextEntries = previousEntries.map((entry) => ({
    reason: entry.reason,
    userMessageIds: [...entry.userMessageIds],
    interruptSource: entry.interruptSource,
    activeTurnRoute: entry.activeTurnRoute,
  }));
  let clearedQueuedHead = false;
  if (options.releasedHeadQueuedTurn && nextEntries.length > 0) nextEntries.shift();
  const liveTurns = session.pendingCodexTurns.filter((turn) => turn.status !== "completed");
  if (!session.isGenerating && liveTurns[0]?.turnTarget === "queued") {
    liveTurns[0].turnTarget = null;
    clearedQueuedHead = true;
    if (nextEntries.length > 0) nextEntries.shift();
  }
  const rebuiltEntries: QueuedTurnLifecycleEntry[] = [];
  let nextEntryIdx = 0;
  for (const turn of liveTurns) {
    const isExplicitQueuedTurn = turn.turnTarget === "queued";
    const isQueuedPendingBatchWithoutTarget =
      turn.status !== "dispatched" &&
      turn.status !== "backend_acknowledged" &&
      turn.turnTarget == null &&
      turn.adapterMsg.type === "codex_start_pending" &&
      turn.turnId == null;
    if (!isExplicitQueuedTurn && !(isQueuedPendingBatchWithoutTarget && nextEntryIdx < nextEntries.length)) continue;
    rebuiltEntries.push({
      reason: nextEntries[nextEntryIdx]?.reason ?? "queued_user_message",
      userMessageIds: nextEntries[nextEntryIdx]?.userMessageIds ?? (turn.historyIndex >= 0 ? [turn.historyIndex] : []),
      interruptSource: nextEntries[nextEntryIdx]?.interruptSource ?? null,
      activeTurnRoute: nextEntries[nextEntryIdx]?.activeTurnRoute ?? null,
    });
    nextEntryIdx += 1;
  }
  const lifecycleChanged =
    JSON.stringify(previousEntries) !== JSON.stringify(rebuiltEntries) ||
    clearedQueuedHead ||
    options.releasedHeadQueuedTurn === true;
  if (!lifecycleChanged) return false;
  replaceQueuedTurnLifecycleEntries(session, rebuiltEntries);
  console.log(
    `[ws-bridge] Reconciled queued-turn lifecycle for session ${sessionTag(session.id)} ` +
      `(${reason}, queued=${rebuiltEntries.length}${clearedQueuedHead ? ", cleared_head" : ""})`,
  );
  return true;
}

export function rearmRecoveredQueuedHeadTurn<Session extends RecoveredQueuedTurnSessionLike>(
  session: Session,
  pending: CodexOutboundTurn,
  reason: string,
  deps: {
    markRunningFromUserDispatch: (session: Session, reason: string) => UserDispatchTurnTarget;
    promoteNextQueuedTurn: (session: Session) => boolean;
    trackUserMessageForTurn: (session: Session, historyIndex: number, target: UserDispatchTurnTarget) => void;
  },
): void {
  if (session.isGenerating || pending.turnTarget === "current") return;
  if (pending.turnTarget === "queued" && deps.promoteNextQueuedTurn(session)) {
    pending.turnTarget = "current";
    console.log(
      `[ws-bridge] Re-armed recovered queued Codex turn for session ${sessionTag(session.id)} ` +
        `(${reason}, via_lifecycle_promotion)`,
    );
    return;
  }
  const target = deps.markRunningFromUserDispatch(session, reason);
  pending.turnTarget = target;
  if (pending.historyIndex >= 0) deps.trackUserMessageForTurn(session, pending.historyIndex, target);
  console.log(
    `[ws-bridge] Re-armed recovered queued Codex turn for session ${sessionTag(session.id)} ` +
      `(${reason}, via_running_guard)`,
  );
}
