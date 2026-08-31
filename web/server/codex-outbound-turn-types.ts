import type { CodexAutoPauseRecoveryLink } from "./codex-auto-pause-types.js";

export type CodexOutboundTurnStatus =
  | "queued"
  | "dispatched"
  | "backend_acknowledged"
  | "completed"
  | "blocked_broken_session";

export type CodexAutoPauseInputSourceKind = "manual" | "automatic";
export type CodexAutoPauseRecoveryProgress = "testing" | "active";
export type CodexResultErrorFamily =
  | "model_backend_stream_error"
  | "copilot_auth_refresh_exhausted"
  | "copilot_auth_refresh_invalidated"
  | "model_not_supported";
export type CodexProviderFailureContextFamily = "copilot_auth_refresh_invalidated";
export type CodexProviderRecoveryFamily = "model_backend_stream_error" | CodexProviderFailureContextFamily;
export type CodexOutageRecoveryFamily = "process_transport" | "model_backend_stream_error";

export type CodexTurnRecoveryStatus = "recovering" | "continuation_pending" | "continuation_active" | "action_required";
export type CodexTurnRecoveryReason =
  | "adapter_disconnect"
  | "interrupted_after_activity"
  | "continuation_dispatch_failed"
  | "continuation_interrupted"
  | "continuation_failed"
  | "recovery_timeout"
  | "recovery_failed";

export interface CodexTurnRecoveryState {
  recoveryId: string;
  originalOwnerId: string;
  originalProviderTurnId: string | null;
  originalHistoryIndex: number;
  continuationOwnerId: string | null;
  threadKey: string;
  questId?: string;
  status: CodexTurnRecoveryStatus;
  reason: CodexTurnRecoveryReason;
  raisedAttention?: boolean;
  attempt: number;
  maxAttempts: 1;
  createdAt: number;
  updatedAt: number;
}

export interface BackendReconnectProgress {
  /** One-based process launch attempt currently in flight or most recently exhausted. */
  attempt: number;
  /** Fixed process launch budget for this reconnect cycle. */
  maxAttempts: number;
  /** Server timestamp for the first process launch in this cycle. */
  cycleStartedAt: number;
  /** Exact pending owner that authorizes repeated outage recovery across inner cycles. */
  outageOwnerId?: string;
  /** Narrow recoverable family; absent for ordinary bounded reconnect cycles. */
  outageFamily?: CodexOutageRecoveryFamily;
}

export type CodexPendingDeliveryProofKind =
  | "resume_snapshot"
  | "turn_started"
  | "turn_steered"
  | "turn_steer_failed"
  | "turn_result";

export interface CodexPendingDeliveryProofSignal {
  kind: CodexPendingDeliveryProofKind;
  timestamp: number;
  turnId?: string | null;
  threadStatus?: string | null;
  turnStatus?: string | null;
  classification?: string | null;
  pendingInputCount?: number;
}

export interface CodexProviderFailureContext {
  family: CodexProviderFailureContextFamily;
  observedAt: number;
}

export interface CodexProviderRetryState {
  family: CodexProviderRecoveryFamily;
  ownerId: string;
  attempt: number;
  /** Null means this exact network-outage owner remains retryable until ineligible. */
  maxAttempts: number | null;
  startedAt: number;
}

export interface CodexOutboundTurnBase<TAdapterMessage> {
  adapterMsg: TAdapterMessage;
  userMessageId: string;
  pendingInputIds?: string[];
  userContent: string;
  historyIndex: number;
  status: CodexOutboundTurnStatus;
  dispatchCount: number;
  createdAt: number;
  updatedAt: number;
  acknowledgedAt: number | null;
  turnTarget: "current" | "queued" | null;
  lastError: string | null;
  turnId: string | null;
  disconnectedAt: number | null;
  resumeConfirmedAt: number | null;
  autoPauseSourceKind?: CodexAutoPauseInputSourceKind;
  autoPauseRecoveryLinks?: CodexAutoPauseRecoveryLink[];
  autoPauseRecoveryTestingRetired?: boolean;
  providerRecoveryAttempts?: number;
  providerRecoveryFamily?: CodexProviderRecoveryFamily;
  /** Durable proof that this provider turn emitted model/tool/permission/stream activity. */
  providerReplayUnsafeActivityObserved?: boolean;
}
