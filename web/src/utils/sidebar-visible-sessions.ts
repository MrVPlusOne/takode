import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { buildTreeViewGroups } from "./tree-grouping.js";
import { isAttentionRecordActive } from "./attention-records.js";
import { deriveEffectiveSessionAttentionStatus } from "./session-attention-status.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import { normalizeLeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import type {
  TreeGroup,
  SessionTaskEntry,
  SdkSessionInfo,
  SessionAttentionRecord,
  SessionNotification,
  SessionState,
} from "../types.js";

type SessionAttentionReason = "action" | "error" | "review" | null;

function sumDiffFileStats(fileStats: Map<string, { additions: number; deletions: number }> | undefined) {
  let additions = 0;
  let deletions = 0;
  for (const stats of fileStats?.values() ?? []) {
    additions += stats.additions;
    deletions += stats.deletions;
  }
  return { additions, deletions };
}

export interface SidebarVisibleSessionsInput {
  sessions: Map<string, SessionState>;
  sdkSessions: SdkSessionInfo[];
  cliConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | "recovery_suppressed" | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  askPermission: Map<string, boolean>;
  diffFileStats: Map<string, Map<string, { additions: number; deletions: number }>>;
  treeGroups: TreeGroup[];
  treeAssignments: Map<string, string>;
  treeNodeOrder: Map<string, string[]>;
  collapsedTreeGroups: Set<string>;
  expandedHerdNodes: Set<string>;
  sessionAttention: Map<string, SessionAttentionReason>;
  sessionNotifications?: Map<string, SessionNotification[]>;
  sessionAttentionRecords?: Map<string, SessionAttentionRecord[]>;
  sessionSortMode: "created" | "activity";
  countUserPermissions: (perms: Map<string, unknown> | undefined) => number;
}

export interface SidebarVisibleSessionsResult {
  allSessionList: SidebarSessionItem[];
  activeSessions: SidebarSessionItem[];
  activeReviewers: SidebarSessionItem[];
  cronSessions: SidebarSessionItem[];
  archivedSessions: SidebarSessionItem[];
  orderedVisibleSessionIds: string[];
  treeViewGroups: ReturnType<typeof buildTreeViewGroups>;
  sessionSetAttention: Map<string, SessionAttentionReason>;
}

function isBlueNotificationAttention(record: SessionAttentionRecord): boolean {
  if (!isAttentionRecordActive(record)) return false;
  if (record.source.kind !== "notification") return false;
  return record.priority === "review" || record.priority === "completed" || record.type === "review_ready";
}

function openThreadKeySet(session: SdkSessionInfo | undefined): Set<string> {
  const keys = new Set<string>([MAIN_THREAD_KEY]);
  const openTabs = normalizeLeaderOpenThreadTabsState(session?.leaderOpenThreadTabs);
  for (const key of openTabs?.orderedOpenThreadKeys ?? []) keys.add(normalizeThreadKey(key));
  return keys;
}

function hasOpenBlueThreadTab(
  session: SdkSessionInfo | undefined,
  records: ReadonlyArray<SessionAttentionRecord>,
): boolean {
  const openKeys = openThreadKeySet(session);
  return records.some((record) => {
    if (!isBlueNotificationAttention(record)) return false;
    const threadKey = normalizeThreadKey(
      record.route.threadKey || record.threadKey || record.questId || MAIN_THREAD_KEY,
    );
    return openKeys.has(threadKey);
  });
}

export function deriveSessionSetAttention({
  sessionAttention,
  sdkSessions,
  sessionNotifications,
  sessionAttentionRecords,
}: {
  sessionAttention: Map<string, SessionAttentionReason>;
  sdkSessions: SdkSessionInfo[];
  sessionNotifications?: Map<string, SessionNotification[]>;
  sessionAttentionRecords?: Map<string, SessionAttentionRecord[]>;
}): Map<string, SessionAttentionReason> {
  const sdkById = new Map(sdkSessions.map((session) => [session.sessionId, session]));
  const result = new Map<string, SessionAttentionReason>();
  const sessionIds = new Set<string>([...sessionAttention.keys(), ...(sessionNotifications?.keys() ?? [])]);
  for (const sessionId of sessionIds) {
    const attention = sessionAttention.get(sessionId) ?? null;
    const sdkSession = sdkById.get(sessionId);
    if (attention === "error") {
      result.set(sessionId, "error");
      continue;
    }
    const effectiveStatus = deriveEffectiveSessionAttentionStatus({
      sessionId,
      notifications: sessionNotifications?.get(sessionId),
      summary: sdkSession,
      fallbackSummary: sdkSession,
      fallbackUrgency: sdkSession?.notificationUrgency ?? null,
      attention,
    });
    const nextAttention =
      effectiveStatus?.urgency === "needs-input" ? "action" : effectiveStatus?.urgency === "review" ? "review" : null;
    if (nextAttention === "review" && sdkSession?.isOrchestrator && !sessionNotifications?.has(sessionId)) {
      result.set(
        sessionId,
        hasOpenBlueThreadTab(sdkSession, sessionAttentionRecords?.get(sessionId) ?? []) ? "review" : null,
      );
      continue;
    }
    result.set(sessionId, nextAttention);
  }
  return result;
}

