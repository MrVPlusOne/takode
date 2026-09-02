import type { CodexResumeSnapshot, CodexResumeTurnSnapshot } from "../codex-adapter.js";
import type { CodexOutboundTurn } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import {
  beginCodexHistoryAbsentReplay,
  chooseCodexRecoveryContinuationMode,
  inspectCodexHistoryIncorporation,
  markCodexHistoryRecorded,
  stageCodexTerminalHistoryReconciliation,
  summarizeHistoryCorrelatedLocalActivity,
  type CodexHistoryIncorporationEvidence,
} from "./codex-history-incorporation.js";
import { mergeCodexDeliveryActivity, summarizeCodexResumeDeliveryActivity } from "./codex-delivery-ownership.js";
import { blocksAutomaticCodexResumeTurnRecovery } from "./codex-provider-result-recovery.js";
import {
  clearCodexTurnRecoveryForOwner,
  hasFinalCodexOutcomeEvidence,
  isRecoveryContinuationTurn,
  markCodexTurnRecoveryActionRequired,
  markCodexTurnRecoveryHistoryPresence,
  resolveCodexTurnRecoveryRoute,
} from "./codex-interrupted-turn-recovery.js";
import { completeRecoveredCodexTurnWithDiagnostic } from "./codex-recovered-turn-diagnostic.js";
import { advanceCodexTerminalHistoryReconciliation } from "./codex-terminal-history-reconciliation.js";
import {
  clearRecoveredCodexGenerationIfIdle,
  rearmRecoveredQueuedHeadTurn,
  reconcileRecoveredQueuedTurnLifecycle,
} from "./codex-queued-turn-lifecycle.js";
import { recoverAgentMessagesFromResumedTurn } from "./codex-recovered-assistant-routing.js";
import type {
  CodexRecoveryOrchestratorDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

interface EvidenceAwareResumeActions {
  retryPendingTurn: (turn: CodexOutboundTurn, options?: { diagnoseDispatchFailure?: boolean }) => void;
  finalizeBatchHistory: (turn: CodexOutboundTurn, deliveryConfirmed: boolean) => void;
  recordHistoryMilestone: (
    turn: CodexOutboundTurn,
    milestone: string,
    details?: {
      historyPresence?: "present" | "absent" | "unknown";
      classification?: string;
      continuationMode?: "finish_response" | "verify_then_continue" | null;
    },
  ) => void;
}

export function reconcileEvidenceAwareCodexResume(
  session: CodexRecoveryOrchestratorSessionLike,
  pending: CodexOutboundTurn,
  snapshot: CodexResumeSnapshot,
  deps: CodexRecoveryOrchestratorDeps,
  actions: EvidenceAwareResumeActions,
): boolean {
  const evidence = inspectCodexHistoryIncorporation(snapshot, pending);
  if (!evidence) return false;
  const route = resolveCodexTurnRecoveryRoute(session, pending);
  actions.recordHistoryMilestone(pending, "classified", {
    historyPresence: evidence.presence,
    classification: evidence.reason,
  });

  prepareLaterTerminalBatches(session, pending, snapshot, deps, actions);

  if (findAutomaticRecoveryBlockingTurn(evidence)) {
    actions.finalizeBatchHistory(pending, evidence.presence === "present");
    stageCodexTerminalHistoryReconciliation(pending, {
      presence: evidence.presence,
      reason: "terminal_resume_snapshot_error",
      action: "action_required",
      continuationMode: null,
      classifiedAt: Date.now(),
    });
    actions.recordHistoryMilestone(pending, "automatic_recovery_blocked", {
      historyPresence: evidence.presence,
      classification: "terminal_resume_snapshot_error",
    });
    advanceCodexTerminalHistoryReconciliation(session, deps);
    return true;
  }

  if (evidence.turn && isActiveResume(evidence.turn, snapshot)) {
    if (evidence.presence === "present") {
      actions.finalizeBatchHistory(pending, true);
      if (markCodexHistoryRecorded(pending, "resume_snapshot", null)) {
        actions.recordHistoryMilestone(pending, "recorded");
      }
    }
    rearmActiveRecordedTurn(session, pending, evidence.turn, deps);
    return true;
  }

  if (evidence.presence === "absent") {
    if (!beginCodexHistoryAbsentReplay(pending)) {
      markCodexTurnRecoveryActionRequired(session, "recovery_failed", deps);
      return true;
    }
    markCodexTurnRecoveryHistoryPresence(session, pending, "absent", deps);
    actions.recordHistoryMilestone(pending, "replay_queued", {
      historyPresence: "absent",
      classification: evidence.reason,
    });
    console.warn(
      `[ws-bridge] Replaying proven-absent Codex input batch for session ${sessionTag(session.id)} ` +
        `(owner=${pending.userMessageId}, turn=${pending.turnId ?? "unknown"})`,
    );
    actions.retryPendingTurn(pending, { diagnoseDispatchFailure: true });
    return true;
  }

  if (evidence.presence === "unknown" || !evidence.turn) {
    actions.finalizeBatchHistory(pending, false);
    actions.recordHistoryMilestone(pending, "continuation_selected", {
      historyPresence: "unknown",
      classification: evidence.reason,
      continuationMode: "verify_then_continue",
    });
    completeRecoveredCodexTurnWithDiagnostic(
      session,
      pending,
      "codex_resume_history_unknown",
      "Codex history was incomplete, so Takode started a separate verification-first continuation instead of replaying the original input.",
      deps,
      {
        leaderDiagnosticRoute: route,
        leaderContinuationRoute: route,
        recoveryOwner: pending,
        continuationMode: "verify_then_continue",
        interruptSource: "system",
      },
    );
    return true;
  }

  actions.finalizeBatchHistory(pending, true);
  if (markCodexHistoryRecorded(pending, "resume_snapshot", null)) {
    actions.recordHistoryMilestone(pending, "recorded");
  }
  const correlatedTurn = turnFromReceipt(evidence.turn, evidence.receiptItemIndex);
  const localActivity = summarizeHistoryCorrelatedLocalActivity(session, pending);
  const recoveredAgentMessages = recoverAgentMessagesFromResumedTurn(session, correlatedTurn, pending, deps);
  const synthesizedToolResults = deps.synthesizeCodexToolResultsFromResumedTurn(session, correlatedTurn, pending);
  const observedActivity = mergeCodexDeliveryActivity(
    localActivity,
    summarizeCodexResumeDeliveryActivity(evidence.activityItems),
  );

  if (
    correlatedTurn.status === "completed" &&
    correlatedTurn.error == null &&
    hasFinalCodexOutcomeEvidence(correlatedTurn)
  ) {
    session.consecutiveAdapterFailures = 0;
    session.lastAdapterFailureAt = null;
    deps.completeCodexTurn(session, pending);
    clearCodexTurnRecoveryForOwner(session, pending.userMessageId, deps);
    const maybeRecovery = deps.handleRecoveredCodexAutoPauseSuccess(session, pending);
    if (maybeRecovery instanceof Promise) {
      void maybeRecovery.catch((error) => {
        console.error(`[ws-bridge] Failed recovered Codex auto-pause handoff for ${sessionTag(session.id)}:`, error);
      });
    }
    clearRecoveredCodexGenerationIfIdle(session, "codex_resume_recorded_complete", deps);
    reconcileRecoveredQueuedTurnLifecycle(session, "codex_resume_recorded_complete", deps);
    deps.dispatchQueuedCodexTurns(session, "codex_resume_recorded_complete");
    deps.maybeFlushQueuedCodexMessages(session, "codex_resume_recorded_complete");
    deps.persistSession(session);
    return true;
  }

  const recoveryContinuation = isRecoveryContinuationTurn(session, pending);
  const continuationMode = chooseCodexRecoveryContinuationMode({
    evidence,
    activity: observedActivity,
    omittedToolResultCount: synthesizedToolResults.omittedFromResumeSnapshotCount,
  });
  actions.recordHistoryMilestone(pending, "continuation_selected", {
    historyPresence: "present",
    classification: evidence.reason,
    continuationMode,
  });
  if (recoveredAgentMessages.count > 0 || synthesizedToolResults.count > 0) {
    session.consecutiveAdapterFailures = 0;
    session.lastAdapterFailureAt = null;
  }
  completeRecoveredCodexTurnWithDiagnostic(
    session,
    pending,
    "codex_resume_recorded_incomplete",
    continuationMode === "verify_then_continue"
      ? "Codex recorded the input, but prior effects need verification before the remaining work can continue."
      : "Codex recorded the input but ended before the response was complete.",
    deps,
    {
      leaderDiagnosticRoute: route,
      leaderContinuationRoute: recoveryContinuation ? null : route,
      recoveryOwner: pending,
      continuationMode,
      turnRecoveryActionRequired: recoveryContinuation ? "continuation_interrupted" : undefined,
      interruptSource: "system",
    },
  );
  return true;
}

function prepareLaterTerminalBatches(
  session: CodexRecoveryOrchestratorSessionLike,
  pending: CodexOutboundTurn,
  snapshot: CodexResumeSnapshot,
  deps: CodexRecoveryOrchestratorDeps,
  actions: EvidenceAwareResumeActions,
): void {
  if (!pending.turnId) return;
  const start = session.pendingCodexTurns.indexOf(pending);
  for (const candidate of session.pendingCodexTurns.slice(start + 1)) {
    if (
      candidate.turnId !== pending.turnId ||
      candidate.status === "completed" ||
      candidate.terminalHistoryReconciliation
    ) {
      continue;
    }
    const evidence = inspectCodexHistoryIncorporation(snapshot, candidate);
    const classifiedAt = Date.now();
    if (evidence && findAutomaticRecoveryBlockingTurn(evidence)) {
      actions.finalizeBatchHistory(candidate, evidence.presence === "present");
      stageCodexTerminalHistoryReconciliation(candidate, {
        presence: evidence.presence,
        reason: "terminal_resume_snapshot_error",
        action: "action_required",
        continuationMode: null,
        classifiedAt,
      });
      actions.recordHistoryMilestone(candidate, "automatic_recovery_blocked", {
        historyPresence: evidence.presence,
        classification: "terminal_resume_snapshot_error",
      });
      continue;
    }
    if (!evidence || evidence.presence === "unknown" || !evidence.turn) {
      actions.finalizeBatchHistory(candidate, false);
      stageCodexTerminalHistoryReconciliation(candidate, {
        presence: "unknown",
        reason: evidence?.reason ?? "invalid_tracking",
        action: "continue",
        continuationMode: "verify_then_continue",
        classifiedAt,
      });
      actions.recordHistoryMilestone(candidate, "classified", {
        historyPresence: "unknown",
        classification: evidence?.reason ?? "invalid_tracking",
        continuationMode: "verify_then_continue",
      });
      continue;
    }
    if (evidence.presence === "absent") {
      stageCodexTerminalHistoryReconciliation(candidate, {
        presence: "absent",
        reason: evidence.reason,
        action: "replay",
        continuationMode: null,
        classifiedAt,
      });
      actions.recordHistoryMilestone(candidate, "classified", {
        historyPresence: "absent",
        classification: evidence.reason,
      });
      continue;
    }

    actions.finalizeBatchHistory(candidate, true);
    if (markCodexHistoryRecorded(candidate, "resume_snapshot", null, classifiedAt)) {
      actions.recordHistoryMilestone(candidate, "recorded");
    }
    const correlatedTurn = turnFromReceipt(evidence.turn, evidence.receiptItemIndex);
    if (
      correlatedTurn.status === "completed" &&
      correlatedTurn.error == null &&
      hasFinalCodexOutcomeEvidence(correlatedTurn)
    ) {
      stageCodexTerminalHistoryReconciliation(candidate, {
        presence: "present",
        reason: evidence.reason,
        action: "complete",
        continuationMode: null,
        classifiedAt,
      });
      actions.recordHistoryMilestone(candidate, "classified", {
        historyPresence: "present",
        classification: evidence.reason,
      });
      continue;
    }
    const activity = mergeCodexDeliveryActivity(
      summarizeHistoryCorrelatedLocalActivity(session, candidate),
      summarizeCodexResumeDeliveryActivity(evidence.activityItems),
    );
    const continuationMode = chooseCodexRecoveryContinuationMode({ evidence, activity });
    stageCodexTerminalHistoryReconciliation(candidate, {
      presence: "present",
      reason: evidence.reason,
      action: "continue",
      continuationMode,
      classifiedAt,
    });
    actions.recordHistoryMilestone(candidate, "classified", {
      historyPresence: "present",
      classification: evidence.reason,
      continuationMode,
    });
  }
}

function isActiveResume(turn: CodexResumeTurnSnapshot, snapshot: CodexResumeSnapshot): boolean {
  return normalizeStatus(turn.status) === "inprogress" && normalizeStatus(snapshot.threadStatus) !== "idle";
}

function rearmActiveRecordedTurn(
  session: CodexRecoveryOrchestratorSessionLike,
  pending: CodexOutboundTurn,
  turn: CodexResumeTurnSnapshot,
  deps: CodexRecoveryOrchestratorDeps,
): void {
  pending.status = "backend_acknowledged";
  pending.turnId = turn.id;
  pending.resumeConfirmedAt = Date.now();
  pending.updatedAt = pending.resumeConfirmedAt;
  if (pending.requiresFreshSuccessor) {
    deps.armCodexFreshTurnRequirement(session, turn.id, "codex_recovery_continuation_resumed");
  }
  if (pending.turnTarget === "queued" && session.isGenerating) pending.turnTarget = "current";
  if (pending.turnTarget !== "queued" && !session.isGenerating) {
    pending.turnTarget = deps.markRunningFromUserDispatch(session, "codex_resume_recorded_in_progress");
  }
  rearmRecoveredQueuedHeadTurn(session, pending, "codex_resume_recorded_in_progress", deps);
  deps.persistSession(session);
}

function turnFromReceipt(turn: CodexResumeTurnSnapshot, receiptItemIndex: number | null): CodexResumeTurnSnapshot {
  return receiptItemIndex == null ? turn : { ...turn, items: turn.items.slice(receiptItemIndex) };
}

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.replace(/[_-]/g, "").toLowerCase() : "";
}

function findAutomaticRecoveryBlockingTurn(
  evidence: CodexHistoryIncorporationEvidence,
): CodexResumeTurnSnapshot | null {
  const candidates =
    evidence.candidateTurns.length > 0 ? evidence.candidateTurns : evidence.turn ? [evidence.turn] : [];
  return candidates.find((turn) => blocksAutomaticCodexResumeTurnRecovery(turn)) ?? null;
}
