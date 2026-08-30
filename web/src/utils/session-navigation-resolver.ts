import {
  SESSION_NAVIGATION_PROJECTION,
  type SessionNavigationIdentitySlice,
  type SessionNavigationProjectionValue,
} from "../../shared/session-navigation-projection.js";
import type { AppState } from "../store-types.js";
import type { SdkSessionInfo, SessionState } from "../types.js";
import { getSyncedProjectionValue, hasSyncedProjectionValue } from "../store-synced-projections.js";
import { coalesceSessionViewModel, type SessionViewModel } from "./session-view-model.js";
import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { selectLeaderActivePhaseSummary } from "./leader-thread-tabs-resolver.js";

export interface SessionNavigationResolverSource<TPermission = unknown> {
  sessions: Map<string, SessionState>;
  sdkSessions: SdkSessionInfo[];
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
  cliConnected?: Map<string, boolean>;
  cliDisconnectReason?: Map<string, "idle_limit" | "broken" | "recovery_suppressed" | null>;
  sessionStatus?: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  pendingPermissions?: Map<string, Map<string, TPermission>>;
  askPermission?: Map<string, boolean>;
  diffFileStats?: Map<string, Map<string, { additions: number; deletions: number }>>;
  sessionNames?: Map<string, string>;
  sessionPreviews?: Map<string, string>;
  countUserPermissions?: (permissions: Map<string, TPermission> | undefined) => number;
}

export interface ResolvedSessionNavigation {
  sidebarItem: SidebarSessionItem;
  name: string | undefined;
  preview: string | undefined;
  viewModel: SessionViewModel;
  paused: boolean;
  projectionState: "accepted" | "invalid-supplied" | "legacy";
}

interface ProjectedSidebarLegacyFields {
  archived: boolean;
  archivedAt: number | undefined;
  notificationUrgency: SdkSessionInfo["notificationUrgency"];
  activeNotificationCount: number;
  activeNeedsInputNotificationCount: number;
  activeReviewNotificationCount: number;
  mutedNeedsInputNotificationCount: number;
  notificationStatusVersion: number | undefined;
  notificationStatusUpdatedAt: number | undefined;
  pause: SdkSessionInfo["pause"];
  worktreeExists: boolean | undefined;
  worktreeDirty: boolean | undefined;
  worktreeCleanupStatus: SdkSessionInfo["worktreeCleanupStatus"];
  worktreeCleanupError: string | undefined;
  leaderProfilePortraitId: string | null;
  leaderProfilePortrait: SdkSessionInfo["leaderProfilePortrait"];
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"];
  leaderActiveBoardRows: SdkSessionInfo["leaderActiveBoardRows"];
}

interface ProjectedSidebarItemCacheEntry {
  sessionId: string;
  topology: SessionNavigationProjectionValue["topology"];
  lifecycle: SessionNavigationProjectionValue["lifecycle"];
  quest: SessionNavigationProjectionValue["quest"];
  git: SessionNavigationProjectionValue["git"];
  legacy: ProjectedSidebarLegacyFields;
  item: SidebarSessionItem;
}

interface LegacyResolutionCacheEntry {
  sdkInfo: SdkSessionInfo | undefined;
  bridgeState: SessionState | undefined;
  cliConnected: boolean;
  disconnectReason: "idle_limit" | "broken" | "recovery_suppressed" | null | undefined;
  status: "idle" | "running" | "compacting" | "reverting" | null | undefined;
  permCount: number;
  askPermission: boolean | undefined;
  localLinesAdded: number;
  localLinesRemoved: number;
  name: string | undefined;
  preview: string | undefined;
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"];
  result: ResolvedSessionNavigation;
}

interface ProjectedResolutionCacheEntry {
  sdkInfo: SdkSessionInfo | undefined;
  bridgeState: SessionState | undefined;
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"];
  result: ResolvedSessionNavigation;
}

