// @vitest-environment jsdom

import type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage } from "./types.js";
import { computeHistoryMessagesSyncHash } from "../shared/history-sync-hash.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT, HISTORY_WINDOW_VISIBLE_SECTION_COUNT } from "../shared/history-window.js";

// Mock the names utility before any imports
vi.mock("./utils/names.js", () => ({
  generateUniqueSessionName: vi.fn(() => "Test Session"),
}));

const getDiffStatsMock = vi.fn().mockResolvedValue({ stats: {} });
const listSessionsMock = vi.fn().mockResolvedValue([]);
const playNotificationSoundMock = vi.hoisted(() => vi.fn());

// Mock the API module so PostHog doesn't break in jsdom
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

// ---------------------------------------------------------------------------
// MockWebSocket
// ---------------------------------------------------------------------------
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
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    lastWs = this;
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

// ---------------------------------------------------------------------------
// Fresh module state for each test
// ---------------------------------------------------------------------------
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  getDiffStatsMock.mockReset();
  getDiffStatsMock.mockResolvedValue({ stats: {} });
  listSessionsMock.mockReset();
  listSessionsMock.mockResolvedValue([]);
  playNotificationSoundMock.mockReset();
  MockWebSocket.instances = [];
  window.location.hash = "";

  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  localStorage.clear();

  wsModule = await import("./ws.js");
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ===========================================================================
// Connection
// ===========================================================================
describe("connectSession", () => {
  it("creates a WebSocket with the correct URL", () => {
    wsModule.connectSession("s1");

    expect(lastWs.url).toBe("ws://localhost:3456/ws/browser/s1");
    expect(useStore.getState().connectionStatus.get("s1")).toBe("connecting");
  });

  it("does not create a duplicate socket for the same session", () => {
    wsModule.connectSession("s1");
    const first = lastWs;
    wsModule.connectSession("s1");

    // lastWs should still be the first one (no new constructor call)
    expect(lastWs).toBe(first);
  });

  it("announces each WebSocket open for a backend build recheck", () => {
    const listener = vi.fn();
    window.addEventListener("takode:backend-connection-open", listener);

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("takode:backend-connection-open", listener);
  });

  it("sends session_subscribe with last_seq, known_frozen_count, and known_frozen_hash on open when store has messages", () => {
    // Simulate a WebSocket reconnect (not a page refresh): store already has
    // messages and a server-provided frozen hash
    localStorage.setItem("companion:last-seq:s1", "12");
    useStore.getState().setMessages(
      "s1",
      [
        {
          id: "msg-existing",
          role: "user",
          content: "existing message",
          timestamp: 1000,
        },
        {
          id: "msg-hot",
          role: "assistant",
          content: "hot reply",
          timestamp: 2000,
        },
      ],
      { frozenCount: 1, frozenHash: "abcd1234" },
    );
    wsModule.connectSession("s1");

    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 12,
        known_frozen_count: 1,
        known_frozen_hash: "abcd1234",
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );
  });

  // Regression test: after a full page refresh, the Zustand store is empty but
  // localStorage still holds a stale high last_seq. If we send that stale value,
  // the server thinks we're caught up and skips sending the authoritative history window, leaving
  // the UI empty. Fix: send last_seq: 0 when the store has no messages.
  it("sends last_seq: 0 on open when store has no messages (page refresh scenario)", () => {
    localStorage.setItem("companion:last-seq:s1", "50");
    // Store is empty (simulates page refresh — Zustand resets but localStorage persists)
    wsModule.connectSession("s1");

    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );
  });

  it("centers an All Threads deep link through the bounded history target", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    window.location.hash = "#/session/s1/msg/message-42?thread=all";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe).toMatchObject({
      type: "session_subscribe",
      last_seq: 0,
      history_window_target_message_id: "message-42",
    });
    expect(subscribe.initial_thread_window).toBeUndefined();
  });

  it("names the conversations a leader's side column shows in its subscribe", async () => {
    // Live messages of a side conversation reach this browser only once the server knows it shows
    // them, so a reconnect must say so again.
    const { setSideViewsOf } = await import("./utils/side-views.js");
    setSideViewsOf("s1", {}, ["topic:aaaa0001", "q-7"]);
    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe.side_views).toEqual(["q-7", "topic:aaaa0001"]);
  });

  it("sends last_seq: 0 when localStorage has no entry", () => {
    // Brand new session — no localStorage, no store messages
    wsModule.connectSession("s1");

    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );
  });

  it("includes the selected leader quest window in a cold subscribe", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any],
    });
    window.location.hash = "#/session/s1?thread=q-1825";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        initial_thread_window: {
          thread_key: "q-1825",
          from_item: -1,
          item_count: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
          section_item_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
          visible_item_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        },
      }),
    );
    expect(useStore.getState().pendingThreadWindowRequests.get("s1")).toBe("q-1825");
  });

  it("keeps All Threads on the bounded history subscribe", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any],
    });
    window.location.hash = "#/session/s1?thread=all";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );
    // The subscribe's history window is All Threads' window, so selecting All Threads
    // must not ask for it a second time while it is on its way.
    expect(useStore.getState().pendingThreadWindowRequests.get("s1")).toBe("all");

    // Its arrival ends the wait, so a later selection of All Threads asks again.
    fireMessage({
      type: "history_window_sync",
      messages: [],
      window: {
        from_turn: 0,
        turn_count: 0,
        total_turns: 0,
        has_older_items: false,
        has_newer_items: false,
        start_index: 0,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });
    expect(useStore.getState().pendingThreadWindowRequests.has("s1")).toBe(false);
  });

  it("centers the initial leader window on a stable message target", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any],
    });
    useStore.getState().setPendingScrollToMessageId("s1", "message-42");
    window.location.hash = "#/session/s1/msg/message-42?thread=q-1825";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe).toMatchObject({
      type: "session_subscribe",
      history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      initial_thread_window: {
        thread_key: "q-1825",
        from_item: -1,
        target_message_id: "message-42",
      },
    });
  });

  it("opens the thread a phone alert link names before the session is known", () => {
    // A cold load from a phone alert subscribes before the session list arrives. The
    // link names the thread, so the subscribe asks for it at once; without the hint the
    // server first sent a large history window the thread view never shows.
    window.location.hash = "#/session/s1/msg/message-42?thread=q-1825";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe.initial_thread_window).toMatchObject({
      thread_key: "q-1825",
      from_item: -1,
      target_message_id: "message-42",
    });
    expect(useStore.getState().pendingThreadWindowRequests.get("s1")).toBe("q-1825");
  });

  it("keeps a session known not to lead on the history subscribe, whatever the route says", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: false } as any] });
    window.location.hash = "#/session/s1/msg/message-42?thread=q-1825";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe.initial_thread_window).toBeUndefined();
    expect(subscribe.history_window_target_message_id).toBe("message-42");
  });

  it("shows a partial jump window but keeps waiting for the full one", () => {
    // The server answers a jump with the conversations around the target first. The
    // browser shows them, but the request stays open and only the full window is cached.
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    window.location.hash = "#/session/s1/msg/message-42?thread=q-1825";
    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const windowFor = (fromItem: number, itemCount: number, hash: string, partial?: true) => ({
      thread_key: "q-1825",
      from_item: fromItem,
      item_count: itemCount,
      total_items: 40,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 400,
      section_item_count: 10,
      visible_item_count: 3,
      window_hash: hash,
      target_message_id: "message-42",
      ...(partial ? { partial } : {}),
    });
    const entry = (id: string, index: number) => ({
      message: { type: "user_message", id, content: id, timestamp: 1_700_000_000_000 + index, threadKey: "q-1825" },
      history_index: index,
    });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1825",
      entries: [entry("message-41", 41), entry("message-42", 42)],
      window: windowFor(19, 3, "partial-hash", true),
    });
    const store = useStore.getState();
    expect(store.threadWindows.get("s1")?.get("q-1825")?.partial).toBe(true);
    expect(store.pendingThreadWindowRequests.get("s1")).toBe("q-1825");

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1825",
      entries: [entry("message-30", 30), entry("message-41", 41), entry("message-42", 42)],
      window: windowFor(5, 30, "full-hash"),
    });
    expect(useStore.getState().threadWindows.get("s1")?.get("q-1825")?.item_count).toBe(30);
    expect(useStore.getState().pendingThreadWindowRequests.has("s1")).toBe(false);
  });

  it("reuses a verified cached selected-thread window hash on reconnect", async () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any],
    });
    const window = {
      thread_key: "main",
      from_item: 7,
      item_count: 12,
      total_items: 20,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 100,
      section_item_count: 4,
      visible_item_count: 3,
      window_hash: "window-hash",
    };
    const entries = [
      { history_index: 7, message: { type: "user_message", id: "u7", content: "cached", timestamp: 7 } },
    ] as any;
    useStore.getState().setThreadWindow("s1", "main", window, []);
    const { cacheThreadWindow } = await import("./utils/history-window-cache.js");
    cacheThreadWindow("s1", window, entries);

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe.initial_thread_window).toEqual({
      thread_key: "main",
      from_item: 7,
      item_count: 12,
      section_item_count: 4,
      visible_item_count: 3,
      cached_window_hash: "window-hash",
    });
  });

  // A revisit restores a saved reading position, which centers the window on
  // its anchor. The held window's hash still goes along, so an unchanged window
  // comes back as a small cache hit instead of being downloaded again.
  it("names the held window hash with a target-centered revisit window", async () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    const window = {
      thread_key: "main",
      from_item: 7,
      item_count: 12,
      total_items: 20,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 100,
      section_item_count: 4,
      visible_item_count: 3,
      window_hash: "window-hash",
    };
    useStore.getState().setThreadWindow("s1", "main", window, []);
    const { cacheThreadWindow } = await import("./utils/history-window-cache.js");
    cacheThreadWindow("s1", window, [
      { history_index: 7, message: { type: "user_message", id: "u7", content: "cached", timestamp: 7 } },
    ] as any);
    useStore.getState().setPendingScrollToMessageId("s1", "u7");

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(JSON.parse(lastWs.send.mock.calls[0][0]).initial_thread_window).toMatchObject({
      from_item: -1,
      target_message_id: "u7",
      cached_window_hash: "window-hash",
    });
  });

  it("keeps a pending legacy message-index scroll on the bounded history subscribe", () => {
    useStore.getState().setPendingScrollToMessageIndex("s1", 42);
    wsModule.connectSession("s1");

    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        history_window_target_index: 42,
      }),
    );
  });

  it("includes the selected leader thread on a soft reconnect with local messages", () => {
    localStorage.setItem("companion:last-seq:s1", "17");
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    useStore.getState().setMessages("s1", [{ id: "existing", role: "user", content: "existing", timestamp: 1 }], {
      frozenCount: 1,
      frozenHash: "frozen-hash",
    });
    window.location.hash = "#/session/s1?thread=q-1831";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(JSON.parse(lastWs.send.mock.calls[0][0])).toMatchObject({
      type: "session_subscribe",
      last_seq: 17,
      known_frozen_count: 1,
      known_frozen_hash: "frozen-hash",
      initial_thread_window: { thread_key: "q-1831", from_item: -1 },
    });
  });

  it("resubscribes to the leader thread on screen when the URL or saved selection points elsewhere", async () => {
    // Regression: the phone showed Main while the subscribe guessed an earlier
    // quest tab from browser state. The server then sent neither Main's fresh
    // window nor its live events, so a leader note written while the socket was
    // down never appeared in Main.
    const { markLeaderThreadDisplayed } = await import("./utils/thread-viewport.js");
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true, archived: false } as any] });
    window.location.hash = "#/session/s1?thread=q-2479";

    // Before any leader view mounts, the URL names the thread to open.
    wsModule.connectSession("s1");
    const originalSocket = lastWs;
    originalSocket.onopen?.(new Event("open"));
    expect(JSON.parse(originalSocket.send.mock.calls[0][0]).initial_thread_window).toMatchObject({
      thread_key: "q-2479",
    });

    // The mounted view shows Main instead; the socket drops and reconnects.
    const unmark = markLeaderThreadDisplayed("s1", "main");
    try {
      originalSocket.onclose?.();
      vi.advanceTimersByTime(2_000);
      expect(lastWs).not.toBe(originalSocket);
      lastWs.onopen?.(new Event("open"));
      expect(JSON.parse(lastWs.send.mock.calls[0][0]).initial_thread_window).toMatchObject({ thread_key: "main" });
    } finally {
      unmark();
    }
  });

  it("snapshots the active leader viewport before reconnecting an unexpectedly closed socket", async () => {
    // Restart regression: the mounted feed can visibly reach message 130 while
    // browser-local storage still contains the earlier message-117 anchor. An
    // unexpected server socket close must synchronously checkpoint the mounted
    // viewport before the reconnect subscribe chooses its bounded-window target.
    const { SAVE_THREAD_VIEWPORT_EVENT, persistLeaderViewportPosition, readLeaderViewportPosition } = await import(
      "./utils/thread-viewport.js"
    );
    localStorage.setItem("cc-server-id", "test-server");
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true, archived: false } as any] });
    window.location.hash = "#/session/s1";
    persistLeaderViewportPosition("s1", "main", {
      scrollTop: 11_700,
      scrollHeight: 14_000,
      isAtBottom: false,
      anchorMessageId: "message-117",
      anchorTurnId: "message-117",
      anchorOffsetTop: 100,
    });

    const handleSnapshot = vi.fn((event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId !== "s1") return;
      // Model the still-mounted MessageFeed synchronously persisting the actual
      // visible message 130 when the transport announces the restart boundary.
      persistLeaderViewportPosition("s1", "main", {
        scrollTop: 12_900,
        scrollHeight: 14_000,
        isAtBottom: false,
        anchorMessageId: "message-130",
        anchorTurnId: "message-130",
        anchorOffsetTop: 100,
      });
    });
    window.addEventListener(SAVE_THREAD_VIEWPORT_EVENT, handleSnapshot);

    try {
      wsModule.connectSession("s1");
      const originalSocket = lastWs;
      originalSocket.onopen?.(new Event("open"));
      expect(JSON.parse(originalSocket.send.mock.calls[0][0]).initial_thread_window).toMatchObject({
        thread_key: "main",
        target_message_id: "message-117",
      });

      originalSocket.onclose?.();

      // This must happen during close handling, before the two-second reconnect
      // timer can create a replacement socket and sample browser-local state.
      expect(handleSnapshot).toHaveBeenCalledTimes(1);
      expect(readLeaderViewportPosition("s1", "main")?.anchorMessageId).toBe("message-130");

      vi.advanceTimersByTime(2_000);
      expect(lastWs).not.toBe(originalSocket);
      lastWs.onopen?.(new Event("open"));

      const reconnectSubscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
      expect(reconnectSubscribe.initial_thread_window).toMatchObject({
        thread_key: "main",
        from_item: -1,
        target_message_id: "message-130",
      });
    } finally {
      window.removeEventListener(SAVE_THREAD_VIEWPORT_EVENT, handleSnapshot);
    }
  });

  // iOS wakes a hidden Home Screen app for a few seconds when a push alert
  // arrives; the dead socket's close then fired a reconnect that downloaded the
  // whole session state just before the app was suspended again. While the page
  // is hidden, a reconnect waits for the page to come back on screen, or a
  // minute as a fallback for hidden desktop tabs.
  describe("reconnect while the page is hidden", () => {
    const SESSION = "hidden-reconnect";
    const socketsFor = () => MockWebSocket.instances.filter((ws) => ws.url.includes(`/ws/browser/${SESSION}`));
    let visibility: DocumentVisibilityState = "visible";

    beforeEach(() => {
      visibility = "visible";
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
      useStore.setState({ sdkSessions: [{ sessionId: SESSION, archived: false } as any] });
      useStore.getState().setCurrentSession(SESSION);
    });

    afterEach(() => {
      delete (document as { visibilityState?: unknown }).visibilityState;
    });

    it("reconnects after a minute instead of two seconds", () => {
      wsModule.connectSession(SESSION);
      socketsFor()[0].onopen?.(new Event("open"));
      visibility = "hidden";
      socketsFor()[0].onclose?.();

      vi.advanceTimersByTime(30_000);
      expect(socketsFor()).toHaveLength(1);
      vi.advanceTimersByTime(30_000);
      expect(socketsFor()).toHaveLength(2);
    });

    it("reconnects at once when the page comes back on screen", () => {
      wsModule.connectSession(SESSION);
      socketsFor()[0].onopen?.(new Event("open"));
      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      socketsFor()[0].onclose?.();
      vi.advanceTimersByTime(5_000);
      expect(socketsFor()).toHaveLength(1);

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      expect(socketsFor()).toHaveLength(2);
    });

    it("keeps the two-second reconnect while the page is visible", () => {
      wsModule.connectSession(SESSION);
      socketsFor()[0].onopen?.(new Event("open"));
      socketsFor()[0].onclose?.();
      vi.advanceTimersByTime(2_000);
      expect(socketsFor()).toHaveLength(2);
    });
  });

  it("keeps bounded capability after an explicit full-history sync request", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    window.location.hash = "#/session/s1?thread=q-1831";
    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));
    lastWs.send.mockClear();

    expect(wsModule.requestFullHistorySync("s1")).toBe(true);

    expect(JSON.parse(lastWs.send.mock.calls[0][0])).toMatchObject({
      type: "session_subscribe",
      last_seq: 0,
      full_history_sync: true,
      initial_thread_window: { thread_key: "q-1831" },
    });
  });

  it("centers a leader legacy message-index link inside the selected bounded thread", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1", isOrchestrator: true } as any] });
    useStore.getState().setPendingScrollToMessageIndex("s1", 42);
    window.location.hash = "#/session/s1?thread=q-1831";

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    const subscribe = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(subscribe.initial_thread_window).toMatchObject({
      thread_key: "q-1831",
      from_item: -1,
      target_history_index: 42,
    });
    expect(subscribe.history_window_target_index).toBeUndefined();
  });

  it("treats windowed history as non-reusable and resubscribes fresh", () => {
    localStorage.setItem("companion:last-seq:s1", "50");
    useStore.getState().setMessages("s1", [{ id: "partial-msg", role: "user", content: "partial", timestamp: 1000 }], {
      frozenCount: 1,
      frozenHash: "stale-window-hash",
    });
    useStore.getState().setHistoryWindow("s1", {
      from_turn: 100,
      turn_count: 150,
      total_turns: 500,
      has_older_items: true,
      has_newer_items: true,
      start_index: 100,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });

    wsModule.connectSession("s1");
    lastWs.onopen?.(new Event("open"));

    expect(lastWs.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        known_frozen_count: 0,
        history_window_section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        history_window_visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      }),
    );
  });

  it("marks history as loading when connecting to a session without local messages", () => {
    wsModule.connectSession("s1");

    expect(useStore.getState().historyLoading.get("s1")).toBe(true);
  });

  it("clears history loading when subscribe completes with only an empty state snapshot", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    expect(useStore.getState().historyLoading.get("s1")).toBe(true);

    fireMessage({
      type: "state_snapshot",
      sessionStatus: "idle",
      permissionMode: "default",
      backendConnected: true,
      backendState: "connected",
      backendError: null,
      uiMode: null,
      askPermission: true,
      lastReadAt: undefined,
      attentionReason: undefined,
      generationStartedAt: null,
    });

    expect(useStore.getState().historyLoading.has("s1")).toBe(false);
  });

  it("does not re-enter history loading for a delivered empty session", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "state_snapshot",
      sessionStatus: "idle",
      permissionMode: "default",
      backendConnected: false,
      backendState: "disconnected",
      backendError: null,
      uiMode: null,
      askPermission: true,
      lastReadAt: undefined,
      attentionReason: undefined,
      generationStartedAt: null,
    });

    expect(useStore.getState().messages.get("s1")).toEqual([]);
    expect(useStore.getState().historyDelivered.has("s1")).toBe(true);
    expect(useStore.getState().historyLoading.has("s1")).toBe(false);

    // Re-selecting or reconnecting the already-delivered empty session should
    // keep the empty state distinct from true history-pending hydration.
    wsModule.connectSession("s1");

    expect(useStore.getState().historyLoading.has("s1")).toBe(false);
  });
});
