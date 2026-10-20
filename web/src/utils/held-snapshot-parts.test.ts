import { beforeEach, describe, expect, it } from "vitest";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";
import { useStore } from "../store.js";
import { heldSnapshotParts } from "./held-snapshot-parts.js";
import { receiveSyncedList } from "./synced-lists.js";

// The browser names hashes of what it holds; they must equal the server's
// hashes of the same data as sent, or every revisit would download it again.
describe("heldSnapshotParts", () => {
  beforeEach(() => useStore.getState().reset());

  it("names nothing before the parts arrive", () => {
    expect(heldSnapshotParts("leader")).toEqual({});
  });

  it("hashes held parts exactly as the server hashes what it sent", () => {
    const board = JSON.parse(JSON.stringify([{ questId: "q-1", title: "Active" }]));
    const tree = {
      groups: [{ id: "g1", name: "Group" }],
      assignments: { s1: "g1", s2: "g1" },
      nodeOrder: { g1: ["s2", "s1"] },
    };
    const received = JSON.parse(JSON.stringify(tree));
    useStore.getState().setSessionBoard("leader", board);
    useStore.getState().setTreeGroups(received.groups, received.assignments, received.nodeOrder);

    expect(heldSnapshotParts("leader")).toEqual({
      board: snapshotPartHash([{ questId: "q-1", title: "Active" }]),
      tree_groups: snapshotPartHash(tree),
    });
    // Another session's board is not held.
    expect(heldSnapshotParts("other")).toEqual({ tree_groups: snapshotPartHash(tree) });
  });

  // Lists sent as changes are named by the server's hash of the list it last
  // sent, which their changes build on.
  it("names the hash of each list the server last sent", () => {
    const list = [{ id: "n-1", questId: "q-1", threadKey: "q-1" }];
    receiveSyncedList("notifications", "named", { list, hash: "notifications-hash" }, (entry) => entry.id);
    receiveSyncedList("completed_board", "named", { list, hash: "board-hash" }, (entry) => entry.questId);
    receiveSyncedList("thread_summaries", "named", { list, hash: "summaries-hash" }, (entry) => entry.threadKey);
    expect(heldSnapshotParts("named")).toEqual({
      notifications: "notifications-hash",
      completed_board: "board-hash",
      thread_summaries: "summaries-hash",
    });
  });

  it("follows replaced values instead of a remembered hash", () => {
    useStore.getState().setSessionBoard("leader", [{ questId: "q-1" }] as never);
    const first = heldSnapshotParts("leader").board;
    useStore.getState().setSessionBoard("leader", [{ questId: "q-2" }] as never);
    expect(heldSnapshotParts("leader").board).not.toBe(first);
  });
});