const projectedSidebarItemCache = new WeakMap<SessionNavigationIdentitySlice, ProjectedSidebarItemCacheEntry>();
const projectedResolutionCache = new WeakMap<SessionNavigationProjectionValue, ProjectedResolutionCacheEntry>();
const legacyResolutionCache = new WeakMap<object, LegacyResolutionCacheEntry>();

function sumDiffFileStats(fileStats: Map<string, { additions: number; deletions: number }> | undefined) {
  let additions = 0;
  let deletions = 0;
  for (const stats of fileStats?.values() ?? []) {
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions };
}

function projectionCacheState(source: SessionNavigationResolverSource<unknown>) {
  return source as Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys">;
}

function hasSuppliedNavigationEnvelope(session: SdkSessionInfo | undefined): boolean {
  return !!session && Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection");
}

function projectionToViewModel(
  sessionId: string,
  projection: SessionNavigationProjectionValue,
  legacy: SessionViewModel | null,
): SessionViewModel {
  const { identity, topology, lifecycle, quest, git, detail } = projection;
  const configuredContextWindow = detail.configuredContextWindow ?? undefined;
  const modelContextWindow = detail.modelContextWindow ?? configuredContextWindow;
  const projectedLeaderRecycleThreshold =
    identity.backendType === "codex" &&
    topology.isOrchestrator &&
    detail.effectiveContextWindow !== null &&
    detail.effectiveContextWindow !== modelContextWindow
      ? detail.effectiveContextWindow
      : undefined;
  return {
    ...(legacy ?? {}),
    sessionId,
    backendType: identity.backendType,
    model: identity.model,
    cwd: identity.cwd,
    permissionMode: identity.permissionMode,
    repoRoot: topology.repoRoot,
    gitBranch: git.branch,
    gitDefaultBranch: git.defaultBranch,
    diffBaseBranch: git.diffBaseBranch,
    isWorktree: topology.isWorktree,
    isContainerized: topology.isContainerized,
    gitAhead: git.ahead,
    gitBehind: git.behind,
    totalLinesAdded: git.linesAdded,
    totalLinesRemoved: git.linesRemoved,
    diffStatsSkippedReason: git.diffStatsSkippedReason,
    userTurnCount: detail.userTurnCount,
    agentTurnCount: detail.agentTurnCount,
    numTurns: detail.userTurnCount,
    contextUsedPercent: detail.contextUsedPercent,
    contextTokensUsed: detail.contextTokensUsed ?? undefined,
    modelContextWindow,
    codexMaxContextLength: identity.backendType === "codex" ? configuredContextWindow : legacy?.codexMaxContextLength,
    claudeMaxContextLength: identity.backendType !== "codex" ? configuredContextWindow : legacy?.claudeMaxContextLength,
    codexLeaderRecycleThresholdTokens: projectedLeaderRecycleThreshold,
    messageHistoryBytes: detail.messageHistoryBytes,
    codexRetainedPayloadBytes: detail.codexRetainedPayloadBytes,
    backendReportedContextWindow: detail.modelContextWindow ?? undefined,
    codexReasoningEffort: detail.codexReasoningEffort,
    codexEffectiveReasoningEffort: detail.codexEffectiveReasoningEffort,
    codexEffectiveReasoningEffortReported: detail.codexEffectiveReasoningEffortReported,
    state: lifecycle.sdkState,
    createdAt: identity.createdAt,
    lastActivityAt: lifecycle.lastActivityAt ?? undefined,
    sessionNum: identity.sessionNum,
    name: identity.name ?? undefined,
    isOrchestrator: topology.isOrchestrator,
    herdedBy: topology.herdedBy ?? undefined,
    claimedQuestId: quest.claimedQuestId ?? undefined,
    claimedQuestTitle: quest.claimedQuestTitle ?? undefined,
    claimedQuestStatus: quest.claimedQuestStatus ?? undefined,
    claimedQuestVerificationInboxUnread: quest.claimedQuestVerificationInboxUnread ?? undefined,
    claimedQuestLeaderSessionId: quest.claimedQuestLeaderSessionId ?? undefined,
    askPermission: identity.askPermission,
    pause: lifecycle.paused ? (legacy?.pause ?? null) : null,
    pausedInputQueueCount: lifecycle.pausedInputQueueCount,
  };
}

