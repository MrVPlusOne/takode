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
}

export interface CodexAutoPauseRecoverySummary {
  family: "model_backend_stream_error" | "copilot_auth_refresh_exhausted";
  pausedAt: number;
  recoveryConfirmedAt: number;
  updatedAt: number;
  status: "releasing" | "settled";
  receipts: CodexAutoPauseRecoveryReceipt[];
}

export function isCodexAutoPauseRecoverySummaryFinal(summary: CodexAutoPauseRecoverySummary): boolean {
  return summary.receipts.every(
    (receipt) =>
      receipt.outcome !== "released_to_delivery" &&
      (receipt.outcome !== "delivered" || receipt.completedAt !== undefined),
  );
}
