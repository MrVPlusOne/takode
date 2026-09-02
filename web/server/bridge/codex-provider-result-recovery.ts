import { classifyCodexResultError } from "../codex-result-error-auto-pause.js";
import {
  CODEX_OUTAGE_RECOVERY_RETRY_INTERVAL_MS,
  codexProviderResultReconnectRetryDelayMs,
  isCodexPersistentOutageRecoveryReason,
} from "../codex-process-reconnect.js";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import { createCodexHistoryIncorporation } from "./codex-history-incorporation.js";

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
      maxAttempts: number | null;
    }
  | {
      kind: "exhausted";
      family: RecoverableCodexProviderFailureFamily;
      attempts: number;
    };

export interface CodexProviderResultRecoverySessionLike {
  messageHistory: BrowserIncomingMessage[];
  pendingCodexTurns?: CodexOutboundTurn[];
  _frozenCount?: number;
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

  const coOwners = getProviderTurnCoOwners(
    session.pendingCodexTurns ?? (completedTurn ? [completedTurn] : []),
    completedTurn,
  );
  const priorAttempts = Math.max(0, ...coOwners.map((turn) => turn.providerRecoveryAttempts ?? 0));
  const persistentNetworkOutage = classified.family === "model_backend_stream_error";
  if (persistentNetworkOutage && hasNonRetryableProviderFailureEvidence(msg)) {
    return { kind: "none" };
  }
  if (!persistentNetworkOutage && priorAttempts >= CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS) {
    return {
      kind: "exhausted",
      family: classified.family,
      attempts: priorAttempts,
    };
  }
  return {
    kind: "recover",
    family: classified.family,
    retryTurn: coOwners.length > 0 && coOwners.every((turn) => isCodexTurnReplayProvablySafe(session, turn)),
    attempt: Math.min(Number.MAX_SAFE_INTEGER, priorAttempts + 1),
    maxAttempts: persistentNetworkOutage ? null : CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS,
  };
}

export function blocksAutomaticCodexTerminalHistoryContinuation(msg: CLIResultMessage): boolean {
  const classified = classifyCodexResultError(msg);
  if (classified?.family === "model_not_supported" || classified?.family === "copilot_auth_refresh_exhausted") {
    return true;
  }
  return hasNonRetryableProviderFailureEvidence(msg);
}

export function blocksAutomaticCodexResumeTurnRecovery(turn: { error: unknown }): boolean {
  const text = providerFailureEvidenceText(turn.error);
  if (!text) return false;
  return (
    hasNonRetryableProviderFailureText(text) ||
    /model_not_supported|requested model is not supported/i.test(text) ||
    /\bcancel(?:led|ed) by (?:the )?(?:user|operator)\b/i.test(text)
  );
}

export function isCodexTurnReplayProvablySafe(
  session: Pick<CodexProviderResultRecoverySessionLike, "messageHistory" | "_frozenCount">,
  turn: CodexOutboundTurn | null,
): boolean {
  if (turn?.historyTrackingUnknown) return false;
  if (turn?.providerReplayUnsafeActivityObserved) return false;
  if (!turn || turn.historyIndex < 0) return false;
  const localIndex = turn.historyIndex - Math.max(0, session._frozenCount ?? 0);
  if (localIndex < 0 || localIndex >= session.messageHistory.length) return false;
  const anchor = session.messageHistory[localIndex];
  if (anchor?.type !== "user_message" || anchor.id !== turn.userMessageId) return false;
  for (const entry of session.messageHistory.slice(localIndex + 1)) {
    if (entry.type === "assistant" || entry.type === "codex_reasoning_detail" || entry.type === "stream_event")
      return false;
    if (entry.type === "tool_result_preview" || entry.type === "tool_progress") return false;
    if (
      entry.type === "permission_request" ||
      entry.type === "permission_approved" ||
      entry.type === "permission_denied"
    )
      return false;
    if (entry.type === "task_notification") return false;
    if (entry.type === "result" && entry.data.codex_provider_retry?.ownerId !== turn.userMessageId) return false;
  }
  return true;
}

