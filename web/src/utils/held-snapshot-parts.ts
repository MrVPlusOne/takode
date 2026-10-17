import { snapshotPartHash, type KnownSnapshotParts } from "../../shared/snapshot-part-hash.js";
import { useStore } from "../store.js";
import { receivedListHash } from "./synced-lists.js";

// Hashing the completed board (hundreds of KB) on every switch would be wasted
// work: the store replaces these values whenever they change, so each value is
// hashed once.
const completedBoardHashes = new WeakMap<object, string>();
const treeGroupHashes = new WeakMap<object, { assignments: object; nodeOrder: object; hash: string }>();

/**
 * Hashes of the large subscribe snapshot parts this browser holds for a
 * session, named in its subscribe so the server can leave out parts that are
 * still identical, or send only what changed in a list. Parts the browser has
 * not received are not named.
 */
export function heldSnapshotParts(sessionId: string): KnownSnapshotParts {
  const state = useStore.getState();
  const parts: KnownSnapshotParts = {};
  const notifications = receivedListHash("notifications", sessionId);
  if (notifications) parts.notifications = notifications;
  const attentionRecords = receivedListHash("attention_records", sessionId);
  if (attentionRecords) parts.attention_records = attentionRecords;
  const completedBoard = state.sessionCompletedBoards.get(sessionId);
  if (completedBoard) {
    let hash = completedBoardHashes.get(completedBoard);
    if (!hash) {
      hash = snapshotPartHash(completedBoard);
      completedBoardHashes.set(completedBoard, hash);
    }
    parts.completed_board = hash;
  }
  if (state.treeGroups.length > 0) parts.tree_groups = heldTreeGroupsHash();
  return parts;
}

/** Hash of the session tree groups this browser holds, as the server hashes the tree groups it sent. */
export function heldTreeGroupsHash(): string {
  const { treeGroups, treeAssignments, treeNodeOrder } = useStore.getState();
  const cached = treeGroupHashes.get(treeGroups);
  if (cached && cached.assignments === treeAssignments && cached.nodeOrder === treeNodeOrder) return cached.hash;
  // The same shape the server hashes: the tree_groups_update fields as received.
  const hash = snapshotPartHash({
    groups: treeGroups,
    assignments: Object.fromEntries(treeAssignments),
    nodeOrder: Object.fromEntries(treeNodeOrder),
  });
  treeGroupHashes.set(treeGroups, { assignments: treeAssignments, nodeOrder: treeNodeOrder, hash });
  return hash;
}