function projectedSidebarLegacyFields(
  projection: SessionNavigationProjectionValue,
  sdkInfo: SdkSessionInfo | undefined,
  bridgeState: SessionState | undefined,
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"],
): ProjectedSidebarLegacyFields {
  return {
    archived: sdkInfo?.archived ?? false,
    archivedAt: sdkInfo?.archivedAt,
    notificationUrgency: sdkInfo?.notificationUrgency ?? null,
    activeNotificationCount: sdkInfo?.activeNotificationCount ?? 0,
    activeNeedsInputNotificationCount: sdkInfo?.activeNeedsInputNotificationCount ?? 0,
    activeReviewNotificationCount: sdkInfo?.activeReviewNotificationCount ?? 0,
    mutedNeedsInputNotificationCount: sdkInfo?.mutedNeedsInputNotificationCount ?? 0,
    notificationStatusVersion: sdkInfo?.notificationStatusVersion,
    notificationStatusUpdatedAt: sdkInfo?.notificationStatusUpdatedAt,
    pause: projection.lifecycle.paused ? (bridgeState?.pause ?? sdkInfo?.pause ?? null) : null,
    worktreeExists: sdkInfo?.worktreeExists,
    worktreeDirty: sdkInfo?.worktreeDirty,
    worktreeCleanupStatus: sdkInfo?.worktreeCleanupStatus,
    worktreeCleanupError: sdkInfo?.worktreeCleanupError,
    leaderProfilePortraitId: sdkInfo?.leaderProfilePortraitId ?? null,
    leaderProfilePortrait: sdkInfo?.leaderProfilePortrait,
    leaderActivePhaseSummary,
    leaderActiveBoardRows: sdkInfo?.leaderActiveBoardRows,
  };
}

function projectedSidebarLegacyFieldsEqual(
  left: ProjectedSidebarLegacyFields,
  right: ProjectedSidebarLegacyFields,
): boolean {
  return (
    left.archived === right.archived &&
    left.archivedAt === right.archivedAt &&
    left.notificationUrgency === right.notificationUrgency &&
    left.activeNotificationCount === right.activeNotificationCount &&
    left.activeNeedsInputNotificationCount === right.activeNeedsInputNotificationCount &&
    left.activeReviewNotificationCount === right.activeReviewNotificationCount &&
    left.mutedNeedsInputNotificationCount === right.mutedNeedsInputNotificationCount &&
    left.notificationStatusVersion === right.notificationStatusVersion &&
    left.notificationStatusUpdatedAt === right.notificationStatusUpdatedAt &&
    left.pause === right.pause &&
    left.worktreeExists === right.worktreeExists &&
    left.worktreeDirty === right.worktreeDirty &&
    left.worktreeCleanupStatus === right.worktreeCleanupStatus &&
    left.worktreeCleanupError === right.worktreeCleanupError &&
    left.leaderProfilePortraitId === right.leaderProfilePortraitId &&
    left.leaderProfilePortrait === right.leaderProfilePortrait &&
    left.leaderActivePhaseSummary === right.leaderActivePhaseSummary &&
    left.leaderActiveBoardRows === right.leaderActiveBoardRows
  );
}

