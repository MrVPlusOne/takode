import {
  SESSION_NAVIGATION_ID_MAX_LENGTH,
  SESSION_NAVIGATION_PATH_MAX_LENGTH,
  SESSION_NAVIGATION_PREVIEW_MAX_LENGTH,
  SESSION_NAVIGATION_PROJECTION,
  SESSION_NAVIGATION_TEXT_MAX_LENGTH,
  createSessionNavigationProjectionPatch,
  type SessionNavigationBackendType,
  type SessionNavigationProjectionValue,
  type SessionNavigationSdkState,
  type SessionNavigationStatus,
} from "../shared/session-navigation-projection.js";
import { deriveAskPermissionForMode } from "../shared/permission-modes.js";
import { isCodexLeaderRecycleMode } from "../shared/codex-leader-compaction-mode.js";
import { countPendingUserPermissions } from "./bridge/session-registry-controller.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { SdkSessionInfo } from "./session-info.js";
import { SYNCED_PROJECTION_DESCRIPTORS } from "../shared/synced-projection-registry.js";
import {
  createDirectSyncedProjectionDefinition,
  type SyncedProjectionDefinition,
} from "./synced-projection-runtime.js";

export interface SessionNavigationProjectionDefinitionDeps<TSubscriber> {
  getSession: (sessionId: string) => Session | undefined;
  getLauncherSessionInfo: (sessionId: string) => SdkSessionInfo | null | undefined;
  getSessionName: (sessionId: string) => string | undefined;
  getPendingTimerCount: (sessionId: string) => number;
  getBackendConnected: (sessionId: string) => boolean;
  getSessionStatus: (sessionId: string) => SessionNavigationStatus;
  getLastActivityAt: (sessionId: string) => number | undefined;
  getLastUserMessageAt: (sessionId: string) => number | undefined;
  getLastMessagePreviewAt: (sessionId: string) => number | undefined;
  authorizeSubscription: (subscriber: TSubscriber, session: Session) => boolean;
}

function boundedText(value: unknown, maxLength = SESSION_NAVIGATION_TEXT_MAX_LENGTH): string {
  return typeof value === "string" ? value.slice(0, maxLength) : "";
}

