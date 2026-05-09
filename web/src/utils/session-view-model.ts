import type { SessionState } from "../types.js";
import type { BackendType, SdkSessionInfo, SessionPauseState } from "../types.js";

export interface SessionViewModel {
  sessionId: string;
  backendType?: BackendType;
  model?: string;
  cwd?: string;
  permissionMode?: string;
  repoRoot?: string;
  gitBranch?: string | null;
  gitDefaultBranch?: string;
  diffBaseBranch?: string;
  isWorktree?: boolean;
  isContainerized?: boolean;
  gitAhead?: number;
  gitBehind?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
  numTurns?: number;
  userTurnCount?: number;
  agentTurnCount?: number;
  totalCostUsd?: number;
  contextUsedPercent?: number;
  modelContextWindow?: number;
  codexLeaderRecycleThresholdTokens?: number;
  contextTokensUsed?: number;
  messageHistoryBytes?: number;
  codexRetainedPayloadBytes?: number;
  state?: SdkSessionInfo["state"];
  createdAt?: number;
  cliSessionId?: string;
  sessionNum?: number | null;
  name?: string;
  isOrchestrator?: boolean;
  herdedBy?: string;
  claimedQuestStatus?: string;
  claimedQuestVerificationInboxUnread?: boolean;
  askPermission?: boolean;
  pause?: SessionPauseState | null;
  pausedInputQueueCount?: number;
}

function isSessionState(session: SessionState | SdkSessionInfo): session is SessionState {
  return "session_id" in session;
}

export function toSessionViewModel(session: SessionState | SdkSessionInfo): SessionViewModel {
  if (isSessionState(session)) {
    return {
      sessionId: session.session_id,
      backendType: session.backend_type,
      model: session.model,
      cwd: session.cwd,
      permissionMode: session.permissionMode,
      repoRoot: session.repo_root,
      gitBranch: session.git_branch,
      gitDefaultBranch: session.git_default_branch,
      diffBaseBranch: session.diff_base_branch,
      isWorktree: session.is_worktree,
      isContainerized: session.is_containerized,
      gitAhead: session.git_ahead,
      gitBehind: session.git_behind,
      totalLinesAdded: session.total_lines_added,
      totalLinesRemoved: session.total_lines_removed,
      userTurnCount: session.user_turn_count,
      agentTurnCount: session.agent_turn_count,
      numTurns: session.user_turn_count ?? session.num_turns,
      totalCostUsd: session.total_cost_usd,
      contextUsedPercent: session.context_used_percent,
      modelContextWindow:
        session.codex_token_details?.modelContextWindow ?? session.claude_token_details?.modelContextWindow,
      codexLeaderRecycleThresholdTokens: session.codex_leader_recycle_threshold_tokens,
      contextTokensUsed: session.codex_token_details?.contextTokensUsed,
      messageHistoryBytes: session.message_history_bytes,
      codexRetainedPayloadBytes: session.codex_retained_payload_bytes,
      claimedQuestStatus: session.claimedQuestStatus,
      claimedQuestVerificationInboxUnread: session.claimedQuestVerificationInboxUnread,
      askPermission: session.askPermission,
      isOrchestrator: session.isOrchestrator,
      pause: session.pause ?? null,
      pausedInputQueueCount: session.pause?.queuedMessages.length ?? 0,
    };
  }

  return {
    sessionId: session.sessionId,
    backendType: session.backendType,
    model: session.model,
    cwd: session.cwd,
    permissionMode: session.permissionMode,
    repoRoot: session.repoRoot,
    gitBranch: session.gitBranch,
    gitDefaultBranch: session.gitDefaultBranch,
    diffBaseBranch: session.diffBaseBranch,
    isWorktree: session.isWorktree,
    gitAhead: session.gitAhead,
    gitBehind: session.gitBehind,
    totalLinesAdded: session.totalLinesAdded,
    totalLinesRemoved: session.totalLinesRemoved,
    contextUsedPercent: session.contextUsedPercent,
    userTurnCount: session.userTurnCount,
    agentTurnCount: session.agentTurnCount,
    numTurns: session.userTurnCount ?? session.numTurns,
    modelContextWindow: session.codexTokenDetails?.modelContextWindow ?? session.claudeTokenDetails?.modelContextWindow,
    codexLeaderRecycleThresholdTokens: session.codexLeaderRecycleThresholdTokens,
    contextTokensUsed: session.codexTokenDetails?.contextTokensUsed,
    messageHistoryBytes: session.messageHistoryBytes,
    codexRetainedPayloadBytes: session.codexRetainedPayloadBytes,
    state: session.state,
    createdAt: session.createdAt,
    cliSessionId: session.cliSessionId,
    sessionNum: session.sessionNum,
    name: session.name,
    isOrchestrator: session.isOrchestrator,
    herdedBy: session.herdedBy,
    claimedQuestStatus: session.claimedQuestStatus ?? undefined,
    claimedQuestVerificationInboxUnread: session.claimedQuestVerificationInboxUnread,
    askPermission: undefined,
    pause: session.pause ?? null,
    pausedInputQueueCount: session.pausedInputQueueCount ?? session.pause?.queuedMessages.length ?? 0,
  };
}

export function coalesceSessionViewModel(
  primary: SessionState | SdkSessionInfo | null | undefined,
  fallback?: SessionState | SdkSessionInfo | null,
): SessionViewModel | null {
  if (!primary && !fallback) return null;

  const fallbackVm = fallback ? toSessionViewModel(fallback) : null;
  const primaryVm = primary ? toSessionViewModel(primary) : null;

  if (!primaryVm && fallbackVm) return fallbackVm;
  if (!fallbackVm && primaryVm) return primaryVm;

  const merged: Partial<SessionViewModel> = { ...(fallbackVm || {}) };
  if (primaryVm) {
    for (const [key, value] of Object.entries(primaryVm) as [
      keyof SessionViewModel,
      SessionViewModel[keyof SessionViewModel],
    ][]) {
      if (value !== undefined) {
        (merged as Record<string, unknown>)[key] = value;
      }
    }
  }
  const userTurnCount = primaryVm?.userTurnCount ?? fallbackVm?.userTurnCount;
  const agentTurnCount = primaryVm?.agentTurnCount ?? fallbackVm?.agentTurnCount;
  const numTurns = userTurnCount ?? primaryVm?.numTurns ?? fallbackVm?.numTurns;

  return {
    ...(merged as SessionViewModel),
    userTurnCount,
    agentTurnCount,
    numTurns,
    sessionId: primaryVm?.sessionId || fallbackVm?.sessionId || "",
  };
}