function resolveProjectedSidebarItem(
  sessionId: string,
  projection: SessionNavigationProjectionValue,
  sdkInfo: SdkSessionInfo | undefined,
  bridgeState: SessionState | undefined,
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"],
): SidebarSessionItem {
  const { identity, topology, lifecycle, quest, git } = projection;
  const legacy = projectedSidebarLegacyFields(projection, sdkInfo, bridgeState, leaderActivePhaseSummary);
  const cached = projectedSidebarItemCache.get(identity);
  if (
    cached &&
    cached.sessionId === sessionId &&
    cached.topology === topology &&
    cached.lifecycle === lifecycle &&
    cached.quest === quest &&
    cached.git === git &&
    projectedSidebarLegacyFieldsEqual(cached.legacy, legacy)
  ) {
    return cached.item;
  }

  const item: SidebarSessionItem = {
    id: sessionId,
    navigationProjectionOwned: true,
    claimedQuestStatus: quest.claimedQuestStatus ?? undefined,
    claimedQuestVerificationInboxUnread: quest.claimedQuestVerificationInboxUnread ?? undefined,
    model: identity.model,
    cwd: identity.cwd,
    gitBranch: git.branch,
    isContainerized: topology.isContainerized,
    gitAhead: git.ahead,
    gitBehind: git.behind,
    linesAdded: git.linesAdded,
    linesRemoved: git.linesRemoved,
    diffStatsSkippedReason: git.diffStatsSkippedReason,
    gitStatusRefreshedAt: git.statusRefreshedAt ?? undefined,
    gitStatusRefreshError: git.statusRefreshError,
    isConnected: lifecycle.cliConnected,
    status: lifecycle.status,
    sdkState: lifecycle.sdkState,
    createdAt: identity.createdAt,
    archived: legacy.archived,
    archivedAt: legacy.archivedAt,
    backendType: identity.backendType,
    treeGroupId: topology.treeGroupId,
    memorySessionSpaceSlug: topology.memorySessionSpaceSlug,
    repoRoot: topology.repoRoot,
    permCount: lifecycle.pendingPermissionCount,
    pendingTimerCount: lifecycle.pendingTimerCount,
    notificationUrgency: legacy.notificationUrgency,
    activeNotificationCount: legacy.activeNotificationCount,
    activeNeedsInputNotificationCount: legacy.activeNeedsInputNotificationCount,
    activeReviewNotificationCount: legacy.activeReviewNotificationCount,
    mutedNeedsInputNotificationCount: legacy.mutedNeedsInputNotificationCount,
    notificationStatusVersion: legacy.notificationStatusVersion,
    notificationStatusUpdatedAt: legacy.notificationStatusUpdatedAt,
    pause: legacy.pause,
    paused: lifecycle.paused,
    pausedInputQueueCount: lifecycle.pausedInputQueueCount,
    cronJobId: topology.cronJobId ?? undefined,
    cronJobName: topology.cronJobName ?? undefined,
    isWorktree: topology.isWorktree,
    worktreeExists: legacy.worktreeExists,
    worktreeDirty: legacy.worktreeDirty,
    worktreeCleanupStatus: legacy.worktreeCleanupStatus,
    worktreeCleanupError: legacy.worktreeCleanupError,
    askPermission: identity.askPermission,
    idleKilled: lifecycle.idleKilled,
    lastActivityAt: lifecycle.lastActivityAt ?? undefined,
    lastUserMessageAt: lifecycle.lastUserMessageAt ?? undefined,
    lastMessagePreviewAt: lifecycle.lastMessagePreviewAt ?? undefined,
    isOrchestrator: topology.isOrchestrator,
    leaderProfilePortraitId: legacy.leaderProfilePortraitId,
    leaderProfilePortrait: legacy.leaderProfilePortrait,
    leaderActivePhaseSummary: legacy.leaderActivePhaseSummary,
    leaderActiveBoardRows: legacy.leaderActiveBoardRows,
    herdedBy: topology.herdedBy ?? undefined,
    sessionNum: identity.sessionNum,
    reviewerOf: topology.reviewerOf ?? undefined,
  };
  projectedSidebarItemCache.set(identity, { sessionId, topology, lifecycle, quest, git, legacy, item });
  return item;
}

