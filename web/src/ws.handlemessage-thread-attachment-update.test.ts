// @vitest-environment jsdom

import { FEED_WINDOW_SYNC_VERSION } from "../shared/feed-window-sync.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT, HISTORY_WINDOW_VISIBLE_SECTION_COUNT } from "../shared/history-window.js";
import type { BrowserIncomingMessage, SessionState } from "./types.js";

vi.mock("./utils/names.js", () => ({
  generateUniqueSessionName: vi.fn(() => "Test Session"),
}));

const getDiffStatsMock = vi.fn().mockResolvedValue({ stats: {} });
const listSessionsMock = vi.fn().mockResolvedValue([]);
const playNotificationSoundMock = vi.hoisted(() => vi.fn());

vi.mock("./api.js", () => ({
  api: {
    getDiffStats: getDiffStatsMock,
    listSessions: listSessionsMock,
  },
}));

vi.mock("./utils/notification-sound.js", () => ({
  playNotificationSound: playNotificationSoundMock,
}));

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;

let lastWs: InstanceType<typeof MockWebSocket>;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
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
  url: string;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    lastWs = this;
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  getDiffStatsMock.mockReset();
  getDiffStatsMock.mockResolvedValue({ stats: {} });
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue([]);
  playNotificationSoundMock.mockReset();
  MockWebSocket.instances = [];

  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  localStorage.clear();

  wsModule = await import("./ws.js");
});

afterEach(() => {
  vi.useRealTimers();
});

function makeSession(id: string): SessionState {
  return {
    session_id: id,
    model: "claude-opus-4-20250514",
    cwd: "/home/user",
    tools: ["Bash", "Read"],
    permissionMode: "default",
    claude_code_version: "2.1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/home/user",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function fireMessage(data: Record<string, unknown>) {
  lastWs.onmessage!({ data: JSON.stringify(data) });
}

function connectAndHydrateSession() {
  wsModule.connectSession("s1");
  fireMessage({ type: "session_init", session: makeSession("s1") });
  lastWs.send.mockClear();
}

function threadAttachmentUpdate(
  overrides: Partial<Extract<BrowserIncomingMessage, { type: "thread_attachment_update" }>> = {},
) {
  return {
    type: "thread_attachment_update",
    version: 1,
    updateId: "attach-update-1",
    timestamp: 3000,
    attachedAt: 3000,
    attachedBy: "leader-1",
    historyLength: 43,
    affectedThreadKeys: ["main", "q-1087"],
    maxDistanceFromTail: 300,
    maxChangedMessages: 100,
    updates: [
      {
        target: { threadKey: "q-1087", questId: "q-1087" },
        markers: [
          {
            type: "thread_attachment_marker",
            id: "marker-1",
            timestamp: 3000,
            markerKey: "q-1087:u2",
            threadKey: "q-1087",
            questId: "q-1087",
            attachedAt: 3000,
            attachedBy: "leader-1",
            messageIds: ["u2"],
            messageIndices: [1],
            ranges: ["1"],
            count: 1,
            firstMessageId: "u2",
            firstMessageIndex: 1,
          },
        ],
        markerHistoryIndices: [42],
        changedMessages: [
          {
            historyIndex: 1,
            messageId: "u2",
            threadRefs: [{ threadKey: "q-1087", questId: "q-1087", source: "backfill" }],
          },
        ],
        ranges: ["1"],
        count: 1,
      },
    ],
    ...overrides,
  };
}

describe("handleMessage: thread_attachment_update", () => {
  it("patches visible threadRefs, appends movement markers, invalidates windows, and requests bounded refreshes", async () => {
    connectAndHydrateSession();
    useStore.getState().setMessages(
      "s1",
      [
        { id: "u1", role: "user", content: "main message", timestamp: 1000, historyIndex: 0 },
        { id: "u2", role: "user", content: "move me", timestamp: 1001, historyIndex: 1 },
      ],
      { frozenCount: 2 },
    );
    useStore.getState().setHistoryWindow("s1", {
      from_turn: 10,
      turn_count: 5,
      total_turns: 20,
      start_index: 0,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });
    useStore.getState().setThreadWindow(
      "s1",
      "q-1087",
      {
        thread_key: "q-1087",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        source_history_length: 42,
        section_item_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_item_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
      [],
    );

    fireMessage(threadAttachmentUpdate());

    const messages = useStore.getState().messages.get("s1")!;
    expect(messages.find((message) => message.id === "u2")?.metadata?.threadRefs).toEqual([
      { threadKey: "q-1087", questId: "q-1087", source: "backfill" },
    ]);
    expect(messages.find((message) => message.id === "marker-1")).toMatchObject({
      historyIndex: 42,
      metadata: { threadAttachmentMarker: expect.objectContaining({ threadKey: "q-1087" }) },
    });
    expect(useStore.getState().historyWindows.has("s1")).toBe(false);
    expect(useStore.getState().threadWindows.get("s1")?.has("q-1087")).toBeFalsy();

    expect(lastWs.send).toHaveBeenCalledTimes(2);
    expect(JSON.parse(lastWs.send.mock.calls[0]![0])).toEqual({
      type: "history_window_request",
      from_turn: -1,
      turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
    });
    expect(JSON.parse(lastWs.send.mock.calls[1]![0])).toEqual({
      type: "thread_window_request",
      thread_key: "q-1087",
      from_item: -1,
      item_count: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      section_item_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_item_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      feed_window_sync_version: FEED_WINDOW_SYNC_VERSION,
    });

    const { getFrontendPerfEntries } = await import("./utils/frontend-perf-recorder.js");
    expect(getFrontendPerfEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "thread_attachment_update_apply",
          sessionId: "s1",
          updateCount: 1,
          markerCount: 1,
          changedMessageCount: 1,
          requestedHistoryWindowCount: 1,
          requestedThreadWindowCount: 1,
          ok: true,
        }),
      ]),
    );
  });

  it("deduplicates repeated updates by updateId", () => {
    connectAndHydrateSession();
    useStore
      .getState()
      .setMessages("s1", [{ id: "u2", role: "user", content: "move me", timestamp: 1001, historyIndex: 1 }], {
        frozenCount: 1,
      });

    const update = threadAttachmentUpdate();
    fireMessage(update);
    fireMessage(update);

    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.filter((message) => message.id === "marker-1"),
    ).toHaveLength(1);
    expect(lastWs.send).toHaveBeenCalledTimes(2);
  });

  it("falls back to bounded refresh requests for unsupported update versions without local patching", async () => {
    connectAndHydrateSession();
    useStore
      .getState()
      .setMessages("s1", [{ id: "u2", role: "user", content: "move me", timestamp: 1001, historyIndex: 1 }], {
        frozenCount: 1,
      });

    fireMessage(threadAttachmentUpdate({ version: 999 as 1, updateId: "unsupported-update" }));

    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.some((message) => message.id === "marker-1"),
    ).toBe(false);
    expect(lastWs.send).toHaveBeenCalledTimes(2);
    const { getFrontendPerfEntries } = await import("./utils/frontend-perf-recorder.js");
    expect(getFrontendPerfEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "thread_attachment_update_apply",
          sessionId: "s1",
          ok: false,
          recoveryReason: "unsupported_version",
        }),
      ]),
    );
  });
});
