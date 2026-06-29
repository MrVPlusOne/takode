import { api } from "../api.js";
import type { ContextMenuItem } from "./ContextMenu.js";

/** Build "Move to..." submenu items for the session context menu. */
export function buildMoveToSubmenu(
  treeGroups: Array<{ id: string; name: string }>,
  treeAssignments: Map<string, string>,
  sessionId: string,
): ContextMenuItem[] {
  if (treeGroups.length === 0) return [];
  const currentGroup = treeAssignments.get(sessionId) || "default";
  const otherGroups = treeGroups.filter((group) => group.id !== currentGroup);
  if (otherGroups.length === 0) return [];
  return [
    {
      label: "Move to Session Space...",
      onClick: () => {},
      children: otherGroups.map((group) => ({
        label: group.name,
        onClick: () => {
          api.assignSessionToTreeGroup(sessionId, group.id).catch(console.error);
        },
      })),
    },
  ];
}
