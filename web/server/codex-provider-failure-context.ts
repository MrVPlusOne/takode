import type { CodexProviderFailureContext } from "./session-types.js";

const PROVIDER_FAILURE_STDERR_TAIL_LIMIT = 8_000;
const PROVIDER_FAILURE_CONTEXT_MAX_AGE_MS = 5 * 60 * 1000;

export interface CodexProviderFailureEvidenceState {
  stderrTail: string;
  recentContext: CodexProviderFailureContext | null;
}

export function createCodexProviderFailureEvidenceState(): CodexProviderFailureEvidenceState {
  return { stderrTail: "", recentContext: null };
}

export function recordCodexProviderFailureStderr(
  state: CodexProviderFailureEvidenceState,
  text: string,
  now = Date.now(),
): void {
  state.stderrTail = (state.stderrTail + text).slice(-PROVIDER_FAILURE_STDERR_TAIL_LIMIT);
  const normalized = state.stderrTail.toLowerCase();
  const refreshTokenInvalidated =
    normalized.includes("failed to refresh token") && normalized.includes("refresh token was already used");
  const refreshedTokenRejected =
    normalized.includes("http 401") && normalized.includes("could not parse your authentication token");
  if (!refreshTokenInvalidated && !refreshedTokenRejected) return;
  state.recentContext = { family: "copilot_auth_refresh_invalidated", observedAt: now };
}

export function providerFailureContextForResult(
  state: CodexProviderFailureEvidenceState,
  errorMessage: string | undefined,
  now = Date.now(),
): CodexProviderFailureContext | undefined {
  const context = state.recentContext;
  if (!context || !errorMessage || now - context.observedAt > PROVIDER_FAILURE_CONTEXT_MAX_AGE_MS) return undefined;
  const normalized = errorMessage.toLowerCase();
  if (!normalized.includes("model_not_supported") && !normalized.includes("requested model is not supported")) {
    return undefined;
  }
  return context;
}

export function clearCodexProviderFailureEvidence(state: CodexProviderFailureEvidenceState): void {
  state.stderrTail = "";
  state.recentContext = null;
}
