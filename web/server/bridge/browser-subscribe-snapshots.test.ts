import { describe, expect, it, vi } from "vitest";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";
import type { BrowserTransportSessionLike } from "./browser-transport-controller.js";
import {
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

  it("skips the tree groups when the held copy hashes the same, and sends changed ones", async () => {
    const held = socket({
      initialTreeGroupState: Promise.resolve(TREE),
      knownSnapshotParts: { tree_groups: snapshotPartHash(TREE) },
    });
    await sendInitialTreeGroupState(held);
    expect(held.send).not.toHaveBeenCalled();

    const changed = socket({
      initialTreeGroupState: Promise.resolve({ ...TREE, assignments: { s1: "g1", s2: "g1" } }),
      knownSnapshotParts: { tree_groups: snapshotPartHash(TREE) },
    });
    await sendInitialTreeGroupState(changed);
    expect(sent(changed)[0]).toMatchObject({ type: "tree_groups_update", treeAssignments: { s1: "g1", s2: "g1" } });
  });
});

describe("snapshotPartHash", () => {
  it("matches a copy parsed from the same JSON and differs for any change", () => {
    const copy = JSON.parse(JSON.stringify(COMPLETED));
    expect(snapshotPartHash(copy)).toBe(snapshotPartHash(COMPLETED));
    expect(snapshotPartHash([{ ...COMPLETED[0], status: "LANDING" }])).not.toBe(snapshotPartHash(COMPLETED));
  });
});
