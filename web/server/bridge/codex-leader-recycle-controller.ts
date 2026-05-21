import type { CodexLeaderRecycleTrigger } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";

export interface CodexLeaderRecycleSessionDeps {
  clearAllCodexToolResultWatchdogs: (session: Session) => void;
  markCodexIntentionalRelaunch: (session: Session, reason: string, guardMs: number) => void;
  persistSession: (session: Session) => void;
  replaceQueuedTurnLifecycleEntries: (session: Session) => void;
  setGenerating: (session: Session, generating: boolean, reason: string) => void;
}

export function buildCodexLeaderRecycleTokenUsage(session: Session) {
  const tokenDetails = session.state.codex_token_details;
  if (!tokenDetails && typeof session.state.context_used_percent !== "number") return undefined;
  return {
    contextTokensUsed: tokenDetails?.contextTokensUsed,
    contextUsedPercent: session.state.context_used_percent,
    modelContextWindow: tokenDetails?.modelContextWindow,
    inputTokens: tokenDetails?.inputTokens,
    cachedInputTokens: tokenDetails?.cachedInputTokens,
    outputTokens: tokenDetails?.outputTokens,
    reasoningOutputTokens: tokenDetails?.reasoningOutputTokens,
  };
}

export function prepareCodexLeaderRecycleSession(
  session: Session,
  trigger: CodexLeaderRecycleTrigger,
  guardMs: number,
  deps: CodexLeaderRecycleSessionDeps,
): void {
  deps.clearAllCodexToolResultWatchdogs(session);
  session.pendingMessages = [];
  session.forceCompactPending = false;
  session.pendingCodexTurns = [];
  session.pendingCodexInputs = [];
  session.pendingCodexRollback = null;
  session.pendingCodexRollbackError = null;
  session.pendingCodexRollbackWaiter = null;
  session.pendingPermissions.clear();
  session.pendingQuestCommands.clear();
  session.codexFreshTurnRequiredUntilTurnId = null;
  session.lastOutboundUserNdjson = null;
  session.state.is_compacting = false;
  deps.replaceQueuedTurnLifecycleEntries(session);
  session.interruptedDuringTurn = true;
  session.interruptSourceDuringTurn = "system";
  deps.markCodexIntentionalRelaunch(session, `leader_recycle:${trigger}`, guardMs);
  session.relaunchPending = true;
  deps.setGenerating(session, false, "codex_leader_recycle");
  deps.persistSession(session);
}
