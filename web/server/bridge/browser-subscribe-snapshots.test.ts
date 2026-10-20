import { describe, expect, it, vi } from "vitest";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";
import type { BrowserTransportSessionLike } from "./browser-transport-controller.js";
import {
  answerListResync,
  sendFeedAttentionSnapshot,
  sendInitialTreeGroupState,
  sendStateSnapshot,
} from "./browser-subscribe-snapshots.js";

// A revisit should not re-download large parts the browser still holds. The
// browser names hashes of its copies in the subscribe; the server leaves out a
// part only when its own copy hashes the same, and a state snapshot does not
// repeat notifications the same subscribe already sent.

const COMPLETED = [{ questId: "q-1", title: "Done work", status: "DONE" }];
const TREE = { groups: [{ id: "g1", name: "Group" }], assignments: { s1: "g1" }, nodeOrder: {} };

function session(): BrowserTransportSessionLike {
  return {
    id: "leader",
    state: { permissionMode: "default" },
    notifications: [{ id: "n-1", category: "needs-input", summary: "Question", timestamp: 1, done: false }],
    attentionRecords: [{ id: "a-1" }],
    messageHistory: [],
    isGenerating: false,
  } as any;
}

function deps() {
  return {
    backendConnected: vi.fn(() => true),
    deriveBackendState: vi.fn(() => "connected"),
    getBoard: vi.fn(() => []),
    getCompletedBoard: vi.fn(() => COMPLETED),
    getBoardRowSessionStatuses: vi.fn(() => ({})),
  } as any;
}

function socket(data: Record<string, unknown> = {}) {
  return { data, send: vi.fn() } as any;
}

function sent(ws: ReturnType<typeof socket>): any[] {
  return ws.send.mock.calls.map(([raw]: [string]) => JSON.parse(raw));
}

