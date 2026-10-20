// @vitest-environment jsdom

import type { BoardRow, BrowserIncomingMessage } from "./types.js";
import type { LeaderProjectionSnapshot, LeaderProjectionThreadSummary } from "../server/leader-projection-types.js";
import { boardListFields } from "../server/bridge/browser-board-rows.js";
import { leaderProjectionMessage } from "../server/bridge/leader-projection-lists.js";
import { sendThreadWindowSync } from "../server/bridge/browser-transport-controller.js";

// A phone returning to Takode reconnects and names what it already holds: the
// thread window, the completed board and row statuses, the leader projection's
// lists. The server sends only what changed. These tests feed the browser
// messages built by the server's own producers and check that it ends with the
// same data a whole download gives, and that it asks again whenever it cannot
// build a part from its copy.

vi.mock("./api.js", () => ({
  api: {
    getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
    listSessions: vi.fn().mockResolvedValue([]),
  },
}));

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;
let windowCache: typeof import("./utils/history-window-cache.js");
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
  windowCache = await import("./utils/history-window-cache.js");
  wsModule = await import("./ws.js");
  wsModule.connectSession("s1");
  lastWs.onmessage!({ data: JSON.stringify({ type: "session_init", session: { session_id: "s1" } }) });
});

function fire(message: object) {
  lastWs.onmessage!({ data: JSON.stringify(message) });
}

function sent(type: string): Array<Record<string, unknown>> {
  return lastWs.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).filter((msg) => msg.type === type);
}

/** What the server's real window producer sends one socket. */
function threadWindow(
  session: { id: string; messageHistory: BrowserIncomingMessage[] },
  cachedWindowHash?: string,
): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const socket = { data: {}, send: vi.fn() };
  sendThreadWindowSync(session, socket, {
    threadKey: "q-1",
    fromItem: -1,
    itemCount: 30,
    sectionItemCount: 10,
    visibleItemCount: 3,
    cachedWindowHash,
  });
  return JSON.parse(String(socket.send.mock.calls[0]![0]));
}

function threadMessage(index: number, text = `message ${index}`): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: `u-${index}`,
    content: text,
    timestamp: index + 1,
    threadKey: "q-1",
    questId: "q-1",
    threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "explicit" }],
  } as BrowserIncomingMessage;
}

function shownThreadMessageIds(): string[] {
  return (useStore.getState().threadWindowMessages.get("s1")?.get("q-1") ?? []).map((message) => message.id);
}

describe("thread windows sent as changes", () => {
  it("builds the window from the held copy, exactly as the whole window, and keeps building on it", () => {
    const session = { id: "s1", messageHistory: [0, 1, 2].map((index) => threadMessage(index)) };
    const first = threadWindow(session);
    fire(first);

    // While the phone was away: one message edited in place, two new ones.
    session.messageHistory[1] = threadMessage(1, "edited");
    session.messageHistory.push(threadMessage(3), threadMessage(4));
    const second = threadWindow(session, first.window.window_hash);
    expect(second.entries_delta).toMatchObject({ base: first.window.window_hash, removed: [] });
    expect(second.entries.map((entry) => entry.history_index)).toEqual([1, 3, 4]);
    fire(second);

    // A copy of the session the server never sent anything for gets the whole window.
    const whole = threadWindow({ ...session });
    expect(whole.entries_delta).toBeUndefined();
    expect(whole.window.window_hash).toBe(second.window.window_hash);
    expect(windowCache.findCachedThreadWindowEntries("s1", "q-1", second.window.window_hash!)).toEqual(whole.entries);
    expect(shownThreadMessageIds()).toEqual(["u-0", "u-1", "u-2", "u-3", "u-4"]);

    // The built window is cached, so the next change builds on it.
    session.messageHistory.push(threadMessage(5));
    const third = threadWindow(session, second.window.window_hash);
    expect(third.entries.map((entry) => entry.history_index)).toEqual([5]);
    fire(third);
    expect(shownThreadMessageIds()).toEqual(["u-0", "u-1", "u-2", "u-3", "u-4", "u-5"]);
    expect(sent("thread_window_request")).toEqual([]);
  });

  // A cache hit leaves out the answer state its hash covers; the browser takes
  // it from the cached window instead of dropping it.
  it("restores the cached answer state on a cache hit", () => {
    const session = { id: "s1", messageHistory: [threadMessage(0)] };
    const first = threadWindow(session);
    expect(first.response_state).toBeDefined();
    fire(first);
    const held = useStore.getState().threadWindowResponseStates.get("s1")?.get("q-1");
    expect(held).toBeTruthy();

    const hit = threadWindow(session, first.window.window_hash);
    expect(hit).toMatchObject({ cache_hit: true, entries: [] });
    expect(hit).not.toHaveProperty("response_state");
    fire(hit);

    expect(useStore.getState().threadWindowResponseStates.get("s1")?.get("q-1")).toEqual(held);
    expect(shownThreadMessageIds()).toEqual(["u-0"]);
  });

  it("asks for the whole window when it no longer holds the window the changes build on", () => {
    const session = { id: "s1", messageHistory: [0, 1].map((index) => threadMessage(index)) };
    const unseen = threadWindow(session);
    session.messageHistory.push(threadMessage(2));
    // This browser never received the first window.
    fire(threadWindow(session, unseen.window.window_hash));

    expect(shownThreadMessageIds()).toEqual([]);
    const [request] = sent("thread_window_request");
    expect(request).toMatchObject({ thread_key: "q-1", activate_view: true });
    expect(request).not.toHaveProperty("cached_window_hash");
  });
});

