import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { resolveSessionNavigation } from "./session-navigation-resolver.js";
import { buildTreeViewGroups } from "./tree-grouping.js";
import { isAttentionRecordActive } from "./attention-records.js";
import { deriveEffectiveSessionAttentionStatus } from "./session-attention-status.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import { normalizeLeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import { SESSION_ATTENTION_PROJECTION } from "../../shared/session-attention-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type {
  TreeGroup,
  SessionTaskEntry,
  SdkSessionInfo,
  SessionAttentionRecord,
  SessionNotification,
  SessionState,
} from "../types.js";

type SessionAttentionReason = "action" | "error" | "review" | null;

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
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
  sessionNotifications?: Map<string, SessionNotification[]>;
  sessionAttentionRecords?: Map<string, SessionAttentionRecord[]>;
  sessionNames?: Map<string, string>;
  sessionPreviews?: Map<string, string>;
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
  resolvedSessionNames: Map<string, string>;
  resolvedSessionPreviews: Map<string, string>;
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

function hasFreshActiveReviewSummary(session: SdkSessionInfo | undefined): boolean {
  const hasFreshStatus =
    session?.notificationStatusVersion !== undefined || session?.notificationStatusUpdatedAt !== undefined;
  const activeReviewCount = session?.activeReviewNotificationCount ?? session?.activeNotificationCount ?? 0;
  return hasFreshStatus && session?.notificationUrgency === "review" && activeReviewCount > 0;
}

export function deriveSessionSetAttention({
  sessionAttention,
  syncedProjectionKeys,
  sdkSessions,
  sessionNotifications,
  sessionAttentionRecords,
}: {
  sessionAttention: Map<string, SessionAttentionReason>;
  syncedProjectionValues?: Map<string, unknown>;
  syncedProjectionKeys?: Set<string>;
  sdkSessions: SdkSessionInfo[];
  sessionNotifications?: Map<string, SessionNotification[]>;
  sessionAttentionRecords?: Map<string, SessionAttentionRecord[]>;
}): Map<string, SessionAttentionReason> {
  const sdkById = new Map(sdkSessions.map((session) => [session.sessionId, session]));
  const result = new Map<string, SessionAttentionReason>();
  const sessionIds = new Set<string>([
    ...sdkById.keys(),
    ...sessionAttention.keys(),
    ...(sessionNotifications?.keys() ?? []),
  ]);
  for (const sessionId of sessionIds) {
    const attention = sessionAttention.get(sessionId) ?? null;
    const sdkSession = sdkById.get(sessionId);
    if (syncedProjectionKeys?.has(syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, sessionId))) {
      result.set(sessionId, attention);
      continue;
    }
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
    if (
      nextAttention === "review" &&
      sdkSession?.isOrchestrator &&
      !sessionNotifications?.has(sessionId) &&
      !hasFreshActiveReviewSummary(sdkSession)
    ) {
      // Legacy raw attention has no discoverable-target proof until the inbox
      // loads. A fresh active server summary is already filtered to open tabs.
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
    syncedProjectionValues,
    syncedProjectionKeys,
    sessionNotifications,
    sessionAttentionRecords,
    sessionNames,
    sessionPreviews,
    sessionSortMode,
    countUserPermissions,
  } = input;
  const sessionSetAttention = deriveSessionSetAttention({
    sessionAttention,
    syncedProjectionKeys,
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

  const resolvedSessionNames = new Map(sessionNames ?? []);
  const resolvedSessionPreviews = new Map(sessionPreviews ?? []);
  const allSessionList: SidebarSessionItem[] = Array.from(allSessionIds)
    .flatMap((id) => {
      const resolved = resolveSessionNavigation(
        {
          sessions,
          sdkSessions,
          syncedProjectionValues,
          syncedProjectionKeys,
          cliConnected,
          cliDisconnectReason,
          sessionStatus,
          pendingPermissions,
          askPermission,
          diffFileStats,
          sessionNames,
          sessionPreviews,
          countUserPermissions,
        },
        id,
      );
      if (!resolved) return [];
      if (resolved.name) resolvedSessionNames.set(id, resolved.name);
      else if (resolved.projectionState !== "legacy") resolvedSessionNames.delete(id);
      if (resolved.preview) resolvedSessionPreviews.set(id, resolved.preview);
      else if (resolved.projectionState !== "legacy") resolvedSessionPreviews.delete(id);
      return [resolved.sidebarItem];
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
    resolvedSessionNames,
    resolvedSessionPreviews,
  };
}
