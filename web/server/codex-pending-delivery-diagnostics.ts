import type { BrowserOutgoingMessage, CodexOutboundTurn, PendingCodexInput } from "./session-types.js";

export type CodexPendingDeliveryBlockerReason =
  | "none"
  | "not_codex"
  | "session_generating"
  | "backend_not_connected"
  | "adapter_missing"
  | "adapter_disconnected"
  | "recovery_suppressed"
  | "broken"
  | "backend_recovering"
  | "active_turn_id_present"
  | "fresh_turn_required"
  | "stale_backend_ack_head"
  | "dispatched_head_pending_ack"
  | "queued_head_ready"
  | "unknown_head_state";

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

export interface CodexPendingDeliveryHeadSummary {
  type: BrowserOutgoingMessage["type"] | null;
  status: CodexOutboundTurn["status"] | null;
  turnId: string | null;
  turnTarget: CodexOutboundTurn["turnTarget"] | null;
  dispatchCount: number | null;
  pendingInputCount: number;
}

export interface CodexPendingDeliveryDiagnostics {
  pendingInputCount: number;
  pendingTurnCount: number;
  oldestPendingAgeMs: number | null;
  currentTurnId: string | null;
  backendState: string | null;
  adapterConnected: boolean | null;
  isGenerating: boolean;
  blockerReason: CodexPendingDeliveryBlockerReason;
  head: CodexPendingDeliveryHeadSummary | null;
}

export interface CodexPendingDeliveryDiagnosticsDetails extends CodexPendingDeliveryDiagnostics {
  pendingInputIds: string[];
  headPendingInputIds: string[];
  freshTurnRequiredUntilTurnId: string | null;
  proofSignals: CodexPendingDeliveryProofSignal[];
}

export interface CodexPendingDeliveryDiagnosticsSessionLike {
  backendType?: string | null;
  isGenerating: boolean;
  state: {
    backend_state?: string | null;
  };
  pendingCodexInputs: PendingCodexInput[];
  pendingCodexTurns: CodexOutboundTurn[];
  codexFreshTurnRequiredUntilTurnId?: string | null;
  codexPendingDeliveryProofSignals?: CodexPendingDeliveryProofSignal[];
  codexAdapter?: {
    getCurrentTurnId?: () => string | null;
    isConnected?: () => boolean;
  } | null;
}

const MAX_CODEX_PENDING_DELIVERY_PROOF_SIGNALS = 8;

function getHeadPendingInputIds(head: CodexOutboundTurn | null): string[] {
  if (!head) return [];
  return head.pendingInputIds ?? [head.userMessageId];
}

function summarizeHead(head: CodexOutboundTurn | null): CodexPendingDeliveryHeadSummary | null {
  if (!head) return null;
  return {
    type: head.adapterMsg.type,
    status: head.status,
    turnId: head.turnId ?? null,
    turnTarget: head.turnTarget ?? null,
    dispatchCount: head.dispatchCount ?? null,
    pendingInputCount: getHeadPendingInputIds(head).length,
  };
}

function classifyBlocker(input: {
  session: CodexPendingDeliveryDiagnosticsSessionLike;
  currentTurnId: string | null;
  adapterConnected: boolean | null;
  head: CodexOutboundTurn | null;
}): CodexPendingDeliveryBlockerReason {
  const { session, currentTurnId, adapterConnected, head } = input;
  const hasPendingWork = session.pendingCodexInputs.length > 0 || session.pendingCodexTurns.length > 0;
  if (session.backendType !== "codex") return "not_codex";
  if (!hasPendingWork) return "none";

  const backendState = session.state.backend_state ?? null;
  if (backendState === "recovery_suppressed") return "recovery_suppressed";
  if (backendState === "broken") return "broken";
  if (backendState === "recovering") return "backend_recovering";
  if (backendState !== "connected") return "backend_not_connected";
  if (!session.codexAdapter) return "adapter_missing";
  if (adapterConnected === false) return "adapter_disconnected";
  if (session.isGenerating) return "session_generating";
  if (currentTurnId) return "active_turn_id_present";
  if (session.codexFreshTurnRequiredUntilTurnId) return "fresh_turn_required";
  if (!head) return "none";
  if (head.status === "backend_acknowledged") return "stale_backend_ack_head";
  if (head.status === "dispatched") return "dispatched_head_pending_ack";
  if (head.status === "queued") return "queued_head_ready";
  return "unknown_head_state";
}

export function buildCodexPendingDeliveryDiagnostics(
  session: CodexPendingDeliveryDiagnosticsSessionLike,
  options?: { now?: number; details?: false },
): CodexPendingDeliveryDiagnostics;
export function buildCodexPendingDeliveryDiagnostics(
  session: CodexPendingDeliveryDiagnosticsSessionLike,
  options: { now?: number; details: true },
): CodexPendingDeliveryDiagnosticsDetails;
export function buildCodexPendingDeliveryDiagnostics(
  session: CodexPendingDeliveryDiagnosticsSessionLike,
  options: { now?: number; details?: boolean } = {},
): CodexPendingDeliveryDiagnostics | CodexPendingDeliveryDiagnosticsDetails {
  const now = options.now ?? Date.now();
  const currentTurnId = session.codexAdapter?.getCurrentTurnId?.() ?? null;
  const adapterConnected = session.codexAdapter ? (session.codexAdapter.isConnected?.() ?? null) : null;
  const head = session.pendingCodexTurns[0] ?? null;
  const oldestTimestamp = session.pendingCodexInputs.reduce<number | null>((oldest, input) => {
    if (typeof input.timestamp !== "number") return oldest;
    return oldest === null ? input.timestamp : Math.min(oldest, input.timestamp);
  }, null);
  const diagnostics: CodexPendingDeliveryDiagnostics = {
    pendingInputCount: session.pendingCodexInputs.length,
    pendingTurnCount: session.pendingCodexTurns.length,
    oldestPendingAgeMs: oldestTimestamp === null ? null : Math.max(0, now - oldestTimestamp),
    currentTurnId,
    backendState: session.state.backend_state ?? null,
    adapterConnected,
    isGenerating: session.isGenerating,
    blockerReason: classifyBlocker({ session, currentTurnId, adapterConnected, head }),
    head: summarizeHead(head),
  };

  if (!options.details) return diagnostics;

  return {
    ...diagnostics,
    pendingInputIds: session.pendingCodexInputs.map((input) => input.id),
    headPendingInputIds: getHeadPendingInputIds(head),
    freshTurnRequiredUntilTurnId: session.codexFreshTurnRequiredUntilTurnId ?? null,
    proofSignals: session.codexPendingDeliveryProofSignals ?? [],
  };
}

export function recordCodexPendingDeliveryProofSignal(
  session: { codexPendingDeliveryProofSignals?: CodexPendingDeliveryProofSignal[] },
  signal: Omit<CodexPendingDeliveryProofSignal, "timestamp"> & { timestamp?: number },
): void {
  const next: CodexPendingDeliveryProofSignal = {
    ...signal,
    timestamp: signal.timestamp ?? Date.now(),
  };
  const existing = session.codexPendingDeliveryProofSignals ?? [];
  session.codexPendingDeliveryProofSignals = [...existing, next].slice(-MAX_CODEX_PENDING_DELIVERY_PROOF_SIGNALS);
}
