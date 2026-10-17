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
    const completedBoard = JSON.parse(JSON.stringify([{ questId: "q-1", title: "Done" }]));
    const tree = {
      groups: [{ id: "g1", name: "Group" }],
      assignments: { s1: "g1", s2: "g1" },
      nodeOrder: { g1: ["s2", "s1"] },
    };
    const received = JSON.parse(JSON.stringify(tree));
    useStore.getState().setSessionCompletedBoard("leader", completedBoard);
    useStore.getState().setTreeGroups(received.groups, received.assignments, received.nodeOrder);

    expect(heldSnapshotParts("leader")).toEqual({
      completed_board: snapshotPartHash([{ questId: "q-1", title: "Done" }]),
      tree_groups: snapshotPartHash(tree),
    });
    // Another session's completed board is not held.
    expect(heldSnapshotParts("other")).toEqual({ tree_groups: snapshotPartHash(tree) });
  });

  // Notification and attention lists are named by the server's hash of the
  // list it last sent, which their changes build on.
  it("names the hash of the notification and attention lists the server last sent", () => {
    const list = [{ id: "n-1" }];
    receiveSyncedList("notifications", "named", { list, hash: "server-hash" }, (entry) => entry.id);
    expect(heldSnapshotParts("named")).toEqual({ notifications: "server-hash" });
  });

  it("follows replaced values instead of a remembered hash", () => {
    useStore.getState().setSessionCompletedBoard("leader", [{ questId: "q-1" }] as never);
    const first = heldSnapshotParts("leader").completed_board;
    useStore.getState().setSessionCompletedBoard("leader", [{ questId: "q-2" }] as never);
    expect(heldSnapshotParts("leader").completed_board).not.toBe(first);
  });
});
