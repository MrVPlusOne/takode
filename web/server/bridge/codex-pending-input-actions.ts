import type { BrowserOutgoingMessage } from "../session-types.js";
import { markCodexAutoPauseRecoveryDiscarded } from "./codex-auto-pause-recovery-summary.js";
import { resolveCodexTurnRecoveryAction } from "./codex-interrupted-turn-recovery.js";
import { retryFailedCodexPendingInput } from "./codex-pending-input-retry.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

type PendingInputAction = Extract<
  BrowserOutgoingMessage,
  { type: "retry_pending_codex_input" | "cancel_pending_codex_input" | "resolve_codex_turn_recovery" }
>;

type PendingInputActionDeps = Pick<
  AdapterBrowserRoutingDeps,
  | "broadcastToBrowsers"
  | "clearQueuedTurnLifecycleEntries"
  | "getCancelablePendingCodexInputs"
  | "isCodexWorkerV2DeliveryFrozen"
  | "markRunningFromUserDispatch"
  | "persistSession"
  | "queueCodexPendingStartBatch"
  | "rebuildQueuedCodexPendingStartBatch"
  | "removePendingCodexInput"
  | "requestCodexAutoRecovery"
  | "sendToBrowser"
  | "trySteerPendingCodexInputs"
>;

export function handleCodexPendingInputAction(
  session: AdapterBrowserRoutingSessionLike,
  msg: BrowserOutgoingMessage,
  ws: unknown,
  deps: PendingInputActionDeps,
): boolean {
  if (session.backendType !== "codex" || !isPendingInputAction(msg)) return false;
  if (msg.type === "retry_pending_codex_input") {
    retryFailedCodexPendingInput(session, msg.id, deps);
    return true;
  }
  if (msg.type === "resolve_codex_turn_recovery") {
    resolveCodexTurnRecoveryAction(session, msg.recoveryId, deps);
    return true;
  }

  const pendingInput = session.pendingCodexInputs.find((input) => input.id === msg.id);
  if (!pendingInput?.cancelable) return true;
  if (pendingInput.deliveryState === "failed") {
    const removed = deps.removePendingCodexInput(session, msg.id);
    if (removed && ws) deps.sendToBrowser(ws, { type: "codex_pending_input_cancelled", input: removed });
    deps.persistSession(session);
    return true;
  }
  const cancelableHeadId = deps.getCancelablePendingCodexInputs(session)[0]?.id ?? null;
  const cancelledHeadPendingInput = cancelableHeadId === msg.id;
  markCodexAutoPauseRecoveryDiscarded(session, pendingInput.autoPauseRecoveries, Date.now(), deps);
  const activeTurnId = session.codexAdapter?.getCurrentTurnId() ?? null;
  session.pendingCodexTurns = activeTurnId
    ? session.pendingCodexTurns.filter((turn) => turn.turnId === activeTurnId)
    : session.pendingCodexTurns.filter((turn) => turn.status === "queued" && turn.turnId == null).slice(0, 1);
  deps.clearQueuedTurnLifecycleEntries(session);
  const removed = deps.removePendingCodexInput(session, msg.id);
  const remainingCancelableInputs = deps.getCancelablePendingCodexInputs(session);
  if (!activeTurnId && remainingCancelableInputs.length === 0) {
    session.pendingCodexTurns = [];
  } else if (remainingCancelableInputs.length > 0) {
    if (!activeTurnId && cancelledHeadPendingInput) {
      deps.queueCodexPendingStartBatch(session, "cancel_pending_codex_input");
    } else {
      deps.rebuildQueuedCodexPendingStartBatch(session);
    }
  }
  if (removed && ws) deps.sendToBrowser(ws, { type: "codex_pending_input_cancelled", input: removed });
  deps.persistSession(session);
  return true;
}

function isPendingInputAction(msg: BrowserOutgoingMessage): msg is PendingInputAction {
  return (
    msg.type === "retry_pending_codex_input" ||
    msg.type === "cancel_pending_codex_input" ||
    msg.type === "resolve_codex_turn_recovery"
  );
}
