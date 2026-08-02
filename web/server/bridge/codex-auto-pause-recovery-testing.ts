import {
  getActiveCodexResultErrorAutoPause,
  isCodexAutoPauseRecoveryTesting,
} from "../codex-result-error-auto-pause.js";
import type { BrowserIncomingMessage, CodexOutboundTurn, SessionState } from "../session-types.js";
import type { UserDispatchTurnTarget } from "./generation-lifecycle.js";

export interface CodexAutoPauseRecoveryTestingSessionLike {
  state: Pick<SessionState, "codex_result_error_auto_pause">;
  pendingCodexTurns: CodexOutboundTurn[];
}

interface CodexAutoPauseRecoveryTestingDeps<S extends CodexAutoPauseRecoveryTestingSessionLike> {
  broadcastToBrowsers: (session: S, message: BrowserIncomingMessage) => void;
  persistSession: (session: S) => void;
}

export function broadcastCodexAutoPauseRecoveryTesting<S extends CodexAutoPauseRecoveryTestingSessionLike>(
  session: S,
  deps: Pick<CodexAutoPauseRecoveryTestingDeps<S>, "broadcastToBrowsers">,
): void {
  if (!getActiveCodexResultErrorAutoPause(session)) return;
  deps.broadcastToBrowsers(session, {
    type: "session_update",
    session: {
      codex_result_error_auto_pause_recovery_testing: isCodexAutoPauseRecoveryTesting(session),
    },
  });
}

export function markAcceptedCodexAutoPauseRecoveryDispatch<S extends CodexAutoPauseRecoveryTestingSessionLike>(
  session: S,
  pendingInputId: string,
  turnTarget: UserDispatchTurnTarget | null,
  deps: CodexAutoPauseRecoveryTestingDeps<S>,
): boolean {
  if (turnTarget !== "current" || !getActiveCodexResultErrorAutoPause(session)) return false;
  const turn = session.pendingCodexTurns.find(
    (candidate) =>
      (candidate.pendingInputIds ?? [candidate.userMessageId]).includes(pendingInputId) &&
      candidate.autoPauseSourceKind === "manual" &&
      (candidate.status === "dispatched" || candidate.status === "backend_acknowledged"),
  );
  if (!turn || turn.turnTarget === "queued") return false;
  turn.turnTarget = "current";
  broadcastCodexAutoPauseRecoveryTesting(session, deps);
  deps.persistSession(session);
  return true;
}
