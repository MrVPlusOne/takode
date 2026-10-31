import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { resolveSessionNavigation } from "./session-navigation-resolver.js";
import { buildTreeViewGroups, type TreeNode } from "./tree-grouping.js";
import { buildRecentSessionNodes, type RecentSessionNode } from "./recent-sessions.js";
import type { TreeGroup, SessionTaskEntry, SdkSessionInfo } from "../types.js";

type SessionAttentionReason = "action" | "error" | "review" | null;

export interface SidebarVisibleSessionsInput {
  sdkSessions: SdkSessionInfo[];
  treeGroups: TreeGroup[];
  treeAssignments: Map<string, string>;
  treeNodeOrder: Map<string, string[]>;
  collapsedTreeGroups: Set<string>;
  expandedHerdNodes: Set<string>;
  sessionAttention: Map<string, SessionAttentionReason>;
  sessionSortMode: "created" | "activity";
  /** Defaults to the Session Space view. */
  sidebarViewMode?: "spaces" | "recent";
}

export interface SidebarVisibleSessionsResult {
  allSessionList: SidebarSessionItem[];
  activeSessions: SidebarSessionItem[];
  activeReviewers: SidebarSessionItem[];
  cronSessions: SidebarSessionItem[];
  archivedSessions: SidebarSessionItem[];
  orderedVisibleSessionIds: string[];
  treeViewGroups: ReturnType<typeof buildTreeViewGroups>;
  /** Every space's cards in one list, newest interaction first, for the Recent view. */
  recentNodes: RecentSessionNode[];
  sessionSetAttention: Map<string, SessionAttentionReason>;
}

export function buildSidebarVisibleSessions<TInput extends SidebarVisibleSessionsInput>(
  input: TInput,
): SidebarVisibleSessionsResult {
  const {
    sdkSessions,
    treeGroups,
    treeAssignments,
    treeNodeOrder,
    collapsedTreeGroups,
    expandedHerdNodes,
    sessionAttention,
    sessionSortMode,
    sidebarViewMode,
  } = input;
  const sessionSetAttention = sessionAttention;

  const allSessionIds = new Set(
    sdkSessions.filter((session) => session.hidden !== true).map((session) => session.sessionId),
  );

  const allSessionList: SidebarSessionItem[] = Array.from(allSessionIds)
    .flatMap((id) => {
      const resolved = resolveSessionNavigation({ sdkSessions }, id);
      return resolved ? [resolved.sidebarItem] : [];
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
  const recentNodes = buildRecentSessionNodes(treeViewGroups);
  const visibleIdsForNode = (node: TreeNode) =>
    expandedHerdNodes.has(node.leader.id)
      ? [node.leader.id, ...node.workers.map((worker) => worker.id)]
      : [node.leader.id];
  const orderedVisibleSessionIds =
    sidebarViewMode === "recent"
      ? recentNodes.flatMap(visibleIdsForNode)
      : treeViewGroups.flatMap((group) =>
          collapsedTreeGroups.has(group.id) ? [] : group.nodes.flatMap(visibleIdsForNode),
        );

  return {
    allSessionList,
    activeSessions,
    activeReviewers,
    cronSessions,
    archivedSessions,
    orderedVisibleSessionIds,
    treeViewGroups,
    recentNodes,
    sessionSetAttention,
  };
}
