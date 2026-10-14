import type { SidebarSessionItem } from "./sidebar-session-item.js";
import type { TreeNode, TreeViewGroupData } from "./tree-grouping.js";

/** A sidebar card in the Recent view: a leader with its herd, or a standalone session, tagged with its space. */
export interface RecentSessionNode extends TreeNode {
  spaceId: string;
  spaceName: string;
  /** When the card last saw interaction (see `treeNodeInteractionAt`); the list is sorted by it, newest first. */
  recentAt: number;
}

/**
 * Flatten the Session Space groups into one list ordered by recent
 * interaction, keeping each card's herd and space.
 */
export function buildRecentSessionNodes(groups: readonly TreeViewGroupData[]): RecentSessionNode[] {
  const nodes = groups.flatMap((group) =>
    group.nodes.map((node) => ({
      ...node,
      spaceId: group.id,
      spaceName: group.name,
      recentAt: treeNodeInteractionAt(node),
    })),
  );
  return nodes.sort((a, b) => b.recentAt - a.recentAt || b.leader.createdAt - a.leader.createdAt);
}

/**
 * When the user and a session last dealt with each other: the user's last
 * message there (typed messages, slash commands and needs-input answers), or
 * the session last asking for the user (becoming unread or raising a
 * needs-input question). Leader, herd and system messages do not count.
 */
export function sessionInteractionAt(session: SidebarSessionItem): number {
  return Math.max(session.lastUserMessageAt ?? 0, session.lastAttentionAt ?? 0);
}

/**
 * A card's interaction time: the latest of its root session's creation, the
 * root's interaction, and its workers' interaction, so answering a worker's
 * question brings its leader up.
 */
export function treeNodeInteractionAt(node: TreeNode): number {
  let latest = Math.max(node.leader.createdAt, sessionInteractionAt(node.leader));
  for (const worker of node.workers) latest = Math.max(latest, sessionInteractionAt(worker));
  return latest;
}
