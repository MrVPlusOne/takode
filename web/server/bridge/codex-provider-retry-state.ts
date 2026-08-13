import type { CodexOutboundTurn, CodexProviderRetryState, SessionState } from "../session-types.js";

export type CodexProviderRetrySessionLike = {
  state: Pick<SessionState, "codex_provider_retry">;
  pendingCodexTurns?: Array<Pick<CodexOutboundTurn, "userMessageId" | "status">>;
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

export function getLiveCodexProviderRetryState(session: CodexProviderRetrySessionLike): CodexProviderRetryState | null {
  const current = session.state.codex_provider_retry ?? null;
  if (!current) return null;
  const owner = session.pendingCodexTurns?.find(
    (turn) => turn.userMessageId === current.ownerId && turn.status !== "completed",
  );
  return owner ? current : null;
}

/**
 * Retire only retry state whose exact owner no longer exists in the live turn
 * queue. Unrelated assistant/tool output is intentionally not a clearing signal.
 */
export function clearOrphanedCodexProviderRetryState(
  session: CodexProviderRetrySessionLike,
  broadcast: (state: CodexProviderRetryState | null) => void,
): boolean {
  const current = session.state.codex_provider_retry;
  if (!current || getLiveCodexProviderRetryState(session)) return false;
  session.state.codex_provider_retry = null;
  broadcast(null);
  return true;
}
