import { classifyCodexResultError } from "../codex-result-error-auto-pause.js";
import { codexProviderResultReconnectRetryDelayMs } from "../codex-process-reconnect.js";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";

export const CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS = 2;

export type RecoverableCodexProviderFailureFamily = "model_backend_stream_error" | "copilot_auth_refresh_invalidated";

export type CodexProviderResultRecoveryDecision =
  | { kind: "none" }
  | { kind: "terminal_model_not_supported" }
  | {
      kind: "recover";
      family: RecoverableCodexProviderFailureFamily;
      retryTurn: boolean;
      attempt: number;
    }
  | {
      kind: "exhausted";
      family: RecoverableCodexProviderFailureFamily;
      attempts: number;
    };

export interface CodexProviderResultRecoverySessionLike {
  messageHistory: BrowserIncomingMessage[];
}

export function decideCodexProviderResultRecovery(
  session: CodexProviderResultRecoverySessionLike,
  msg: CLIResultMessage,
  completedTurn: CodexOutboundTurn | null,
): CodexProviderResultRecoveryDecision {
  const classified = classifyCodexResultError(msg);
  if (!classified) return { kind: "none" };
  if (classified.family === "model_not_supported") {
    return { kind: "terminal_model_not_supported" };
  }
  if (classified.family !== "model_backend_stream_error" && classified.family !== "copilot_auth_refresh_invalidated") {
    return { kind: "none" };
  }

  const priorAttempts = completedTurn?.providerRecoveryAttempts ?? 0;
  if (priorAttempts >= CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS) {
    return { kind: "exhausted", family: classified.family, attempts: priorAttempts };
  }
  return {
    kind: "recover",
    family: classified.family,
    retryTurn: isCodexTurnReplayProvablySafe(session.messageHistory, completedTurn),
    attempt: priorAttempts + 1,
  };
}

export function isCodexTurnReplayProvablySafe(
  history: readonly BrowserIncomingMessage[],
  turn: CodexOutboundTurn | null,
): boolean {
  if (!turn || turn.historyIndex < 0 || turn.historyIndex >= history.length) return false;
  for (const entry of history.slice(turn.historyIndex + 1)) {
    if (entry.type === "assistant") return false;
    if (entry.type === "tool_result_preview") return false;
    if (entry.type === "permission_approved" || entry.type === "permission_denied") return false;
    if (entry.type === "task_notification") return false;
    if (entry.type === "result") return false;
  }
  return true;
}

export function prepareCodexTurnForProviderRecovery(
  turn: CodexOutboundTurn,
  family: RecoverableCodexProviderFailureFamily,
  attempt: number,
  now = Date.now(),
): void {
  turn.status = "queued";
  turn.providerRecoveryAttempts = attempt;
  turn.providerRecoveryFamily = family;
  turn.updatedAt = now;
  turn.acknowledgedAt = null;
  turn.turnId = null;
  turn.disconnectedAt = null;
  turn.resumeConfirmedAt = null;
  turn.lastError = `Takode is retrying this turn after recoverable provider failure ${family} (attempt ${attempt}/${CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS}).`;
}

export function isCodexProviderResultRecoveryReason(reason: string): boolean {
  return reason.includes("provider_result:");
}

export function codexInitRecoveryRetryDelayMs(autoRecoveryReason: string, failures: number): number {
  if (!isCodexProviderResultRecoveryReason(autoRecoveryReason)) {
    return Math.min(1_000 * failures, 10_000);
  }
  return codexProviderResultReconnectRetryDelayMs(failures);
}

export function clearCodexInitRecoveryRuntimeState(session: object): void {
  const runtime = session as {
    codexInitRetryTimer?: ReturnType<typeof setTimeout> | null;
    codexInitRecoveryFailures?: number;
    codexAutoRecoveryReason?: string | null;
  };
  if (runtime.codexInitRetryTimer) clearTimeout(runtime.codexInitRetryTimer);
  runtime.codexInitRetryTimer = null;
  runtime.codexInitRecoveryFailures = 0;
  runtime.codexAutoRecoveryReason = null;
}