function resolveProjectedSession(
  source: SessionNavigationResolverSource<unknown>,
  sessionId: string,
  projection: SessionNavigationProjectionValue,
  sdkInfo: SdkSessionInfo | undefined,
  bridgeState: SessionState | undefined,
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"],
): ResolvedSessionNavigation {
  const cached = projectedResolutionCache.get(projection);
  if (
    cached &&
    cached.sdkInfo === sdkInfo &&
    cached.bridgeState === bridgeState &&
    cached.leaderActivePhaseSummary === leaderActivePhaseSummary
  ) {
    return cached.result;
  }

  const result: ResolvedSessionNavigation = {
    sidebarItem: resolveProjectedSidebarItem(sessionId, projection, sdkInfo, bridgeState, leaderActivePhaseSummary),
    name: projection.identity.name ?? undefined,
    preview: projection.detail.lastMessagePreview || undefined,
    viewModel: projectionToViewModel(sessionId, projection, coalesceSessionViewModel(bridgeState, sdkInfo)),
    paused: projection.lifecycle.paused,
    projectionState: "accepted",
  };
  projectedResolutionCache.set(projection, { sdkInfo, bridgeState, leaderActivePhaseSummary, result });
  return result;
}

function resolveInvalidSuppliedSession(sessionId: string, sdkInfo: SdkSessionInfo): ResolvedSessionNavigation {
  return {
    sidebarItem: {
      id: sessionId,
      navigationProjectionOwned: true,
      model: "",
      cwd: "",
      gitBranch: "",
      isContainerized: false,
      gitAhead: 0,
      gitBehind: 0,
      linesAdded: 0,
      linesRemoved: 0,
      isConnected: false,
      status: null,
      sdkState: sdkInfo.state === "starting" ? "starting" : "exited",
      createdAt: sdkInfo.createdAt ?? 0,
      archived: sdkInfo.archived ?? false,
      archivedAt: sdkInfo.archivedAt,
      backendType: sdkInfo.backendType ?? "claude",
      repoRoot: "",
      permCount: 0,
      pendingTimerCount: 0,
      paused: false,
      pausedInputQueueCount: 0,
      sessionNum: sdkInfo.sessionNum ?? null,
    },
    name: undefined,
    preview: undefined,
    viewModel: {
      sessionId,
      state: sdkInfo.state === "starting" ? "starting" : "exited",
      createdAt: sdkInfo.createdAt ?? 0,
      sessionNum: sdkInfo.sessionNum ?? null,
    },
    paused: false,
    projectionState: "invalid-supplied",
  };
}