function boundedNullableText(value: unknown, maxLength = SESSION_NAVIGATION_TEXT_MAX_LENGTH): string | null {
  return typeof value === "string" ? value.slice(0, maxLength) : null;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function nonNegativeNullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveNullableInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

function backendTypeFor(
  session: Session,
  launcherInfo: SdkSessionInfo | null | undefined,
): SessionNavigationBackendType {
  const backendType = session.state.backend_type ?? launcherInfo?.backendType ?? session.backendType;
  return backendType === "codex" || backendType === "claude-sdk" ? backendType : "claude";
}

function sdkStateFor(
  session: Session,
  launcherInfo: SdkSessionInfo | null | undefined,
  cliConnected: boolean,
): SessionNavigationSdkState {
  if (cliConnected && session.isGenerating) return "running";
  const state = launcherInfo?.state;
  if (state === "starting" || state === "connected" || state === "running" || state === "exited") return state;
  return cliConnected ? "connected" : "exited";
}

function configuredContextWindow(
  backendType: SessionNavigationBackendType,
  session: Session,
  launcherInfo: SdkSessionInfo | null | undefined,
): number | null {
  const state = session.state;
  if (backendType === "codex") {
    if (Object.prototype.hasOwnProperty.call(state, "codex_max_context_length")) {
      return nonNegativeNullableNumber(state.codex_max_context_length);
    }
    return nonNegativeNullableNumber(launcherInfo?.codexMaxContextLength);
  }
  if (Object.prototype.hasOwnProperty.call(state, "claude_max_context_length")) {
    return nonNegativeNullableNumber(state.claude_max_context_length);
  }
  return nonNegativeNullableNumber(launcherInfo?.claudeMaxContextLength);
}

function modelContextWindow(backendType: SessionNavigationBackendType, session: Session): number | null {
  const value =
    backendType === "codex"
      ? session.state.codex_token_details?.modelContextWindow
      : session.state.claude_token_details?.modelContextWindow;
  return nonNegativeNullableNumber(value);
}

function effectiveContextWindow(
  backendType: SessionNavigationBackendType,
  isOrchestrator: boolean,
  configured: number | null,
  modelWindow: number | null,
  session: Session,
  launcherInfo: SdkSessionInfo | null | undefined,
): number | null {
  const leaderCompactionMode = launcherInfo?.codexLeaderCompactionMode ?? session.state.codex_leader_compaction_mode;
  if (backendType === "codex" && isOrchestrator && isCodexLeaderRecycleMode(leaderCompactionMode)) {
    const recycleThreshold =
      nonNegativeNullableNumber(launcherInfo?.codexLeaderRecycleThresholdTokens) ??
      nonNegativeNullableNumber(session.state.codex_leader_recycle_threshold_tokens);
    if (recycleThreshold !== null && recycleThreshold > 0) return recycleThreshold;
  }
  return modelWindow ?? configured;
}

export function buildSessionNavigationProjectionValue<TSubscriber>(
  session: Session,
  deps: SessionNavigationProjectionDefinitionDeps<TSubscriber>,
): SessionNavigationProjectionValue {
  const launcherInfo = deps.getLauncherSessionInfo(session.id);
  const state = session.state;
  const backendType = backendTypeFor(session, launcherInfo);
  const cliConnected = deps.getBackendConnected(session.id);
  const isOrchestrator = state.isOrchestrator === true || launcherInfo?.isOrchestrator === true;
  const configuredWindow = configuredContextWindow(backendType, session, launcherInfo);
  const modelWindow = modelContextWindow(backendType, session);
  const pause = state.pause ?? null;
  const permissionMode = boundedText(state.permissionMode || launcherInfo?.permissionMode || "default");
  const askPermission =
    typeof state.askPermission === "boolean"
      ? state.askPermission
      : typeof launcherInfo?.askPermission === "boolean"
        ? launcherInfo.askPermission
        : deriveAskPermissionForMode(backendType === "codex" ? "codex" : "claude", permissionMode);
  const effectiveWindow = effectiveContextWindow(
    backendType,
    isOrchestrator,
    configuredWindow,
    modelWindow,
    session,
    launcherInfo,
  );

  return {
    name: boundedNullableText(deps.getSessionName(session.id) ?? launcherInfo?.name),
    model: boundedText(state.model || launcherInfo?.model),
    cwd: boundedText(state.cwd || launcherInfo?.cwd, SESSION_NAVIGATION_PATH_MAX_LENGTH),
    backendType,
    permissionMode,
    askPermission,
    sessionNum: positiveNullableInteger(launcherInfo?.sessionNum),
    createdAt: nonNegativeNumber(launcherInfo?.createdAt),
    treeGroupId: boundedNullableText(state.treeGroupId ?? launcherInfo?.treeGroupId, SESSION_NAVIGATION_ID_MAX_LENGTH),
    memorySessionSpaceSlug: boundedNullableText(state.memorySessionSpaceSlug ?? launcherInfo?.memorySessionSpaceSlug),
    repoRoot: boundedText(state.repo_root || launcherInfo?.repoRoot, SESSION_NAVIGATION_PATH_MAX_LENGTH),
    isWorktree: state.is_worktree === true || launcherInfo?.isWorktree === true,
    isContainerized: state.is_containerized === true || typeof launcherInfo?.containerId === "string",
    isAssistant: launcherInfo?.isAssistant === true,
    isOrchestrator,
    herdedBy: boundedNullableText(launcherInfo?.herdedBy, SESSION_NAVIGATION_ID_MAX_LENGTH),
    reviewerOf: positiveNullableInteger(launcherInfo?.reviewerOf),
    cronJobId: boundedNullableText(state.cronJobId ?? launcherInfo?.cronJobId, SESSION_NAVIGATION_ID_MAX_LENGTH),
    cronJobName: boundedNullableText(state.cronJobName ?? launcherInfo?.cronJobName),
    state: sdkStateFor(session, launcherInfo, cliConnected),
    status: deps.getSessionStatus(session.id),
    cliConnected,
    killedByIdleManager: launcherInfo?.killedByIdleManager === true,
    pendingPermissionCount: countPendingUserPermissions(session),
    pendingTimerCount: nonNegativeInteger(deps.getPendingTimerCount(session.id)),
    paused: pause !== null,
    pausedInputQueueCount: nonNegativeInteger(pause?.queuedMessages.length),
    lastActivityAt: nonNegativeNullableNumber(deps.getLastActivityAt(session.id)),
    lastUserMessageAt: nonNegativeNullableNumber(deps.getLastUserMessageAt(session.id)),
    lastMessagePreviewAt: nonNegativeNullableNumber(deps.getLastMessagePreviewAt(session.id)),
    claimedQuestId: boundedNullableText(state.claimedQuestId, SESSION_NAVIGATION_ID_MAX_LENGTH),
    claimedQuestTitle: boundedNullableText(state.claimedQuestTitle),
    claimedQuestStatus: boundedNullableText(state.claimedQuestStatus),
    claimedQuestVerificationInboxUnread:
      typeof state.claimedQuestVerificationInboxUnread === "boolean" ? state.claimedQuestVerificationInboxUnread : null,
    claimedQuestLeaderSessionId: boundedNullableText(
      state.claimedQuestLeaderSessionId,
      SESSION_NAVIGATION_ID_MAX_LENGTH,
    ),
    gitBranch: boundedText(state.git_branch),
    gitDefaultBranch: boundedText(state.git_default_branch),
    diffBaseBranch: boundedText(state.diff_base_branch),
    gitAhead: nonNegativeInteger(state.git_ahead),
    gitBehind: nonNegativeInteger(state.git_behind),
    totalLinesAdded: nonNegativeInteger(state.total_lines_added),
    totalLinesRemoved: nonNegativeInteger(state.total_lines_removed),
    diffStatsSkippedReason: boundedNullableText(state.diff_stats_skipped_reason),
    gitStatusRefreshedAt: nonNegativeNullableNumber(state.git_status_refreshed_at),
    gitStatusRefreshError: boundedNullableText(state.git_status_refresh_error),
    lastMessagePreview: boundedText(session.lastUserMessage, SESSION_NAVIGATION_PREVIEW_MAX_LENGTH),
    userTurnCount: nonNegativeInteger(state.user_turn_count ?? state.num_turns),
    agentTurnCount: nonNegativeInteger(state.agent_turn_count),
    contextUsedPercent: nonNegativeNumber(state.context_used_percent),
    contextTokensUsed: nonNegativeNullableNumber(state.codex_token_details?.contextTokensUsed),
    modelContextWindow: modelWindow,
    codexMaxContextLength: backendType === "codex" ? configuredWindow : null,
    claudeMaxContextLength: backendType !== "codex" ? configuredWindow : null,
    codexLeaderRecycleThresholdTokens:
      backendType === "codex" && isOrchestrator && effectiveWindow !== modelWindow ? effectiveWindow : null,
    messageHistoryBytes: nonNegativeInteger(state.message_history_bytes),
    codexRetainedPayloadBytes: nonNegativeInteger(state.codex_retained_payload_bytes),
    codexReasoningEffort: boundedNullableText(state.codex_reasoning_effort ?? launcherInfo?.codexReasoningEffort),
    codexEffectiveReasoningEffort: boundedNullableText(state.codex_effective_reasoning_effort),
    codexEffectiveReasoningEffortReported: state.codex_effective_reasoning_effort_reported === true,
  };
}

export function createSessionNavigationProjectionDefinition<TSubscriber>(
  deps: SessionNavigationProjectionDefinitionDeps<TSubscriber>,
): SyncedProjectionDefinition<
  Session,
  SessionNavigationProjectionValue,
  SessionNavigationProjectionValue,
  TSubscriber
> {
  return createDirectSyncedProjectionDefinition({
    descriptor: SYNCED_PROJECTION_DESCRIPTORS[SESSION_NAVIGATION_PROJECTION],
    dependencies: [
      "identity",
      "topology",
      "lifecycle",
      "quest",
      "git",
      "detail",
      "session-name",
      "timers",
      "backend-connection",
      "transient-status",
    ],
    resolveSource: deps.getSession,
    selectValue: (session) => buildSessionNavigationProjectionValue(session, deps),
    authorizeSubscription: (subscriber, _key, session) => deps.authorizeSubscription(subscriber, session),
    createPatch: createSessionNavigationProjectionPatch,
  });
}
