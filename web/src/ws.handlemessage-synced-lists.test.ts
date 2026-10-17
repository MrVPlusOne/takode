// @vitest-environment jsdom

import type { SessionAttentionRecord, SessionNotification } from "./types.js";
import { snapshotPartHash } from "../shared/snapshot-part-hash.js";
import { projectFeedAttentionUpdateForBrowsers } from "../server/bridge/feed-attention-lists.js";
import { createTreeGroupUpdates } from "../server/bridge/tree-group-updates.js";

// The notification list, attention records and tree groups reach the browser
// whole, as changes from the copy it holds, or not at all when it holds the
// current copy. These tests feed the browser messages built by the server's
// own producers and check that it ends with the server's exact lists, and
// that it asks for a list again when an update does not fit its copy.

vi.mock("./api.js", () => ({
  api: {
    getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
    listSessions: vi.fn().mockResolvedValue([]),
  },
}));

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;
let lastWs: MockWebSocket;

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  OPEN = 1;
  CLOSED = 3;
  CONNECTING = 0;
  CLOSING = 2;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWs = this;
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

beforeEach(async () => {
  vi.resetModules();
  useStore = (await import("./store.js")).useStore;
  useStore.getState().reset();
  localStorage.clear();
  wsModule = await import("./ws.js");
  wsModule.connectSession("s1");
  lastWs.onmessage!({ data: JSON.stringify({ type: "session_init", session: { session_id: "s1" } }) });
});

function fire(message: object) {
  lastWs.onmessage!({ data: JSON.stringify(message) });
}

function resyncRequests(): unknown[] {
  return lastWs.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).filter((msg) => msg.type === "list_resync");
}

function notification(id: string, done = false): SessionNotification {
  return { id, category: "needs-input", summary: `Question ${id}`, timestamp: 1, messageId: null, done };
}

function record(id: string): SessionAttentionRecord {
  return { id, title: `Record ${id}` } as SessionAttentionRecord;
}

