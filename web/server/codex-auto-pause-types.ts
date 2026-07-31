export type CodexAutoPauseRecoveryOutcome =
  | "released_to_delivery"
  | "delivered"
  | "suppressed"
  | "discarded"
  | "failed";

export type CodexAutoPauseRecoveryReasonCode =
  | "manual_recovery_succeeded"
  | "codex_delivery_accepted"
  | "codex_delivery_completed"
  | "codex_delivery_recovered"
  | "codex_delivery_completed_with_error"
  | "stale_board_state"
  | "superseded_board_state"
  | "explicit_cancel"
  | "pending_input_too_large"
  | "delivery_pipeline_rejected"
  | "nonrecoverable_turn_start";

export type CodexAutoPauseRecoveryFinalityReason = "turn_interrupted_or_cancelled";

export interface CodexAutoPauseRecoveryLink {
  summaryId: string;
  groupId: string;
}

export interface CodexAutoPauseRecoveryReceipt {
  groupId: string;
  source: "browser" | "programmatic";
  sourceLabel: string;
  sourceDetail?: string;
  count: number;
  coalescedCount: number;
  survivingGroupId?: string;
  queuedAt: number;
  lastQueuedAt: number;
  releasedAt: number;
  outcome: CodexAutoPauseRecoveryOutcome;
  reasonCode: CodexAutoPauseRecoveryReasonCode;
  reason: string;
  terminalAt?: number;
  completedAt?: number;
  recovered?: boolean;
  completionError?: boolean;
  /** Delivery is immutable even though the backend turn did not complete normally. */
  finalizedAt?: number;
  finalityReason?: CodexAutoPauseRecoveryFinalityReason;
}

export interface CodexAutoPauseRecoverySummary {
  family: "model_backend_stream_error" | "copilot_auth_refresh_exhausted";
  pausedAt: number;
  recoveryConfirmedAt: number;
  updatedAt: number;
  status: "releasing" | "settled";
  receipts: CodexAutoPauseRecoveryReceipt[];
}

export const CODEX_AUTO_PAUSE_RECOVERY_SEARCH_MAX_LENGTH = 2_048;

export function buildCodexAutoPauseRecoverySearchText(summary: CodexAutoPauseRecoverySummary): string {
  const parts = ["automatic input recovery", `family:${summary.family}`, `status:${summary.status}`];
  for (let index = 0; index < summary.receipts.length; index++) {
    const receipt = summary.receipts[index]!;
    const interruptedFinality =
      receipt.finalizedAt !== undefined && receipt.finalityReason === "turn_interrupted_or_cancelled";
    const completion = interruptedFinality
      ? "interrupted_or_cancelled"
      : receipt.completionError
        ? "backend_error"
        : receipt.completedAt !== undefined
          ? receipt.recovered
            ? "recovered"
            : "completed"
          : "pending";
    const projection = [
      `source:${boundedSearchValue(receipt.sourceLabel, 64)}`,
      receipt.sourceDetail ? `detail:${boundedSearchValue(receipt.sourceDetail, 96)}` : "",
      `outcome:${receipt.outcome}`,
      `reason_code:${receipt.reasonCode}`,
      `reason:${boundedSearchValue(receipt.reason, 240)}`,
      `count:${Math.max(1, Math.floor(receipt.count))}`,
      `coalesced:${Math.max(0, Math.floor(receipt.coalescedCount))}`,
      `completion:${completion}`,
      interruptedFinality ? `finality_reason:${receipt.finalityReason}` : "",
      receipt.recovered ? "recovered:true" : "",
      receipt.survivingGroupId ? `survivor:${boundedSearchValue(receipt.survivingGroupId, 96)}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    const candidate = [...parts, projection].join(" | ");
    if (candidate.length > CODEX_AUTO_PAUSE_RECOVERY_SEARCH_MAX_LENGTH) {
      parts.push(`remaining_receipts:${summary.receipts.length - index}`);
      break;
    }
    parts.push(projection);
  }
  return boundedSearchValue(parts.join(" | "), CODEX_AUTO_PAUSE_RECOVERY_SEARCH_MAX_LENGTH);
}

export function isCodexAutoPauseRecoverySummaryFinal(summary: CodexAutoPauseRecoverySummary): boolean {
  return summary.receipts.every(
    (receipt) =>
      receipt.outcome !== "released_to_delivery" &&
      (receipt.outcome !== "delivered" ||
        receipt.completedAt !== undefined ||
        (receipt.finalizedAt !== undefined && receipt.finalityReason === "turn_interrupted_or_cancelled")),
  );
}

function boundedSearchValue(value: string, maxLength: number): string {
  return value
    .replace(
      /\b(authorization|api[-_ ]?key|bearer|access[-_ ]?token|refresh[-_ ]?token)\b(?:\s*[:=]\s*|\s+)[^\s|,;]+/giu,
      "$1 [redacted]",
    )
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maxLength);
}
