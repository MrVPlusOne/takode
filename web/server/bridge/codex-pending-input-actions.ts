import type { BrowserOutgoingMessage } from "../session-types.js";
import { clearCodexOutageRecoveryState } from "../codex-process-reconnect.js";
import { markCodexAutoPauseRecoveryDiscarded } from "./codex-auto-pause-recovery-summary.js";
import { resolveCodexTurnRecoveryAction } from "./codex-interrupted-turn-recovery.js";
import { retryFailedCodexPendingInput } from "./codex-pending-input-retry.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

type PendingInputAction = Extract<
  BrowserOutgoingMessage,
  {
    type:
      | "retry_pending_codex_input"
      | "cancel_pending_codex_input"
      | "resolve_codex_turn_recovery"
      | "release_codex_auto_paused_inputs";
  }
>;

type PendingInputActionDeps = Pick<
  AdapterBrowserRoutingDeps,
  | "broadcastToBrowsers"
  | "clearQueuedTurnLifecycleEntries"
  | "getCancelablePendingCodexInputs"
  | "isCodexWorkerV2DeliveryFrozen"
  | "markRunningFromUserDispatch"
  | "persistSession"
  | "persistHistoryMetadataRepair"
  | "refreshBrowserConversationViews"
  | "queueCodexPendingStartBatch"
  | "rebuildQueuedCodexPendingStartBatch"
  | "removePendingCodexInput"
  | "releaseCodexAutoPausedInputs"
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
  if (msg.type === "release_codex_auto_paused_inputs") {
    const release = deps.releaseCodexAutoPausedInputs?.(session, msg.pausedAt);
    if (release) {
      void release.catch((error) => {
        console.error("[codex-auto-pause] Failed explicit held-input release:", error);
      });
    }
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
  const recoveryUpdate = clearCodexOutageRecoveryState(session, { onlyIfTrackedOwnerMissing: true });
  if (recoveryUpdate) {
    if (session.state.backend_state === "recovering") {
      session.state.backend_state = "disconnected";
      session.state.backend_error = null;
      recoveryUpdate.backend_state = "disconnected";
      recoveryUpdate.backend_error = null;
    }
    deps.broadcastToBrowsers(session, { type: "session_update", session: recoveryUpdate });
  }
  deps.persistSession(session);
  return true;
}

function isPendingInputAction(msg: BrowserOutgoingMessage): msg is PendingInputAction {
  return (
    msg.type === "retry_pending_codex_input" ||
    msg.type === "cancel_pending_codex_input" ||
    msg.type === "resolve_codex_turn_recovery" ||
    msg.type === "release_codex_auto_paused_inputs"
  );
}