function boardRow(questId: string, title = questId): BoardRow {
  return { questId, title, createdAt: 1, updatedAt: 1 } as BoardRow;
}

describe("completed board and row statuses sent as changes", () => {
  it("rebuilds both lists from the held copies on a reconnect and keeps them when unchanged", () => {
    const session = {};
    const rows = [boardRow("q-2"), boardRow("q-1")];
    const statuses = { "q-2": { worker: { status: "idle" } } } as never;
    const first = boardListFields(session, rows, statuses, undefined);
    fire({ type: "state_snapshot", sessionStatus: "idle", ...first });

    const later = [boardRow("q-3"), boardRow("q-2", "renamed"), boardRow("q-1")];
    const laterStatuses = { "q-2": { worker: { status: "idle" } }, "q-3": { worker: { status: "running" } } } as never;
    const held = { completed_board: first.completedBoardHash, row_session_statuses: first.rowSessionStatusesHash };
    const reconnect = boardListFields(session, later, laterStatuses, held);
    expect(reconnect).not.toHaveProperty("completedBoard");
    expect(reconnect).not.toHaveProperty("rowSessionStatuses");
    fire({ type: "state_snapshot", sessionStatus: "idle", ...reconnect });

    expect(useStore.getState().sessionCompletedBoards.get("s1")).toEqual(later);
    expect(useStore.getState().sessionBoardRowStatuses.get("s1")).toEqual(laterStatuses);

    // Unchanged: named by hash only, and the store keeps the very same values.
    const completed = useStore.getState().sessionCompletedBoards.get("s1");
    const unchanged = boardListFields(session, later, laterStatuses, {
      completed_board: reconnect.completedBoardHash,
      row_session_statuses: reconnect.rowSessionStatusesHash,
    });
    expect(unchanged).toEqual({
      completedBoardHash: reconnect.completedBoardHash,
      rowSessionStatusesHash: reconnect.rowSessionStatusesHash,
    });
    fire({ type: "state_snapshot", sessionStatus: "idle", ...unchanged });
    expect(useStore.getState().sessionCompletedBoards.get("s1")).toBe(completed);
    expect(sent("list_resync")).toEqual([]);
  });

  it("asks for a board list again when the changes build on a copy it does not hold", () => {
    const session = {};
    const unseen = boardListFields(session, [boardRow("q-1")], {}, undefined);
    const update = boardListFields(
      session,
      [boardRow("q-2"), boardRow("q-1")],
      {},
      {
        completed_board: unseen.completedBoardHash,
      },
    );
    fire({
      type: "board_updated",
      board: [],
      completedBoardDelta: update.completedBoardDelta,
      completedBoardHash: update.completedBoardHash,
    });

    expect(useStore.getState().sessionCompletedBoards.get("s1")).toBeUndefined();
    expect(sent("list_resync")).toEqual([{ type: "list_resync", list: "completed_board", held: "" }]);
  });
});

function summary(threadKey: string, messageCount: number): LeaderProjectionThreadSummary {
  return { threadKey, questId: threadKey, messageCount, firstMessageAt: 1, lastMessageAt: messageCount };
}

function projection(threadSummaries: LeaderProjectionThreadSummary[]): LeaderProjectionSnapshot {
  return { schemaVersion: 2, sourceHistoryLength: 10, threadSummaries, messageAttentionRecords: [] };
}

describe("leader projection lists sent as changes", () => {
  it("rebuilds the projection from the held lists", () => {
    const session = {};
    const first = leaderProjectionMessage(session, projection([summary("q-1", 1), summary("q-2", 4)]), undefined);
    fire(first);

    const current = projection([summary("q-1", 1), summary("q-2", 6), summary("q-3", 1)]);
    const reconnect = leaderProjectionMessage(session, current, {
      thread_summaries: first.threadSummariesHash,
      message_attention_records: first.messageAttentionRecordsHash,
    });
    expect(reconnect.projection).not.toHaveProperty("threadSummaries");
    expect(reconnect.projection).not.toHaveProperty("messageAttentionRecords");
    expect(reconnect.threadSummariesDelta?.upserts).toEqual([summary("q-2", 6), summary("q-3", 1)]);
    fire(reconnect);

    expect(useStore.getState().leaderProjections.get("s1")).toEqual(current);
    expect(sent("list_resync")).toEqual([]);
  });

  it("keeps the held projection and asks for it again when a list cannot be built", () => {
    const session = {};
    const held = projection([summary("q-1", 1)]);
    fire(leaderProjectionMessage({}, held, undefined));
    // This browser never received the projection the changes build on.
    const unseen = leaderProjectionMessage(session, projection([summary("q-8", 1), summary("q-9", 1)]), undefined);
    const changes = leaderProjectionMessage(session, projection([summary("q-8", 1), summary("q-9", 2)]), {
      thread_summaries: unseen.threadSummariesHash,
      message_attention_records: unseen.messageAttentionRecordsHash,
    });
    expect(changes.threadSummariesDelta).toBeDefined();
    fire(changes);

    expect(useStore.getState().leaderProjections.get("s1")).toEqual(held);
    expect(sent("list_resync")).toEqual([{ type: "list_resync", list: "leader_projection", held: "" }]);
  });
});
