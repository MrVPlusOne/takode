import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TopicStore, TopicStoreError } from "./topic-store.js";
import { joinThread, unjoinThread } from "./thread-join.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/**
 * A leader's Scribe joins a new thread onto the earlier conversation it continues (another thread,
 * or a quest's thread): the thread's messages gain a ref to the earlier conversation naming where
 * they were written, what waits on the user moves with them, browsers hear of the change, and the
 * user's Undo takes it all back. Runs on a disposable store and an in-memory leader session.
 */

let root: string;
let store: TopicStore;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  root = await mkdtemp(join(tmpdir(), "thread-join-"));
  store = new TopicStore(root);
  await store.load();
});

afterEach(async () => {
  vi.useRealTimers();
  await store.flush();
  await rm(root, { recursive: true, force: true });
});

function fixture() {
  const earlier = store.startThread({ space: "MSI", name: "Collapsed composer sits low", leaderId: "leader" });
  const later = store.startThread({ space: "MSI", name: "Composer a bit high", leaderId: "leader" });
  const message = (id: string, threadKey: string) =>
    ({ type: "user_message", id, content: id, timestamp: 1, threadKey }) as unknown as BrowserIncomingMessage;
  const session = {
    messageHistory: [message("u-1", earlier.key), message("u-2", later.key), message("u-3", "main")],
    notifications: [
      { id: "n-1", category: "review", summary: "Answer", timestamp: 1, threadKey: later.key, done: false },
      { id: "n-2", category: "review", summary: "Other", timestamp: 1, threadKey: "main", done: false },
    ],
    board: new Map([["q-7", { questId: "q-7" }]]),
    pendingPermissions: new Map(),
  };
  const bridge = {
    getSession: (id: string) => (id === "leader" ? session : undefined),
    persistSessionById: vi.fn(),
    broadcastToSession: vi.fn(),
  };
  return { earlier, later, session, bridge: bridge as never as Parameters<typeof joinThread>[0], sent: bridge };
}

describe("joining a thread", () => {
  it("brings the thread's messages to the earlier thread, with what waits on the user, and tells browsers", () => {
    const { earlier, later, session, bridge, sent } = fixture();
    const joined = joinThread(bridge, store, {
      leaderId: "leader",
      threadKey: later.key,
      intoKey: earlier.key,
      by: "scribe",
    });
    expect(joined).toMatchObject({ thread: later.key, into: earlier.key, messages: 1 });
    // Its message reads in the earlier conversation, and says where it was written (the marker).
    expect((session.messageHistory[1] as { threadRefs?: unknown[] }).threadRefs).toEqual([
      expect.objectContaining({
        threadKey: earlier.key,
        joinedFrom: later.key,
        source: "backfill",
        attachedBy: "scribe",
      }),
    ]);
    expect(session.messageHistory.at(-1)).toMatchObject({
      type: "thread_attachment_marker",
      sourceThreadKey: later.key,
    });
    // The unread answer moves with it; Main's stays.
    expect(session.notifications.map((notification) => notification.threadKey)).toEqual([earlier.key, "main"]);
    // The thread leaves the lists (its address opens the earlier conversation).
    expect(store.threadsOf("leader").find((thread) => thread.key === later.key)?.joinedInto).toBe(earlier.key);
    vi.runAllTimers();
    expect(sent.broadcastToSession).toHaveBeenCalledWith(
      "leader",
      expect.objectContaining({ type: "thread_attachment_update" }),
    );
  });

  it("joins onto a quest on the leader's board, and refuses what isn't the leader's", () => {
    const { later, bridge } = fixture();
    const refuse = (input: Partial<Parameters<typeof joinThread>[2]>) => () =>
      joinThread(bridge, store, { leaderId: "leader", threadKey: later.key, intoKey: "q-7", by: "scribe", ...input });
    expect(refuse({ intoKey: "q-99" })).toThrow(/not on your leader's board/);
    expect(refuse({ leaderId: "other" })).toThrow(TopicStoreError);
    expect(refuse({ intoKey: "main" })).toThrow(/quest's thread/);
    expect(refuse({})()).toMatchObject({ into: "q-7" });
    // Joined once: it can't be joined again until undone.
    expect(refuse({})).toThrow(/already part of q-7/);
  });

  it("undoes a join: the thread is its own again, its messages leave the earlier conversation", () => {
    const { earlier, later, session, bridge } = fixture();
    joinThread(bridge, store, { leaderId: "leader", threadKey: later.key, intoKey: earlier.key, by: "scribe" });
    const undone = unjoinThread(bridge, store, { leaderId: "leader", threadKey: later.key });
    expect(undone.from).toBe(earlier.key);
    expect(undone.thread.joinedInto).toBeUndefined();
    expect((session.messageHistory[1] as { threadRefs?: unknown[] }).threadRefs).toEqual([]);
    // Only a join can be undone this way.
    expect(() => unjoinThread(bridge, store, { leaderId: "leader", threadKey: later.key })).toThrow(/was not joined/);
  });
});
