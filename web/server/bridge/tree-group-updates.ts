import type { BrowserIncomingMessage } from "../session-types.js";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";
import { KeyedListVersions, type KeyedListSync } from "./keyed-list-versions.js";

type TreeGroupsUpdate = Extract<BrowserIncomingMessage, { type: "tree_groups_update" }>;

/** The session tree groups as the tree-group store holds them. */
export interface TreeGroupState {
  groups: TreeGroupsUpdate["treeGroups"];
  assignments: Record<string, string>;
  nodeOrder?: Record<string, string[]>;
}

/**
 * `tree_groups_update` messages. The assignments map every session ever
 * created to its group (thousands of entries, hundreds of KB), while a change
 * moves one or two sessions, so browsers holding a recent copy get only the
 * changed assignments. Browsers identify their copy by `snapshotPartHash` of
 * the whole tree-group state, as in `known_snapshot_parts.tree_groups`.
 */
export function createTreeGroupUpdates(recentVersions: number) {
  const versions = new KeyedListVersions<[string, string]>((entry) => entry[0], recentVersions);

  function sync(state: TreeGroupState, held: string | undefined | "broadcast") {
    const part = { groups: state.groups, assignments: state.assignments, nodeOrder: state.nodeOrder ?? {} };
    const entries = Object.entries(part.assignments);
    const hash = snapshotPartHash(part);
    const result = held === "broadcast" ? versions.broadcast(entries, hash) : versions.sync(entries, held, hash);
    return { part, result };
  }

  function message(part: Required<TreeGroupState>, result: KeyedListSync<[string, string]>): TreeGroupsUpdate {
    return {
      type: "tree_groups_update",
      treeGroups: part.groups,
      ...(result.list ? { treeAssignments: Object.fromEntries(result.list) } : {}),
      ...(result.delta ? { treeAssignmentsDelta: result.delta } : {}),
      treeNodeOrder: part.nodeOrder,
      treeGroupsHash: result.hash,
    };
  }

  return {
    /** The update for one browser holding the tree groups hashed `held`; null when it holds the current ones. */
    forBrowser(state: TreeGroupState, held: string | undefined): TreeGroupsUpdate | null {
      const { part, result } = sync(state, held);
      return result.list || result.delta ? message(part, result) : null;
    },
    /**
     * The update every browser receives after a change. It is sent even when
     * nothing changed: a browser holding other tree groups then asks for them again.
     */
    forBroadcast(state: TreeGroupState): TreeGroupsUpdate {
      const { part, result } = sync(state, "broadcast");
      return message(part, result);
    },
  };
}

export const treeGroupUpdates = createTreeGroupUpdates(16);
