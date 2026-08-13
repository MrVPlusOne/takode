import type { CodexProviderRetryState, SessionState } from "../session-types.js";

export type CodexProviderRetrySessionLike = {
  state: Pick<SessionState, "codex_provider_retry">;
};

export function setCodexProviderRetryState(
  session: CodexProviderRetrySessionLike,
  state: CodexProviderRetryState,
  broadcast: (state: CodexProviderRetryState | null) => void,
): CodexProviderRetryState {
  const current = session.state.codex_provider_retry;
  const next = {
    ...state,
    startedAt: current?.ownerId === state.ownerId ? current.startedAt : state.startedAt,
  };
  session.state.codex_provider_retry = next;
  broadcast(next);
  return next;
}

export function clearCodexProviderRetryState(
  session: CodexProviderRetrySessionLike,
  ownerId: string | null | undefined,
  broadcast: (state: CodexProviderRetryState | null) => void,
): boolean {
  const current = session.state.codex_provider_retry;
  if (!current || !ownerId || current.ownerId !== ownerId) return false;
  session.state.codex_provider_retry = null;
  broadcast(null);
  return true;
}
