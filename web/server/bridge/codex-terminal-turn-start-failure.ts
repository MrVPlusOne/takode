import type { BrowserOutgoingMessage } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import type { TurnStartFailureInfo } from "./adapter-interface.js";
import { markCodexAutoPauseRecoveryFailed } from "./codex-auto-pause-recovery-summary.js";
import { isRecoveryContinuationTurn, markCodexTurnRecoveryActionRequired } from "./codex-interrupted-turn-recovery.js";
import type {
  CodexAdapterRecoveryLifecycleDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

type CodexRecoveryAdapterLike = any;

export function handleTerminalTurnStartFailure(
  session: CodexRecoveryOrchestratorSessionLike,
  adapter: CodexRecoveryAdapterLike,
  msg: BrowserOutgoingMessage,
  info: TurnStartFailureInfo,
  deps: CodexAdapterRecoveryLifecycleDeps,
): void {
  const message = `Codex could not start this turn: ${info.message}`;
  console.warn(
    `[ws-bridge] Terminal turn/start failure for session ${sessionTag(session.id)}; not re-queuing ${msg.type}: ${info.message}`,
  );

  const pending =
    deps.getCodexTurnAwaitingAck(session) ??
    session.pendingCodexTurns.find(
      (turn: any) =>
        turn.adapterMsg.type === msg.type &&
        JSON.stringify(turn.adapterMsg) === JSON.stringify(msg) &&
        turn.status !== "completed",
    );

  const recoveryContinuation = pending ? isRecoveryContinuationTurn(session, pending) : false;
  const pendingInputIds = pending?.pendingInputIds ?? (pending?.userMessageId ? [pending.userMessageId] : []);
  const recoveryLinks = pendingInputIds.flatMap(
    (id) => session.pendingCodexInputs.find((input) => input.id === id)?.autoPauseRecoveries ?? [],
  );
  markCodexAutoPauseRecoveryFailed(session, recoveryLinks, Date.now(), deps);
  const failedAt = Date.now();
  for (const id of pendingInputIds) {
    const input = session.pendingCodexInputs.find((candidate) => candidate.id === id);
    if (!input) continue;
    input.cancelable = true;
    input.deliveryState = "failed";
    input.failureReason = "nonrecoverable_turn_start";
    input.failureMessage = "Codex rejected this input before delivery.";
    input.failedAt = failedAt;
    input.autoPauseRecoveries = undefined;
  }

  if (pending) {
    pending.lastError = message;
    deps.completeCodexTurn(session, pending);
  }
  if (recoveryContinuation) {
    markCodexTurnRecoveryActionRequired(session, "continuation_dispatch_failed", deps);
  }

  deps.setGenerating(session, false, "codex_turn_start_terminal_failure");
  deps.rebuildQueuedCodexPendingStartBatch(session);
  deps.broadcastToBrowsers(session, {
    type: "error",
    message,
  });
  deps.setAttentionError(session);
  deps.dispatchQueuedCodexTurns(session, "codex_turn_start_terminal_failure");
  if (deps.getCodexHeadTurn(session)?.status === "dispatched") {
    deps.promoteNextQueuedTurn(session);
  }
  deps.broadcastPendingCodexInputs(session);
  deps.persistSession(session);

  const activeAdapter = session.codexAdapter;
  if (activeAdapter && activeAdapter !== adapter) {
    deps.dispatchQueuedCodexTurns(session, "stale_adapter_terminal_turn_start_failed");
    deps.flushQueuedMessagesToCodexAdapter(session, activeAdapter, "stale_adapter_terminal_turn_start_failed");
  }
}