function resolveLegacySession<TPermission>(
  source: SessionNavigationResolverSource<TPermission>,
  sessionId: string,
  sdkInfo: SdkSessionInfo | undefined,
  bridgeState: SessionState | undefined,
  leaderActivePhaseSummary: SdkSessionInfo["leaderActivePhaseSummary"],
): ResolvedSessionNavigation | null {
  if (!sdkInfo && !bridgeState) return null;
  const sdkGitAhead = sdkInfo?.gitAhead ?? 0;
  const sdkGitBehind = sdkInfo?.gitBehind ?? 0;
  const gitAhead =
    bridgeState?.git_ahead === 0 && sdkGitAhead > 0 ? sdkGitAhead : (bridgeState?.git_ahead ?? sdkGitAhead);
  const gitBehind =
    bridgeState?.git_behind === 0 && sdkGitBehind > 0 ? sdkGitBehind : (bridgeState?.git_behind ?? sdkGitBehind);
  const serverLinesAdded = bridgeState?.total_lines_added ?? sdkInfo?.totalLinesAdded ?? 0;
  const serverLinesRemoved = bridgeState?.total_lines_removed ?? sdkInfo?.totalLinesRemoved ?? 0;
  const localLineStats = sumDiffFileStats(source.diffFileStats?.get(sessionId));
  const useLocalLineStats =
    serverLinesAdded === 0 &&
    serverLinesRemoved === 0 &&
    (localLineStats.additions > 0 || localLineStats.deletions > 0);
  const livePermissions = source.pendingPermissions?.get(sessionId);
  const permCount = livePermissions
    ? (source.countUserPermissions?.(livePermissions) ?? livePermissions.size)
    : (sdkInfo?.pendingPermissionCount ?? 0);
  const pause = bridgeState?.pause ?? sdkInfo?.pause ?? null;
  const viewModel = coalesceSessionViewModel(bridgeState, sdkInfo) ?? {
    sessionId,
  };
  const name = source.sessionNames?.get(sessionId) ?? sdkInfo?.name ?? viewModel.name;
  const preview = (source.sessionPreviews?.get(sessionId) ?? sdkInfo?.lastMessagePreview) || undefined;
  const cliConnected = source.cliConnected?.get(sessionId) ?? sdkInfo?.cliConnected ?? false;
  const disconnectReason = source.cliDisconnectReason?.get(sessionId);
  const status = source.sessionStatus?.get(sessionId);
  const askPermission = source.askPermission?.get(sessionId);
  const cacheKey = bridgeState ?? sdkInfo;
  const cached = cacheKey ? legacyResolutionCache.get(cacheKey) : undefined;
  if (
    cached &&
    cached.sdkInfo === sdkInfo &&
    cached.bridgeState === bridgeState &&
    cached.cliConnected === cliConnected &&
    cached.disconnectReason === disconnectReason &&
    cached.status === status &&
    cached.permCount === permCount &&
    cached.askPermission === askPermission &&
    cached.localLinesAdded === localLineStats.additions &&
    cached.localLinesRemoved === localLineStats.deletions &&
    cached.name === name &&
    cached.preview === preview &&
    cached.leaderActivePhaseSummary === leaderActivePhaseSummary
  ) {
    return cached.result;
  }

  const result: ResolvedSessionNavigation = {
    sidebarItem: {
      id: sessionId,
      claimedQuestStatus: bridgeState?.claimedQuestStatus ?? sdkInfo?.claimedQuestStatus ?? undefined,
      claimedQuestVerificationInboxUnread:
        bridgeState?.claimedQuestVerificationInboxUnread ?? sdkInfo?.claimedQuestVerificationInboxUnread,
      model: bridgeState?.model || sdkInfo?.model || "",
      cwd: bridgeState?.cwd || sdkInfo?.cwd || "",
      gitBranch: bridgeState?.git_branch || sdkInfo?.gitBranch || "",
      isContainerized: bridgeState?.is_containerized || !!sdkInfo?.containerId || false,
      gitAhead,
      gitBehind,
      linesAdded: useLocalLineStats ? localLineStats.additions : serverLinesAdded,
      linesRemoved: useLocalLineStats ? localLineStats.deletions : serverLinesRemoved,
      diffStatsSkippedReason: bridgeState?.diff_stats_skipped_reason ?? sdkInfo?.diffStatsSkippedReason ?? null,
      gitStatusRefreshedAt: bridgeState?.git_status_refreshed_at ?? sdkInfo?.gitStatusRefreshedAt,
      gitStatusRefreshError: bridgeState?.git_status_refresh_error ?? sdkInfo?.gitStatusRefreshError ?? null,
      isConnected: cliConnected,
      status: status ?? null,
      sdkState: sdkInfo?.state ?? null,
      createdAt: sdkInfo?.createdAt ?? 0,
      archived: sdkInfo?.archived ?? false,
      archivedAt: sdkInfo?.archivedAt,
      backendType: bridgeState?.backend_type || sdkInfo?.backendType || "claude",
      treeGroupId: bridgeState?.treeGroupId ?? sdkInfo?.treeGroupId ?? null,
      memorySessionSpaceSlug: bridgeState?.memorySessionSpaceSlug ?? sdkInfo?.memorySessionSpaceSlug ?? null,
      repoRoot: bridgeState?.repo_root || sdkInfo?.repoRoot || "",
      permCount,
      pendingTimerCount: sdkInfo?.pendingTimerCount ?? 0,
      notificationUrgency: sdkInfo?.notificationUrgency ?? null,
      activeNotificationCount: sdkInfo?.activeNotificationCount ?? 0,
      activeNeedsInputNotificationCount: sdkInfo?.activeNeedsInputNotificationCount ?? 0,
      activeReviewNotificationCount: sdkInfo?.activeReviewNotificationCount ?? 0,
      mutedNeedsInputNotificationCount: sdkInfo?.mutedNeedsInputNotificationCount ?? 0,
      notificationStatusVersion: sdkInfo?.notificationStatusVersion,
      notificationStatusUpdatedAt: sdkInfo?.notificationStatusUpdatedAt,
      pause,
      paused: !!pause?.pausedAt,
      pausedInputQueueCount:
        bridgeState?.pause?.queuedMessages.length ??
        sdkInfo?.pausedInputQueueCount ??
        sdkInfo?.pause?.queuedMessages.length ??
        0,
      cronJobId: bridgeState?.cronJobId || sdkInfo?.cronJobId,
      cronJobName: bridgeState?.cronJobName || sdkInfo?.cronJobName,
      isWorktree: bridgeState?.is_worktree || sdkInfo?.isWorktree || false,
      worktreeExists: sdkInfo?.worktreeExists,
      worktreeDirty: sdkInfo?.worktreeDirty,
      worktreeCleanupStatus: sdkInfo?.worktreeCleanupStatus,
      worktreeCleanupError: sdkInfo?.worktreeCleanupError,
      askPermission,
      idleKilled: disconnectReason === "idle_limit",
      lastActivityAt: sdkInfo?.lastActivityAt,
      lastUserMessageAt: sdkInfo?.lastUserMessageAt,
      isOrchestrator: sdkInfo?.isOrchestrator || false,
      leaderProfilePortraitId: sdkInfo?.leaderProfilePortraitId ?? null,
      leaderProfilePortrait: sdkInfo?.leaderProfilePortrait,
      leaderActivePhaseSummary,
      leaderActiveBoardRows: sdkInfo?.leaderActiveBoardRows,
      herdedBy: sdkInfo?.herdedBy,
      sessionNum: sdkInfo?.sessionNum ?? null,
      reviewerOf: sdkInfo?.reviewerOf,
    },
    name,
    preview,
    viewModel,
    paused: !!pause?.pausedAt,
    projectionState: "legacy",
  };
  if (cacheKey) {
    legacyResolutionCache.set(cacheKey, {
      sdkInfo,
      bridgeState,
      cliConnected,
      disconnectReason,
      status,
      permCount,
      askPermission,
      localLinesAdded: localLineStats.additions,
      localLinesRemoved: localLineStats.deletions,
      name,
      preview,
      leaderActivePhaseSummary,
      result,
    });
  }
  return result;
}

export function resolveSessionNavigation<TPermission>(
  source: SessionNavigationResolverSource<TPermission>,
  sessionId: string,
): ResolvedSessionNavigation | null {
  const sdkInfo = source.sdkSessions.find((session) => session.sessionId === sessionId);
  const bridgeState = source.sessions.get(sessionId);
  const leaderActivePhaseSummary = selectLeaderActivePhaseSummary(source, sessionId);
  const cacheState = projectionCacheState(source as SessionNavigationResolverSource<unknown>);
  if (hasSyncedProjectionValue(cacheState, SESSION_NAVIGATION_PROJECTION, sessionId)) {
    const projection = getSyncedProjectionValue(cacheState, SESSION_NAVIGATION_PROJECTION, sessionId);
    if (projection) {
      return resolveProjectedSession(
        source as SessionNavigationResolverSource<unknown>,
        sessionId,
        projection,
        sdkInfo,
        bridgeState,
        leaderActivePhaseSummary,
      );
    }
  }
  if (hasSuppliedNavigationEnvelope(sdkInfo)) return resolveInvalidSuppliedSession(sessionId, sdkInfo!);
  return resolveLegacySession(source, sessionId, sdkInfo, bridgeState, leaderActivePhaseSummary);
}
