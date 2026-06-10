import type {
  BrowserIncomingMessage,
  CodexLeaderRecycleContinuation,
  CodexLeaderRecycleTrigger,
} from "../session-types.js";
import { getLeaderRecycleRecoveryInstructions } from "../compaction-recovery-prompts.js";
import type { Session } from "./ws-bridge-session.js";

export interface CodexLeaderRecycleSessionDeps {
  clearAllCodexToolResultWatchdogs: (session: Session) => void;
  broadcastToBrowsers: (session: Session, message: BrowserIncomingMessage) => void;
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
  const continuation = buildCodexLeaderRecycleContinuation(session, trigger);
  const marker = buildCodexLeaderRecycleMarker(trigger, continuation.requestedAt);
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
  session.codexLeaderRecycleContinuation = continuation;
  session.messageHistory.push(marker);
  deps.broadcastToBrowsers(session, marker);
  deps.replaceQueuedTurnLifecycleEntries(session);
  session.interruptedDuringTurn = true;
  session.interruptSourceDuringTurn = "system";
  deps.markCodexIntentionalRelaunch(session, `leader_recycle:${trigger}`, guardMs);
  session.relaunchPending = true;
  deps.setGenerating(session, false, "codex_leader_recycle");
  deps.persistSession(session);
}

function buildCodexLeaderRecycleMarker(trigger: CodexLeaderRecycleTrigger, timestamp: number): BrowserIncomingMessage {
  return {
    type: "compact_marker",
    id: `session-recycled-${timestamp}`,
    timestamp,
    markerKind: "session_recycled",
    trigger,
  };
}

function buildCodexLeaderRecycleContinuation(
  session: Session,
  trigger: CodexLeaderRecycleTrigger,
): CodexLeaderRecycleContinuation {
  const requestedAt = Date.now();
  const route = session.activeTurnRoute ?? null;
  const routeText =
    route?.threadKey || route?.questId ? `\nActive thread before recycle: ${route.threadKey ?? route.questId}` : "";
  const sessionRef = String((session as { sessionNum?: number | null }).sessionNum ?? session.id);
  const content = [
    "Codex leader recycle interrupted the previous leader turn before it reached a final response.",
    "Do not treat assistant text immediately before this recovery message as a completed response or finished orchestration action. Use it only as historical evidence if Takode inspection shows it matters.",
    routeText.trim(),
    getLeaderRecycleRecoveryInstructions(sessionRef),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    trigger,
    requestedAt,
    content,
    ...(route?.threadKey ? { threadKey: route.threadKey } : {}),
    ...(route?.questId ? { questId: route.questId } : {}),
  };
}
