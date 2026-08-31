import type { SidebarSessionItem } from "./sidebar-session-item.js";
import { resolveSessionNavigation } from "./session-navigation-resolver.js";
import { buildTreeViewGroups } from "./tree-grouping.js";
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
