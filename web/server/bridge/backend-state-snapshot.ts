import type { SessionState } from "../session-types.js";

export interface BackendStateSnapshotSessionLike {
  state: Pick<SessionState, "backend_error" | "backend_reconnect">;
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
} {
  return {
    backendConnected: deps.backendConnected(session),
    backendState: deps.deriveBackendState(session),
    backendError: session.state.backend_error ?? null,
    backendReconnect: session.state.backend_reconnect ?? null,
  };
}
