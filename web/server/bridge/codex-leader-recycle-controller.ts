import type {
  BrowserIncomingMessage,
  CodexLeaderRecycleContinuation,
  CodexLeaderRecycleTrigger,
} from "../session-types.js";
import { getKnownSessionNum } from "../cli-launcher.js";
import { getLeaderRecycleRecoveryInstructions } from "../compaction-recovery-prompts.js";
import type { Session } from "./ws-bridge-session.js";
import {
  markCodexTurnRecoveryActionRequired,
  type CodexInterruptedTurnRecoveryDeps,
} from "./codex-interrupted-turn-recovery.js";

export interface CodexLeaderRecycleSessionDeps {
  clearAllCodexToolResultWatchdogs: (session: Session) => void;
  broadcastToBrowsers: (session: Session, message: BrowserIncomingMessage) => void;
  markCodexIntentionalRelaunch: (session: Session, reason: string, guardMs: number) => void;
  persistSession: (session: Session) => void;
  replaceQueuedTurnLifecycleEntries: (session: Session) => void;
  setGenerating: (session: Session, generating: boolean, reason: string) => void;
}

export function failCodexLeaderRecycleRecovery(
  session: Session,
  deps: Pick<CodexInterruptedTurnRecoveryDeps, "broadcastToBrowsers" | "persistSession" | "setAttentionError">,
): void {
  markCodexTurnRecoveryActionRequired(session, "recovery_failed", deps);
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
  const recovery = session.state.codex_turn_recovery ?? null;
  if (continuation.recoveryId && recovery?.recoveryId === continuation.recoveryId) {
    session.state.codex_turn_recovery = {
      ...recovery,
      continuationOwnerId: null,
      status: "continuation_pending",
      reason: "interrupted_after_activity",
      attempt: 1,
      updatedAt: continuation.requestedAt,
    };
    deps.broadcastToBrowsers(session, {
      type: "session_update",
      session: { codex_turn_recovery: session.state.codex_turn_recovery },
    });
  }
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
  const recovery = session.state.codex_turn_recovery ?? null;
  const route =
    recovery && recovery.status !== "action_required"
      ? { threadKey: recovery.threadKey, ...(recovery.questId ? { questId: recovery.questId } : {}) }
      : (session.activeTurnRoute ?? null);
  const sessionRef = String(
    getKnownSessionNum(session.id) ?? (session as { sessionNum?: number | null }).sessionNum ?? session.id,
  );
  const content = [
    "Codex leader recycle interrupted the previous leader turn before it reached a final response.",
    "Do not treat assistant text immediately before this recovery message as a completed response or finished orchestration action. Use it only as historical evidence if Takode inspection shows it matters.",
    getLeaderRecycleRecoveryInstructions(sessionRef),
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    trigger,
    requestedAt,
    content,
    ...(recovery && recovery.status !== "action_required" ? { recoveryId: recovery.recoveryId } : {}),
    ...(route?.threadKey ? { threadKey: route.threadKey } : {}),
    ...(route?.questId ? { questId: route.questId } : {}),
  };
}