export function buildSidebarVisibleSessions(input: SidebarVisibleSessionsInput): SidebarVisibleSessionsResult {
  const {
    sessions,
    sdkSessions,
    cliConnected,
    cliDisconnectReason,
    sessionStatus,
    pendingPermissions,
    askPermission,
    diffFileStats,
    treeGroups,
    treeAssignments,
    treeNodeOrder,
    collapsedTreeGroups,
    expandedHerdNodes,
    sessionAttention,
    sessionNotifications,
    sessionAttentionRecords,
    sessionSortMode,
    countUserPermissions,
  } = input;
  const sessionSetAttention = deriveSessionSetAttention({
    sessionAttention,
    sdkSessions,
    sessionNotifications,
    sessionAttentionRecords,
  });

  const allSessionIds = new Set<string>();
  const slackThreadChildIds = new Set<string>();
  for (const state of sessions.values()) {
    for (const thread of Object.values(state.slackThreads ?? {})) {
      if (thread.childSessionId) slackThreadChildIds.add(thread.childSessionId);
    }
  }
  const isHiddenSession = (id: string): boolean => {
    const bridgeState = sessions.get(id);
    const sdkInfo = sdkSessions.find((session) => session.sessionId === id);
    return (
      bridgeState?.hidden === true ||
      !!bridgeState?.slackThreadChild ||
      sdkInfo?.hidden === true ||
      slackThreadChildIds.has(id)
    );
  };
  for (const id of sessions.keys()) {
    if (!isHiddenSession(id)) allSessionIds.add(id);
  }
  for (const session of sdkSessions) {
    if (!isHiddenSession(session.sessionId)) allSessionIds.add(session.sessionId);
  }

  const allSessionList: SidebarSessionItem[] = Array.from(allSessionIds)
    .map((id) => {
      const bridgeState = sessions.get(id);
      const sdkInfo = sdkSessions.find((session) => session.sessionId === id);
      const sdkGitAhead = sdkInfo?.gitAhead ?? 0;
      const sdkGitBehind = sdkInfo?.gitBehind ?? 0;
      const gitAhead =
        bridgeState?.git_ahead === 0 && sdkGitAhead > 0 ? sdkGitAhead : (bridgeState?.git_ahead ?? sdkGitAhead);
      const gitBehind =
        bridgeState?.git_behind === 0 && sdkGitBehind > 0 ? sdkGitBehind : (bridgeState?.git_behind ?? sdkGitBehind);
      const serverLinesAdded = bridgeState?.total_lines_added ?? sdkInfo?.totalLinesAdded ?? 0;
      const serverLinesRemoved = bridgeState?.total_lines_removed ?? sdkInfo?.totalLinesRemoved ?? 0;
      const gitStatusRefreshedAt = bridgeState?.git_status_refreshed_at ?? sdkInfo?.gitStatusRefreshedAt;
      const gitStatusRefreshError = bridgeState?.git_status_refresh_error ?? sdkInfo?.gitStatusRefreshError ?? null;
      const diffStatsSkippedReason = bridgeState?.diff_stats_skipped_reason ?? sdkInfo?.diffStatsSkippedReason ?? null;
      const localLineStats = sumDiffFileStats(diffFileStats.get(id));
      const linesAdded =
        serverLinesAdded === 0 &&
        serverLinesRemoved === 0 &&
        (localLineStats.additions > 0 || localLineStats.deletions > 0)
          ? localLineStats.additions
          : serverLinesAdded;
      const linesRemoved =
        serverLinesAdded === 0 &&
        serverLinesRemoved === 0 &&
        (localLineStats.additions > 0 || localLineStats.deletions > 0)
          ? localLineStats.deletions
          : serverLinesRemoved;
      return {
        id,
        claimedQuestStatus: bridgeState?.claimedQuestStatus ?? sdkInfo?.claimedQuestStatus ?? undefined,
        claimedQuestVerificationInboxUnread:
          bridgeState?.claimedQuestVerificationInboxUnread ?? sdkInfo?.claimedQuestVerificationInboxUnread,
        model: bridgeState?.model || sdkInfo?.model || "",
        cwd: bridgeState?.cwd || sdkInfo?.cwd || "",
        gitBranch: bridgeState?.git_branch || sdkInfo?.gitBranch || "",
        isContainerized: bridgeState?.is_containerized || !!sdkInfo?.containerId || false,
        gitAhead,
        gitBehind,
        linesAdded,
        linesRemoved,
        diffStatsSkippedReason,
        gitStatusRefreshedAt,
        gitStatusRefreshError,
        isConnected: cliConnected.get(id) ?? sdkInfo?.cliConnected ?? false,
        status: sessionStatus.get(id) ?? null,
        sdkState: sdkInfo?.state ?? null,
        createdAt: sdkInfo?.createdAt ?? 0,
        archived: sdkInfo?.archived ?? false,
        archivedAt: sdkInfo?.archivedAt,
        backendType: bridgeState?.backend_type || sdkInfo?.backendType || "claude",
        treeGroupId: bridgeState?.treeGroupId ?? sdkInfo?.treeGroupId ?? null,
        memorySessionSpaceSlug: bridgeState?.memorySessionSpaceSlug ?? sdkInfo?.memorySessionSpaceSlug ?? null,
        repoRoot: bridgeState?.repo_root || sdkInfo?.repoRoot || "",
        permCount: countUserPermissions(pendingPermissions.get(id)),
        pendingTimerCount: sdkInfo?.pendingTimerCount ?? 0,
        notificationUrgency: sdkInfo?.notificationUrgency ?? null,
        activeNotificationCount: sdkInfo?.activeNotificationCount ?? 0,
        mutedNeedsInputNotificationCount: sdkInfo?.mutedNeedsInputNotificationCount ?? 0,
        notificationStatusVersion: sdkInfo?.notificationStatusVersion,
        notificationStatusUpdatedAt: sdkInfo?.notificationStatusUpdatedAt,
        pause: bridgeState?.pause ?? sdkInfo?.pause ?? null,
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
        askPermission: askPermission.get(id),
        idleKilled: cliDisconnectReason.get(id) === "idle_limit",
        lastActivityAt: sdkInfo?.lastActivityAt,
        lastUserMessageAt: sdkInfo?.lastUserMessageAt,
        isOrchestrator: sdkInfo?.isOrchestrator || false,
        leaderProfilePortraitId: sdkInfo?.leaderProfilePortraitId ?? null,
        leaderProfilePortrait: sdkInfo?.leaderProfilePortrait,
        leaderActivePhaseSummary: sdkInfo?.leaderActivePhaseSummary,
        leaderActiveBoardRows: sdkInfo?.leaderActiveBoardRows,
        herdedBy: sdkInfo?.herdedBy,
        sessionNum: sdkInfo?.sessionNum ?? null,
        reviewerOf: sdkInfo?.reviewerOf,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  const activeSessions = allSessionList.filter(
    (session) => !session.archived && !session.cronJobId && session.reviewerOf === undefined,
  );
  const activeReviewers = allSessionList.filter((session) => !session.archived && session.reviewerOf !== undefined);
  const attachedReviewers = allSessionList.filter((session) => session.reviewerOf !== undefined && !session.cronJobId);
  const cronSessions = allSessionList.filter((session) => !session.archived && !!session.cronJobId);
  const archivedSessions = allSessionList
    .filter((session) => session.archived && session.reviewerOf === undefined)
    .sort((a, b) => (b.archivedAt ?? b.createdAt) - (a.archivedAt ?? a.createdAt));

  const treeViewGroups = buildTreeViewGroups(
    activeSessions,
    treeGroups,
    treeAssignments,
    sessionSetAttention,
    sessionSortMode,
    treeNodeOrder,
    attachedReviewers,
  );
  const orderedVisibleSessionIds = treeViewGroups.flatMap((group) => {
    if (collapsedTreeGroups.has(group.id)) return [];
    return group.nodes.flatMap((node) => {
      const visibleIds = [node.leader.id];
      if (expandedHerdNodes.has(node.leader.id)) {
        visibleIds.push(...node.workers.map((worker) => worker.id));
      }
      return visibleIds;
    });
  });

  return {
    allSessionList,
    activeSessions,
    activeReviewers,
    cronSessions,
    archivedSessions,
    orderedVisibleSessionIds,
    treeViewGroups,
    sessionSetAttention,
  };
}