describe("notification and attention lists", () => {
  it("applies notification changes to the held list and its counts", () => {
    const session = {};
    const status = { notificationStatusVersion: 1, activeNotificationCount: 2, activeNeedsInputNotificationCount: 2 };
    const list = [notification("n-1"), notification("n-2")];
    fire(
      projectFeedAttentionUpdateForBrowsers(session, { type: "notification_update", notifications: list, ...status }),
    );

    const next = [notification("n-1", true), notification("n-2"), notification("n-3")];
    const update = projectFeedAttentionUpdateForBrowsers(session, {
      type: "notification_update",
      notifications: next,
      ...status,
      notificationStatusVersion: 2,
    });
    expect(update).not.toHaveProperty("notifications");
    fire(update);

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual(next);
    expect(resyncRequests()).toEqual([]);
  });

  it("asks for the notification list again when a change builds on a list it did not receive", () => {
    const session = {};
    // This browser never received the first list, so the change cannot apply.
    projectFeedAttentionUpdateForBrowsers(session, {
      type: "notification_update",
      notifications: [notification("n-1")],
    });
    useStore.getState().setSessionNotifications("s1", [notification("n-9")]);
    fire(
      projectFeedAttentionUpdateForBrowsers(session, {
        type: "notification_update",
        notifications: [notification("n-1"), notification("n-2")],
      }),
    );

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual([notification("n-9")]);
    expect(resyncRequests()).toEqual([{ type: "list_resync", list: "notifications", held: "" }]);
  });

  // Answering a session's last open prompt clears its status in the global
  // activity update, which arrives first and drops the store's copy as stale.
  // The inbox change that follows must still apply at once, restoring every
  // resolved chip, as the whole list did, without a round trip to the server.
  it("restores the list from the copy the server sent after the store's copy was cleared", () => {
    const session = {};
    fire(
      projectFeedAttentionUpdateForBrowsers(session, {
        type: "notification_update",
        notifications: [notification("n-1", true), notification("n-2")],
        activeNotificationCount: 1,
        activeNeedsInputNotificationCount: 1,
        notificationStatusVersion: 1,
      }),
    );
    fire({
      type: "session_activity_update",
      session_id: "s1",
      session: { activeNotificationCount: 0, mutedNeedsInputNotificationCount: 0, notificationStatusVersion: 2 },
    });
    expect(useStore.getState().sessionNotifications.get("s1")).toBeUndefined();

    const answered = [notification("n-1", true), notification("n-2", true)];
    const update = projectFeedAttentionUpdateForBrowsers(session, {
      type: "notification_update",
      notifications: answered,
      activeNotificationCount: 0,
      activeNeedsInputNotificationCount: 0,
      notificationStatusVersion: 2,
    });
    expect(update).toHaveProperty("notificationsDelta");
    fire(update);

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual(answered);
    expect(resyncRequests()).toEqual([]);
  });

  it("restores held lists a feed attention snapshot leaves out, and applies its counts", () => {
    useStore
      .getState()
      .setSdkSessions([{ sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1, archived: false }]);
    const held = [notification("n-1")];
    fire({
      type: "feed_attention_snapshot",
      notifications: held,
      notificationsHash: snapshotPartHash(held),
      attentionRecords: [record("a-1")],
      attentionRecordsHash: snapshotPartHash([record("a-1")]),
      notificationStatusVersion: 2,
    });
    // A REST read replaced the store's copy meanwhile; the snapshot restores the server's list.
    useStore.getState().setSessionNotifications("s1", [notification("n-9")]);
    fire({
      type: "feed_attention_snapshot",
      notificationsHash: snapshotPartHash(held),
      attentionRecordsHash: snapshotPartHash([record("a-1")]),
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 1,
      notificationUrgency: "needs-input",
      notificationStatusVersion: 3,
    });

    expect(useStore.getState().sessionNotifications.get("s1")).toEqual(held);
    expect(useStore.getState().sessionAttentionRecords.get("s1")).toEqual([record("a-1")]);
    expect(useStore.getState().sdkSessions[0]).toMatchObject({
      notificationStatusVersion: 3,
      activeNotificationCount: 1,
    });
    expect(resyncRequests()).toEqual([]);
  });

  it("applies attention record changes and asks again when they build on records it did not receive", () => {
    const session = {};
    fire(
      projectFeedAttentionUpdateForBrowsers(session, {
        type: "attention_records_update",
        attentionRecords: [record("a-1")],
      }),
    );
    const update = projectFeedAttentionUpdateForBrowsers(session, {
      type: "attention_records_update",
      attentionRecords: [record("a-1"), record("a-2")],
    });
    fire(update);
    expect(useStore.getState().sessionAttentionRecords.get("s1")).toEqual([record("a-1"), record("a-2")]);

    const other = {};
    projectFeedAttentionUpdateForBrowsers(other, {
      type: "attention_records_update",
      attentionRecords: [record("b-1")],
    });
    fire(
      projectFeedAttentionUpdateForBrowsers(other, {
        type: "attention_records_update",
        attentionRecords: [record("b-1"), record("b-2")],
      }),
    );
    expect(resyncRequests()).toEqual([
      { type: "list_resync", list: "attention_records", held: snapshotPartHash([record("a-1"), record("a-2")]) },
    ]);
  });
});

describe("tree groups", () => {
  const groups = [{ id: "default", name: "Default" }];

  it("applies changed assignments, ignores an update it already holds, and asks again otherwise", () => {
    const updates = createTreeGroupUpdates(4);
    fire(updates.forBroadcast({ groups, assignments: { s1: "default", s2: "default" } }));
    const moved = updates.forBroadcast({ groups, assignments: { s1: "default", s2: "default", s3: "default" } });
    expect(moved).not.toHaveProperty("treeAssignments");
    fire(moved);
    const assignments = () => Object.fromEntries(useStore.getState().treeAssignments);
    expect(assignments()).toEqual({ s1: "default", s2: "default", s3: "default" });

    // A second socket of this tab delivers the same update: nothing changes.
    const before = useStore.getState().treeAssignments;
    fire(moved);
    expect(useStore.getState().treeAssignments).toBe(before);
    expect(resyncRequests()).toEqual([]);

    useStore.getState().setTreeGroups(groups, { s9: "default" }, {});
    fire(updates.forBroadcast({ groups, assignments: { s1: "default" } }));
    expect(assignments()).toEqual({ s9: "default" });
    expect(resyncRequests()).toEqual([
      {
        type: "list_resync",
        list: "tree_groups",
        held: snapshotPartHash({ groups, assignments: { s9: "default" }, nodeOrder: {} }),
      },
    ]);
  });
});
