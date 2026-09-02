import {
  normalizeCodexHistoryIncorporation,
  normalizeCodexTerminalHistoryReconciliation,
} from "./codex-history-incorporation.js";

export function normalizePersistedCodexTurn(turn: any, now = Date.now()): any {
  const normalized = {
    ...turn,
    pendingInputIds:
      Array.isArray(turn.pendingInputIds) && turn.pendingInputIds.length > 0
        ? turn.pendingInputIds
        : [turn.userMessageId],
    historyIndex: turn.historyIndex ?? -1,
    status: turn.status ?? "queued",
    dispatchCount: turn.dispatchCount ?? 0,
    createdAt: turn.createdAt ?? now,
    updatedAt: turn.updatedAt ?? now,
    acknowledgedAt: turn.acknowledgedAt ?? null,
    turnTarget: null,
    lastError: turn.lastError ?? null,
  };
  const historyIncorporation = normalizeCodexHistoryIncorporation(normalized);
  const adapterClientUserMessageId =
    typeof normalized.adapterMsg?.clientUserMessageId === "string" && normalized.adapterMsg.clientUserMessageId.trim()
      ? normalized.adapterMsg.clientUserMessageId
      : null;
  const receiptTrackableBatch =
    normalized.adapterMsg?.type === "codex_start_pending" || normalized.adapterMsg?.type === "codex_steer_pending";
  const submittedWithoutValidTracking =
    !historyIncorporation &&
    (turn.historyIncorporation != null ||
      adapterClientUserMessageId != null ||
      normalized.status === "dispatched" ||
      normalized.status === "backend_acknowledged" ||
      normalized.status === "recovery_pending" ||
      normalized.dispatchCount > 0 ||
      (receiptTrackableBatch &&
        (typeof normalized.turnId === "string" || typeof normalized.acknowledgedAt === "number")));
  normalized.historyIncorporation = historyIncorporation;
  normalized.historyTrackingUnknown =
    turn.historyTrackingUnknown === true || submittedWithoutValidTracking ? true : undefined;
  normalized.requiresFreshSuccessor = turn.requiresFreshSuccessor === true ? true : undefined;
  normalized.terminalHistoryReconciliation = normalizeCodexTerminalHistoryReconciliation(
    turn.terminalHistoryReconciliation,
  );
  const cleanTrackedRedispatch =
    historyIncorporation != null &&
    historyIncorporation.providerTurnId == null &&
    historyIncorporation.rpcAcceptedAt == null &&
    historyIncorporation.recordedAt == null;
  const explicitProviderRetry =
    cleanTrackedRedispatch &&
    (normalized.providerRecoveryFamily === "model_backend_stream_error" ||
      normalized.providerRecoveryFamily === "copilot_auth_refresh_invalidated") &&
    Number.isInteger(normalized.providerRecoveryAttempts) &&
    normalized.providerRecoveryAttempts > 0 &&
    normalized.dispatchCount === normalized.providerRecoveryAttempts;
  const explicitAbsentReplay =
    cleanTrackedRedispatch && historyIncorporation?.attempt === 1 && normalized.dispatchCount === 1;
  if (
    historyIncorporation &&
    (normalized.status === "queued" || normalized.status === "blocked_broken_session") &&
    !explicitProviderRetry &&
    !explicitAbsentReplay &&
    (!cleanTrackedRedispatch || normalized.dispatchCount > 0)
  ) {
    normalized.status = "backend_acknowledged";
    normalized.turnId ??= historyIncorporation.providerTurnId;
    normalized.acknowledgedAt ??= historyIncorporation.rpcAcceptedAt;
  }
  const shouldStageUnknownRecovery =
    normalized.historyTrackingUnknown === true && normalized.status !== "backend_acknowledged";
  if (normalized.status === "recovery_pending" || shouldStageUnknownRecovery) {
    normalized.status = "recovery_pending";
    normalized.terminalHistoryReconciliation ??= {
      presence: "unknown",
      reason:
        normalized.historyTrackingUnknown === true
          ? "restored_history_tracking_unknown"
          : "invalid_restored_terminal_reconciliation",
      action: "continue",
      continuationMode: "verify_then_continue",
      classifiedAt: now,
    };
  } else if (normalized.terminalHistoryReconciliation) {
    normalized.status = "recovery_pending";
  }
  return normalized;
}
