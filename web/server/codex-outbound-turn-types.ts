import type { CodexAutoPauseRecoveryLink } from "./codex-auto-pause-types.js";

export type CodexOutboundTurnStatus =
  | "queued"
  | "dispatched"
  | "backend_acknowledged"
  | "completed"
  | "blocked_broken_session";

export type CodexAutoPauseInputSourceKind = "manual" | "automatic";
export type CodexProviderFailureContextFamily = "copilot_auth_refresh_invalidated";
export type CodexProviderRecoveryFamily = "model_backend_stream_error" | CodexProviderFailureContextFamily;

export interface CodexProviderFailureContext {
  family: CodexProviderFailureContextFamily;
  observedAt: number;
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
}