export function prepareCodexTurnsForProviderRecovery(
  session: Pick<CodexProviderResultRecoverySessionLike, "pendingCodexTurns">,
  completedTurn: CodexOutboundTurn,
  family: RecoverableCodexProviderFailureFamily,
  attempt: number,
  now = Date.now(),
): CodexOutboundTurn | null {
  const pendingTurns = session.pendingCodexTurns;
  if (!pendingTurns) return null;
  const coOwners = getProviderTurnCoOwners(pendingTurns, completedTurn);
  if (coOwners.length === 0 || coOwners.some((turn) => turn.adapterMsg.type !== "codex_start_pending")) return null;

  const canonical = coOwners[0]!;
  const pendingInputIds = unique(coOwners.flatMap((turn) => turn.pendingInputIds ?? [turn.userMessageId]));
  const inputById = new Map(
    coOwners.flatMap((turn) => {
      const adapterMsg = turn.adapterMsg;
      return adapterMsg.type === "codex_start_pending"
        ? adapterMsg.pendingInputIds.map((id, index) => [id, adapterMsg.inputs[index]] as const)
        : [];
    }),
  );
  if (pendingInputIds.some((id) => !inputById.get(id))) return null;
  const inputs = pendingInputIds.map((id) => inputById.get(id)!);
  const historyIndexes = coOwners.map((turn) => turn.historyIndex).filter((index) => index >= 0);
  const recoveryLinks = uniqueBy(
    coOwners.flatMap((turn) => turn.autoPauseRecoveryLinks ?? []),
    (link) => `${link.summaryId}\u0000${link.groupId}`,
  );

  const historyIncorporation = createCodexHistoryIncorporation(pendingInputIds);
  canonical.adapterMsg = {
    type: "codex_start_pending",
    pendingInputIds,
    inputs,
    clientUserMessageId: historyIncorporation.clientUserMessageId,
  };
  canonical.userMessageId = pendingInputIds[0] ?? canonical.userMessageId;
  canonical.pendingInputIds = pendingInputIds;
  canonical.userContent = coOwners
    .map((turn) => turn.userContent)
    .filter(Boolean)
    .join("\n\n");
  canonical.historyIndex = historyIndexes.length > 0 ? Math.min(...historyIndexes) : canonical.historyIndex;
  canonical.createdAt = Math.min(...coOwners.map((turn) => turn.createdAt));
  canonical.dispatchCount = Math.max(...coOwners.map((turn) => turn.dispatchCount));
  canonical.turnTarget = coOwners.some((turn) => turn.turnTarget === "current")
    ? "current"
    : coOwners.some((turn) => turn.turnTarget === "queued")
      ? "queued"
      : null;
  canonical.autoPauseSourceKind = coOwners.every((turn) => turn.autoPauseSourceKind === "manual")
    ? "manual"
    : "automatic";
  canonical.autoPauseRecoveryLinks = recoveryLinks.length > 0 ? recoveryLinks : undefined;
  canonical.historyIncorporation = historyIncorporation;

  prepareCodexTurnForProviderRecovery(canonical, family, attempt, now);
  const coOwnerSet = new Set(coOwners);
  session.pendingCodexTurns = pendingTurns.filter((turn) => turn === canonical || !coOwnerSet.has(turn));
  return canonical;
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
  turn.providerReplayUnsafeActivityObserved = undefined;
  turn.updatedAt = now;
  turn.acknowledgedAt = null;
  turn.turnId = null;
  turn.disconnectedAt = null;
  turn.resumeConfirmedAt = null;
  const attemptLabel =
    family === "model_backend_stream_error"
      ? `attempt ${attempt}`
      : `attempt ${attempt}/${CODEX_PROVIDER_RESULT_RECOVERY_MAX_ATTEMPTS}`;
  turn.lastError = `Takode is retrying this turn after recoverable provider failure ${family} (${attemptLabel}).`;
}

export function isCodexProviderResultRecoveryReason(reason: string): boolean {
  return reason.includes("provider_result:");
}

export function codexInitRecoveryRetryDelayMs(autoRecoveryReason: string, failures: number): number {
  if (isCodexPersistentOutageRecoveryReason(autoRecoveryReason)) {
    return CODEX_OUTAGE_RECOVERY_RETRY_INTERVAL_MS;
  }
  if (!isCodexProviderResultRecoveryReason(autoRecoveryReason)) {
    return Math.min(1_000 * failures, 10_000);
  }
  return codexProviderResultReconnectRetryDelayMs(failures);
}

function hasNonRetryableProviderFailureEvidence(msg: CLIResultMessage): boolean {
  return hasNonRetryableProviderFailureText([msg.result, ...(msg.errors ?? [])].filter(Boolean).join("\n"));
}

function hasNonRetryableProviderFailureText(text: string): boolean {
  return [
    /\b(?:http\s*)?401\b|\bunauthorized\b/i,
    /\b(?:http\s*)?403\b|\bforbidden\b/i,
    /invalid[_ -]?grant|tokenrefreshfailed|token[_ -]?expired|authentication(?:error| failed)/i,
    /invalid peer certificate|certificate (?:verify|verification) failed|tls certificate|ssl certificate/i,
  ].some((pattern) => pattern.test(text));
}

function providerFailureEvidenceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getProviderTurnCoOwners(
  pendingTurns: readonly CodexOutboundTurn[],
  completedTurn: CodexOutboundTurn | null,
): CodexOutboundTurn[] {
  if (!completedTurn) return [];
  if (!completedTurn.turnId) return [completedTurn];
  return pendingTurns.filter((turn) => turn.status !== "completed" && turn.turnId === completedTurn.turnId);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = key(value);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
