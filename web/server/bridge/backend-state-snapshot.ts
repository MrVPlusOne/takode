import type { CodexOutboundTurn, SessionState } from "../session-types.js";
import { getLiveCodexProviderRetryState } from "./codex-provider-retry-state.js";

export interface BackendStateSnapshotSessionLike {
  state: Pick<SessionState, "backend_error" | "backend_reconnect" | "codex_provider_retry">;
  pendingCodexTurns?: Array<Pick<CodexOutboundTurn, "userMessageId" | "status">>;
}

export interface BackendStateSnapshotDeps<Session extends BackendStateSnapshotSessionLike> {
  backendConnected: (session: Session) => boolean;
  deriveBackendState: (session: Session) => NonNullable<SessionState["backend_state"]>;
}

export function buildBackendStateSnapshot<Session extends BackendStateSnapshotSessionLike>(
  session: Session,
  deps: BackendStateSnapshotDeps<Session>,
): {
  backendConnected: boolean;
  backendState: NonNullable<SessionState["backend_state"]>;
  backendError: string | null;
  backendReconnect: SessionState["backend_reconnect"];
  codexProviderRetry: SessionState["codex_provider_retry"];
} {
  return {
    backendConnected: deps.backendConnected(session),
    backendState: deps.deriveBackendState(session),
    backendError: session.state.backend_error ?? null,
    backendReconnect: session.state.backend_reconnect ?? null,
    codexProviderRetry: getLiveCodexProviderRetryState(session),
  };
}
