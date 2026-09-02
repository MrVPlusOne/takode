import type { CodexOutboundTurn } from "../session-types.js";
import {
  isRecoveryContinuationTurn,
  markCodexTurnRecoveryActionRequired,
  markCodexTurnRecoveryHistoryPresence,
  markCodexTurnRecoveryOnDisconnect,
  markCodexTurnRecoveryOwnerActionRequired,
} from "./codex-interrupted-turn-recovery.js";
import { finalizeCodexBatchBrowserHistory } from "./codex-pending-input-history.js";
import { recordCodexHistoryMilestoneProof } from "./codex-recovery-diagnostics.js";
import { stageCodexTerminalHistoryReconciliation } from "./codex-history-incorporation.js";
import { advanceCodexTerminalHistoryReconciliation } from "./codex-terminal-history-reconciliation.js";
import type {
  CodexAdapterRecoveryLifecycleDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

export function reconcileRecoverableCodexTurnStartFailure(
  session: CodexRecoveryOrchestratorSessionLike,
  pending: CodexOutboundTurn,
  deps: CodexAdapterRecoveryLifecycleDeps,
): boolean {
  const history = pending.historyIncorporation;
  if (!history) return false;
  const recorded = history.recordedAt != null;
  finalizeCodexBatchBrowserHistory(session, pending, deps, recorded);

  const recoveryContinuation = isRecoveryContinuationTurn(session, pending);
  if (recoveryContinuation || history.attempt === 1) {
    const presence = recorded ? "present" : "unknown";
    pending.status = "recovery_pending";
    pending.turnTarget = null;
    pending.disconnectedAt = Date.now();
    pending.updatedAt = pending.disconnectedAt;
    pending.lastError = "turn/start acceptance is unknown; reconnecting before recovery";
    pending.terminalHistoryReconciliation = undefined;
    markCodexTurnRecoveryHistoryPresence(session, pending, presence, deps);
    markCodexTurnRecoveryOnDisconnect(session, pending, deps);
    recordCodexHistoryMilestoneProof(session, pending, "classified", {
      historyPresence: presence,
      classification: "turn_start_acceptance_unknown_reconnect",
    });
    if (!deps.requestCodexAutoRecovery(session, "turn_start_acceptance_unknown")) {
      if (recoveryContinuation) {
        markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
      } else {
        markCodexTurnRecoveryOwnerActionRequired(session, pending, "recovery_failed", deps);
      }
      deps.setGenerating(session, false, "codex_turn_start_recovery_unavailable");
    }
    deps.persistSession(session);
    return true;
  }

  const presence = recorded ? "present" : "unknown";
  const reason = recorded ? "turn_start_failed_after_history_receipt" : "turn_start_failed_before_history_receipt";
  stageCodexTerminalHistoryReconciliation(pending, {
    presence,
    reason,
    action: "continue",
    continuationMode: "verify_then_continue",
    classifiedAt: Date.now(),
  });
  recordCodexHistoryMilestoneProof(session, pending, "classified", {
    historyPresence: presence,
    classification: reason,
    continuationMode: "verify_then_continue",
  });
  advanceCodexTerminalHistoryReconciliation(session, deps);
  return true;
}
