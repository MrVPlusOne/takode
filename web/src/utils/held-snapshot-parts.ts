import { snapshotPartHash, type KnownSnapshotParts } from "../../shared/snapshot-part-hash.js";
import { useStore } from "../store.js";
import { receivedListHash, type SyncedListKind } from "./synced-lists.js";
import { heldViewportHandoffStateIdentity } from "./viewport-handoff-client.js";

// The store replaces these values whenever they change, so each value is hashed once.
const boardHashes = new WeakMap<object, string>();

/** Snapshot parts named by the hash the server sent with the list (see `synced-lists.ts`). */
const RECEIVED_LIST_PARTS: ReadonlyArray<[keyof KnownSnapshotParts, SyncedListKind]> = [
  ["notifications", "notifications"],
  ["attention_records", "attention_records"],
  ["completed_board", "completed_board"],
  ["row_session_statuses", "row_session_statuses"],
  ["thread_summaries", "thread_summaries"],
  ["message_attention_records", "message_attention_records"],
];
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
  for (const [part, kind] of RECEIVED_LIST_PARTS) {
    const hash = receivedListHash(kind, sessionId);
    if (hash) parts[part] = hash;
  }
  const board = state.sessionBoards.get(sessionId);
  if (board) {
    let hash = boardHashes.get(board);
    if (!hash) {
      hash = snapshotPartHash(board);
      boardHashes.set(board, hash);
    }
    parts.board = hash;
  }
  const viewportHandoff = heldViewportHandoffStateIdentity(sessionId);
  if (viewportHandoff) parts.viewport_handoff = viewportHandoff;
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
