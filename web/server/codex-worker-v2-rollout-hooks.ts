import type { CodexWorkerV2CutoverState } from "./codex-worker-v2-cutover-state.js";

interface DeliveryGateSessionLike {
  isGenerating: boolean;
  interruptedDuringTurn: boolean;
  pendingPermissions: Map<unknown, unknown>;
  pendingCodexTurns: Array<{ status?: string }>;
  codexAdapter?: { getCurrentTurnId?: () => string | null } | null;
}

type SessionMetaBarrier = (sessionId: string, cliSessionId: string) => boolean | Promise<boolean>;
type ActivityHandler = (sessionId: string, reason: string) => void;

const deliveryGates = new Map<string, string>();
let sessionMetaBarrier: SessionMetaBarrier | null = null;
let activityHandler: ActivityHandler | null = null;

export function registerCodexWorkerV2RolloutHooks(handlers: {
  beforeSessionMetaDispatch: SessionMetaBarrier;
  onActivity: ActivityHandler;
}): () => void {
  sessionMetaBarrier = handlers.beforeSessionMetaDispatch;
  activityHandler = handlers.onActivity;
  return () => {
    if (sessionMetaBarrier === handlers.beforeSessionMetaDispatch) sessionMetaBarrier = null;
    if (activityHandler === handlers.onActivity) activityHandler = null;
  };
}

export function beginCodexWorkerV2DeliveryFreeze(
  sessionId: string,
  cutoverId: string,
  session: DeliveryGateSessionLike | null | undefined,
): boolean {
  if (!session) return false;
  const existing = deliveryGates.get(sessionId);
  if (existing && existing !== cutoverId) return false;
  deliveryGates.set(sessionId, cutoverId);
  const modelBoundDeliveryInFlight = session.pendingCodexTurns.some(
    (turn) => turn.status === "dispatched" || turn.status === "backend_acknowledged",
  );
  const safe =
    !session.isGenerating &&
    !session.interruptedDuringTurn &&
    session.pendingPermissions.size === 0 &&
    !session.codexAdapter?.getCurrentTurnId?.() &&
    !modelBoundDeliveryInFlight;
  if (!safe && !existing) deliveryGates.delete(sessionId);
  return safe;
}

export function releaseCodexWorkerV2DeliveryFreeze(sessionId: string, cutoverId: string): void {
  if (deliveryGates.get(sessionId) === cutoverId) deliveryGates.delete(sessionId);
}

export function isCodexWorkerV2DeliveryFrozen(
  sessionId: string,
  cutover: CodexWorkerV2CutoverState | null | undefined,
): boolean {
  if (deliveryGates.has(sessionId)) return true;
  return (
    cutover?.status === "prepared" ||
    cutover?.status === "staged" ||
    cutover?.status === "activating" ||
    cutover?.status === "rolling_back" ||
    cutover?.status === "rollback_failed"
  );
}

export function beforeCodexWorkerV2SessionMetaDispatch(
  sessionId: string,
  cliSessionId: string,
): boolean | Promise<boolean> {
  return sessionMetaBarrier ? sessionMetaBarrier(sessionId, cliSessionId) : true;
}

export function notifyCodexWorkerV2RolloutActivity(sessionId: string, reason: string): void {
  activityHandler?.(sessionId, reason);
}
