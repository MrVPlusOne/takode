import type { BrowserOutgoingMessage } from "../session-types.js";
import { sessionTag } from "../session-tag.js";
import type { TurnStartFailureInfo } from "./adapter-interface.js";
import { restoreQueuedNeedsInputResolutionNotices } from "./adapter-browser-routing-needs-input-reminder.js";
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

  const pendingInputIds = pending?.pendingInputIds ?? (pending?.userMessageId ? [pending.userMessageId] : []);
  for (const id of pendingInputIds) {
    removePendingInput(session, id, deps);
  }

  if (pending) {
    pending.lastError = message;
    deps.completeCodexTurn(session, pending);
  }

  deps.setGenerating(session, false, "codex_turn_start_terminal_failure");
  deps.broadcastToBrowsers(session, {
    type: "error",
    message,
  });
  deps.setAttentionError(session);
  deps.persistSession(session);

  const activeAdapter = session.codexAdapter;
  if (activeAdapter && activeAdapter !== adapter) {
    deps.dispatchQueuedCodexTurns(session, "stale_adapter_terminal_turn_start_failed");
    deps.flushQueuedMessagesToCodexAdapter(session, activeAdapter, "stale_adapter_terminal_turn_start_failed");
  }
}

function removePendingInput(
  session: CodexRecoveryOrchestratorSessionLike,
  id: string,
  deps: Pick<CodexAdapterRecoveryLifecycleDeps, "broadcastPendingCodexInputs" | "persistSession">,
): void {
  const idx = session.pendingCodexInputs.findIndex((item) => item.id === id);
  if (idx < 0) return;
  session.pendingCodexInputs.splice(idx, 1);
  restoreQueuedNeedsInputResolutionNotices(session, id);
  deps.broadcastPendingCodexInputs(session);
  deps.persistSession(session);
}