describe("subscribe snapshot parts the browser already holds", () => {
  it("leaves out the completed board only when the held copy hashes the same", () => {
    const held = socket({ knownSnapshotParts: { completed_board: snapshotPartHash(COMPLETED) } });
    sendStateSnapshot(session(), held, deps());
    expect(sent(held)[0]).not.toHaveProperty("completedBoard");

    const stale = socket({ knownSnapshotParts: { completed_board: snapshotPartHash([]) } });
    sendStateSnapshot(session(), stale, deps());
    expect(sent(stale)[0].completedBoard).toEqual(COMPLETED);

    const none = socket();
    sendStateSnapshot(session(), none, deps());
    expect(sent(none)[0].completedBoard).toEqual(COMPLETED);
  });

  it("leaves out the active board when the held copy hashes the same", () => {
    const active = [{ questId: "q-5", title: "Active work", status: "WORK" }];
    const board = deps();
    board.getBoard = vi.fn(() => active);
    const held = socket({ knownSnapshotParts: { board: snapshotPartHash(active) } });
    sendStateSnapshot(session(), held, board);
    expect(sent(held)[0]).not.toHaveProperty("board");

    const stale = socket({ knownSnapshotParts: { board: snapshotPartHash([]) } });
    sendStateSnapshot(session(), stale, board);
    expect(sent(stale)[0].board).toEqual(active);
  });

  // Completed rows keep final Memory's parked completion (debrief text) on the
  // server. Browsers never read it, so the snapshot sends rows without it, and
  // the held-copy hash is of that browser form: a browser holding exactly what
  // it was sent must still match, or every revisit would resend the board.
  it("sends completed rows without the parked completion and matches the browser's copy of them", () => {
    const landed = {
      questId: "q-2",
      title: "Landed work",
      status: "DONE",
      landing: {
        entryId: "e-1",
        tip: "abc",
        outcome: "landed",
        completion: { debrief: "Long debrief", debriefTldr: "TLDR" },
      },
    };
    const board = deps();
    board.getCompletedBoard = vi.fn(() => [landed]);
    const first = socket();
    sendStateSnapshot(session(), first, board);
    const browserCopy = sent(first)[0].completedBoard;
    expect(browserCopy).toEqual([{ ...landed, landing: { entryId: "e-1", tip: "abc", outcome: "landed" } }]);

    const revisit = socket({ knownSnapshotParts: { completed_board: snapshotPartHash(browserCopy) } });
    sendStateSnapshot(session(), revisit, board);
    expect(sent(revisit)[0]).not.toHaveProperty("completedBoard");
  });

  it("does not repeat notifications and attention records already sent by this subscribe", () => {
    const ws = socket();
    sendFeedAttentionSnapshot(session(), ws);
    sendStateSnapshot(session(), ws, deps());
    const [feed, state] = sent(ws);
    expect(feed.notifications).toHaveLength(1);
    expect(feed.attentionRecords).toEqual([{ id: "a-1" }]);
    expect(state).not.toHaveProperty("notifications");
    expect(state).not.toHaveProperty("attentionRecords");
    // The notification counts still come with the state snapshot.
    expect(state).toHaveProperty("activeNeedsInputNotificationCount");

    // The next subscribe on the same socket starts over.
    sendStateSnapshot(session(), ws, deps());
    expect(sent(ws)[2].attentionRecords).toEqual([{ id: "a-1" }]);
  });

  // The tree groups map every session ever created to its group. A browser
  // holding a copy the server remembers gets only the changed assignments; one
  // holding an unknown copy gets the whole map.
  it("skips the tree groups when the held copy hashes the same, and sends only changes to a recent copy", async () => {
    const held = socket({
      initialTreeGroupState: Promise.resolve(TREE),
      knownSnapshotParts: { tree_groups: snapshotPartHash(TREE) },
    });
    await sendInitialTreeGroupState(held);
    expect(held.send).not.toHaveBeenCalled();

    const next = { ...TREE, assignments: { s1: "g1", s2: "g1" } };
    const changed = socket({
      initialTreeGroupState: Promise.resolve(next),
      knownSnapshotParts: { tree_groups: snapshotPartHash(TREE) },
    });
    await sendInitialTreeGroupState(changed);
    expect(sent(changed)[0]).toEqual({
      type: "tree_groups_update",
      treeGroups: TREE.groups,
      treeAssignmentsDelta: {
        base: snapshotPartHash(TREE),
        hash: snapshotPartHash(next),
        upserts: [["s2", "g1"]],
        removed: [],
      },
      treeNodeOrder: {},
      treeGroupsHash: snapshotPartHash(next),
    });

    const unknown = socket({
      initialTreeGroupState: Promise.resolve(next),
      knownSnapshotParts: { tree_groups: "other" },
    });
    await sendInitialTreeGroupState(unknown);
    expect(sent(unknown)[0]).toMatchObject({ treeAssignments: { s1: "g1", s2: "g1" } });
  });

  // A phone returning to a busy leader used to download every notification and
  // attention record again, although nearly all were resolved and unchanged.
  it("leaves out notification and attention lists the browser holds, and sends changes to a recent copy", () => {
    const leader = session();
    (leader as any).notifications.unshift({
      id: "n-0",
      category: "needs-input",
      summary: "Old",
      timestamp: 0,
      done: true,
    });
    const first = socket();
    sendFeedAttentionSnapshot(leader, first);
    const received = sent(first)[0];
    expect(received.notifications).toHaveLength(2);
    const known = {
      notifications: snapshotPartHash(received.notifications),
      attention_records: snapshotPartHash(received.attentionRecords),
    };

    const revisit = socket({ knownSnapshotParts: known });
    sendFeedAttentionSnapshot(leader, revisit);
    const unchanged = sent(revisit)[0];
    expect(unchanged).not.toHaveProperty("notifications");
    expect(unchanged).not.toHaveProperty("attentionRecords");
    expect(unchanged).toMatchObject({
      notificationsHash: known.notifications,
      attentionRecordsHash: known.attention_records,
      activeNeedsInputNotificationCount: 1,
    });

    // The prompt was answered while the browser was away: only that entry travels.
    (leader as any).notifications[1].done = true;
    const back = socket({ knownSnapshotParts: known });
    sendFeedAttentionSnapshot(leader, back);
    const changed = sent(back)[0];
    expect(changed).not.toHaveProperty("notifications");
    expect(changed.notificationsDelta).toMatchObject({
      base: known.notifications,
      upserts: [{ id: "n-1", done: true }],
      removed: [],
    });
    expect(changed).not.toHaveProperty("attentionRecordsDelta");
  });

  it("answers a list resync with changes from the copy the browser holds", async () => {
    const leader = session();
    const first = socket();
    sendFeedAttentionSnapshot(leader, first);
    const held = snapshotPartHash(sent(first)[0].attentionRecords);
    (leader as any).attentionRecords = [{ id: "a-1" }, { id: "a-2" }];

    const ws = socket();
    await answerListResync(leader, ws, "attention_records", held, deps());
    expect(sent(ws)[0]).toEqual({
      type: "attention_records_update",
      attentionRecordsHash: snapshotPartHash([{ id: "a-1" }, { id: "a-2" }]),
      attentionRecordsDelta: {
        base: held,
        hash: snapshotPartHash([{ id: "a-1" }, { id: "a-2" }]),
        upserts: [{ id: "a-2" }],
        removed: [],
      },
    });

    await answerListResync(leader, ws, "notifications", "unknown", deps());
    expect(sent(ws)[1]).toMatchObject({ type: "notification_update", notifications: [{ id: "n-1" }] });
  });
});

describe("snapshotPartHash", () => {
  it("matches a copy parsed from the same JSON and differs for any change", () => {
    const copy = JSON.parse(JSON.stringify(COMPLETED));
    expect(snapshotPartHash(copy)).toBe(snapshotPartHash(COMPLETED));
    expect(snapshotPartHash([{ ...COMPLETED[0], status: "LANDING" }])).not.toBe(snapshotPartHash(COMPLETED));
  });
});
