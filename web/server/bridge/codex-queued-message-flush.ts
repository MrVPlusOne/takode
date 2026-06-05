import type {
  CodexAdapterRecoveryLifecycleDeps,
  CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

export function maybeFlushQueuedCodexMessages(
  session: CodexRecoveryOrchestratorSessionLike,
  reason: string,
  deps: Pick<CodexAdapterRecoveryLifecycleDeps, "flushQueuedMessagesToCodexAdapter">,
): void {
  const adapter = session.codexAdapter;
  if (!adapter) return;
  deps.flushQueuedMessagesToCodexAdapter(session, adapter, reason);
}
