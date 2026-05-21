import type { CodexRecoveryOrchestratorSessionLike } from "./codex-recovery-orchestrator.js";

type CodexRecoveryAdapterLike = NonNullable<CodexRecoveryOrchestratorSessionLike["codexAdapter"]>;

const intentionalCodexRelaunchTargets = new WeakMap<CodexRecoveryOrchestratorSessionLike, CodexRecoveryAdapterLike>();

export function markCodexIntentionalRelaunch(
  session: CodexRecoveryOrchestratorSessionLike,
  reason: string,
  guardMs: number,
): void {
  const adapter = session.codexAdapter;
  if (!adapter) {
    clearCodexIntentionalRelaunch(session);
    return;
  }
  (session as any).intentionalCodexRelaunchUntil = Date.now() + guardMs;
  (session as any).intentionalCodexRelaunchReason = reason;
  intentionalCodexRelaunchTargets.set(session, adapter);
}

export function clearCodexIntentionalRelaunch(session: CodexRecoveryOrchestratorSessionLike): void {
  (session as any).intentionalCodexRelaunchUntil = null;
  (session as any).intentionalCodexRelaunchReason = null;
  intentionalCodexRelaunchTargets.delete(session);
}

export function consumeCodexIntentionalRelaunch(
  session: CodexRecoveryOrchestratorSessionLike,
  adapter: CodexRecoveryAdapterLike,
  now: number,
): string | null {
  const until = (session as any).intentionalCodexRelaunchUntil;
  if (until === null) return null;

  const reason = (session as any).intentionalCodexRelaunchReason || "unknown";
  const targetAdapter = intentionalCodexRelaunchTargets.get(session);
  clearCodexIntentionalRelaunch(session);
  if (now > until || targetAdapter !== adapter) return null;
  return reason;
}
