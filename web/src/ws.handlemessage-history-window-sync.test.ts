// @vitest-environment jsdom

import type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage } from "./types.js";
import { computeHistoryMessagesSyncHash } from "../shared/history-sync-hash.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT, HISTORY_WINDOW_VISIBLE_SECTION_COUNT } from "../shared/history-window.js";

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

function seedNavigationPreview(preview: string) {
  useStore.getState().setSdkSessions([
    {
      sessionId: "s1",
      state: "connected",
      cwd: "/home/user",
      createdAt: 1,
      lastMessagePreview: preview,
      lastMessagePreviewAt: 2_000,
    },
  ]);
}

// ===========================================================================
// Connection
// ===========================================================================
describe("handleMessage: history_window_sync", () => {
  it("replaces local messages with the requested history window and preserves raw history indexes", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    useStore
      .getState()
      .setMessages("s1", [{ id: "stale", role: "assistant", content: "stale", timestamp: 1 }], { frozenCount: 0 });

    fireMessage({
      type: "history_window_sync",
      messages: [
        { type: "user_message", id: "u-window", content: "window user", timestamp: 1000 },
        {
          type: "tool_result_preview",
          previews: [
            {
              tool_use_id: "tool-window",
              content: "hidden preview",
              is_error: false,
              total_size: 14,
              is_truncated: false,
            },
          ],
        },
        {
          type: "assistant",
          message: {
            id: "a-window",
            type: "message",
            role: "assistant",
            model: "claude-opus-4-20250514",
            content: [{ type: "text", text: "window reply" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 2000,
        },
      ],
      window: {
        from_turn: 100,
        turn_count: 150,
        total_turns: 320,
        has_older_items: true,
        has_newer_items: true,
        start_index: 50,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });

    const msgs = useStore.getState().messages.get("s1")!;
    expect(msgs.map((m) => m.id)).toEqual(["u-window", "a-window"]);
    expect(msgs.map((m) => m.historyIndex)).toEqual([50, 52]);
    expect(useStore.getState().historyWindows.get("s1")).toEqual({
      from_turn: 100,
      turn_count: 150,
      total_turns: 320,
      has_older_items: true,
      has_newer_items: true,
      start_index: 50,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });
  });

  it("reuses cached history window messages only after a server-validated cache hit", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    const window = {
      from_turn: 100,
      turn_count: 1,
      total_turns: 320,
      has_older_items: true,
      has_newer_items: true,
      start_index: 50,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      window_hash: "history-window-hash",
    };

    fireMessage({
      type: "history_window_sync",
      messages: [{ type: "user_message", id: "u-cached", content: "cached window user", timestamp: 1000 }],
      window,
    });

    useStore
      .getState()
      .setMessages("s1", [{ id: "stale", role: "assistant", content: "stale", timestamp: 1 }], { frozenCount: 0 });

    fireMessage({
      type: "history_window_sync",
      cache_hit: true,
      messages: [],
      window,
    });

    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.map((msg) => msg.id),
    ).toEqual(["u-cached"]);
  });

  it("hydrates resolved Codex Bash previews from cached history windows", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    const window = {
      from_turn: 100,
      turn_count: 1,
      total_turns: 320,
      has_older_items: true,
      has_newer_items: true,
      start_index: 50,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      window_hash: "history-window-bash-hash",
    };
    const messages = [
      {
        type: "assistant",
        message: {
          id: "a-bash-window",
          type: "message",
          role: "assistant",
          model: "gpt-5.5",
          content: [{ type: "tool_use", id: "bash-window", name: "Bash", input: { command: "quest list" } }],
          stop_reason: null,
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1000,
        tool_start_times: { "bash-window": 1234 },
      },
      {
        type: "tool_result_preview",
        previews: [
          {
            tool_use_id: "bash-window",
            content: "quest output",
            is_error: false,
            total_size: 12,
            is_truncated: false,
          },
        ],
      },
    ];

    fireMessage({ type: "history_window_sync", messages, window });
    useStore.setState({ toolResults: new Map(), toolProgress: new Map(), toolStartTimestamps: new Map() });
    useStore.getState().setToolProgress("s1", "bash-window", {
      toolName: "Bash",
      elapsedSeconds: 9_000,
      outputDelta: "stale progress",
    });
    useStore.getState().setToolStartTimestamps("s1", { "bash-window": 1 });

    fireMessage({
      type: "history_window_sync",
      cache_hit: true,
      messages: [],
      window,
    });

    const state = useStore.getState();
    expect(state.toolProgress.has("s1")).toBe(false);
    expect(state.toolResults.get("s1")?.get("bash-window")?.content).toBe("quest output");
    expect(state.toolStartTimestamps.get("s1")?.get("bash-window")).toBe(1234);
  });

  it("refetches a cache-hit history window without replacing visible state when the local cache entry is missing", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    const existingWindow = {
      from_turn: 250,
      turn_count: 50,
      total_turns: 320,
      has_older_items: true,
      has_newer_items: true,
      start_index: 125,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    };
    useStore
      .getState()
      .setMessages("s1", [{ id: "still-visible", role: "assistant", content: "keep me", timestamp: 1 }], {
        frozenCount: 0,
      });
    useStore.getState().setHistoryWindow("s1", existingWindow);
    lastWs.send.mockClear();

    fireMessage({
      type: "history_window_sync",
      cache_hit: true,
      messages: [],
      window: {
        from_turn: 100,
        turn_count: 150,
        total_turns: 320,
        has_older_items: true,
        has_newer_items: true,
        start_index: 50,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        window_hash: "missing-local-history-window",
      },
    });

    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.map((msg) => msg.id),
    ).toEqual(["still-visible"]);
    expect(useStore.getState().historyWindows.get("s1")).toEqual(existingWindow);
    expect(lastWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lastWs.send.mock.calls[0][0])).toEqual({
      type: "history_window_request",
      from_turn: 100,
      turn_count: 150,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      activate_view: true,
    });
  });

  it("uses history_window_sync as the sole authoritative history-window state", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().setMessages("s1", [{ id: "visible", role: "assistant", content: "visible", timestamp: 1 }], {
      frozenCount: 0,
    });
    const window = {
      from_turn: 20,
      turn_count: 10,
      total_turns: 40,
      has_older_items: true,
      has_newer_items: true,
      start_index: 200,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      window_hash: "hash-1",
    };

    fireMessage({
      type: "history_window_sync",
      messages: [{ type: "user_message", id: "u-window", content: "window user", timestamp: 1000 }],
      window,
    });

    const state = useStore.getState();
    expect(state.messages.get("s1")?.map((message) => message.id)).toEqual(["u-window"]);
    expect(state.historyWindows.get("s1")).toEqual(window);
    expect("feedWindowSyncs" in state).toBe(false);
  });

  it("keeps a pending raw-index scroll when the current history window does not contain the target", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().setPendingScrollToMessageIndex("s1", 49);

    fireMessage({
      type: "history_window_sync",
      messages: [{ type: "user_message", id: "u-window-50", content: "window user", timestamp: 1000 }],
      window: {
        from_turn: 100,
        turn_count: 1,
        total_turns: 320,
        has_older_items: true,
        has_newer_items: true,
        start_index: 50,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });

    expect(useStore.getState().scrollToMessageId.get("s1")).toBeUndefined();
    expect(useStore.getState().pendingScrollToMessageIndex.get("s1")).toBe(49);
  });

  it("does not overwrite the session preview when loading an older history window", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedNavigationPreview("latest preview");

    fireMessage({
      type: "history_window_sync",
      messages: [{ type: "user_message", id: "u-older", content: "older historical text", timestamp: 1000 }],
      window: {
        from_turn: 10,
        turn_count: 50,
        total_turns: 500,
        has_older_items: true,
        has_newer_items: true,
        start_index: 10,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });

    expect(useStore.getState().sdkSessions[0]?.lastMessagePreview).toBe("latest preview");
  });

  it("does not derive the canonical preview even when a history window includes the latest turn", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedNavigationPreview("server-owned preview");

    fireMessage({
      type: "history_window_sync",
      messages: [{ type: "user_message", id: "u-latest", content: "newest visible text", timestamp: 1000 }],
      window: {
        from_turn: 450,
        turn_count: 50,
        total_turns: 500,
        has_older_items: true,
        has_newer_items: false,
        start_index: 450,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });

    expect(useStore.getState().sdkSessions[0]?.lastMessagePreview).toBe("server-owned preview");
  });

  it("does not derive canonical preview text from reply context in loaded history", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedNavigationPreview("server-owned preview");

    fireMessage({
      type: "history_window_sync",
      messages: [
        {
          type: "user_message",
          id: "u-reply",
          content: "continue the work",
          replyContext: { previewText: "Original answer", messageId: "codex-agent-random-id" },
          timestamp: 1000,
        },
      ],
      window: {
        from_turn: 450,
        turn_count: 50,
        total_turns: 500,
        has_older_items: true,
        has_newer_items: false,
        start_index: 450,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    });

    expect(useStore.getState().sdkSessions[0]?.lastMessagePreview).toBe("server-owned preview");
  });

  it("clears window metadata when a full history_sync later arrives", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().setHistoryWindow("s1", {
      from_turn: 10,
      turn_count: 150,
      total_turns: 200,
      has_older_items: true,
      has_newer_items: true,
      start_index: 10,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });

    fireMessage({
      type: "history_sync",
      frozen_base_count: 0,
      frozen_base_history_index: 0,
      frozen_delta: [{ type: "user_message", id: "u-full", content: "full history", timestamp: 1000 }],
      hot_messages: [],
      frozen_count: 1,
      expected_frozen_hash: "full-frozen",
      expected_full_hash: "full-hash",
    });

    expect(useStore.getState().historyWindows.has("s1")).toBe(false);
  });
});

describe("handleMessage: thread_window_sync", () => {
  it("stores selected-feed window messages without replacing raw history state", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore
      .getState()
      .setMessages("s1", [{ id: "raw-existing", role: "user", content: "raw", timestamp: 1 }], { frozenCount: 1 });
    useStore.getState().setHistoryWindow("s1", {
      from_turn: 10,
      turn_count: 5,
      total_turns: 100,
      has_older_items: true,
      has_newer_items: true,
      start_index: 50,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1040",
      entries: [
        {
          history_index: 120,
          message: {
            type: "user_message",
            id: "u-thread",
            content: "selected feed message",
            timestamp: 2000,
            threadKey: "q-1040",
            questId: "q-1040",
            threadRefs: [{ threadKey: "q-1040", questId: "q-1040", source: "explicit" }],
          },
        },
        {
          history_index: 121,
          synthetic: true,
          message: {
            type: "cross_thread_activity_marker",
            id: "cross-thread-activity:project-notes:u-project",
            timestamp: 2100,
            threadKey: "project-notes",
            count: 2,
            firstMessageId: "u-project",
            lastMessageId: "a-project",
            firstHistoryIndex: 12,
            lastHistoryIndex: 13,
            startedAt: 2050,
            updatedAt: 2100,
          },
        },
      ],
      window: {
        thread_key: "q-1040",
        from_item: 20,
        item_count: 2,
        total_items: 40,
        has_older_items: true,
        has_newer_items: true,
        source_history_length: 150,
        section_item_count: 10,
        visible_item_count: 2,
      },
    });

    expect(
      useStore
        .getState()
        .messages.get("s1")
        ?.map((message) => message.id),
    ).toEqual(["raw-existing"]);
    expect(useStore.getState().historyWindows.get("s1")).toEqual({
      from_turn: 10,
      turn_count: 5,
      total_turns: 100,
      has_older_items: true,
      has_newer_items: true,
      start_index: 50,
      section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
      visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
    });
    expect(useStore.getState().threadWindows.get("s1")?.get("q-1040")).toEqual({
      thread_key: "q-1040",
      from_item: 20,
      item_count: 2,
      total_items: 40,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 150,
      section_item_count: 10,
      visible_item_count: 2,
    });
    expect(
      useStore
        .getState()
        .threadWindowMessages.get("s1")
        ?.get("q-1040")
        ?.map((message) => message.id),
    ).toEqual(["u-thread", "cross-thread-activity:project-notes:u-project"]);
    expect(
      useStore
        .getState()
        .threadWindowMessages.get("s1")
        ?.get("q-1040")
        ?.map((message) => message.historyIndex),
    ).toEqual([120, 121]);
    expect(useStore.getState().cliEverConnected.get("s1")).toBe(true);
  });

  it("hydrates Codex assistant phases in selected thread windows", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-4242",
      entries: [
        {
          history_index: 41,
          message: {
            type: "assistant",
            codexMessagePhase: "final_answer",
            timestamp: 2000,
            threadKey: "q-4242",
            questId: "q-4242",
            parent_tool_use_id: null,
            message: {
              id: "codex-agent-window-phase",
              type: "message",
              role: "assistant",
              model: "gpt-5.6-sol",
              content: [{ type: "text", text: "Window answer" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
      ],
      window: {
        thread_key: "q-4242",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 42,
        section_item_count: 10,
        visible_item_count: 2,
      },
    });

    expect(useStore.getState().threadWindowMessages.get("s1")?.get("q-4242")?.[0]?.metadata?.codexMessagePhase).toBe(
      "final_answer",
    );
  });

  it("does not retain root thinking-only assistant entries in selected thread windows", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1802",
      entries: [
        {
          history_index: 40,
          message: {
            type: "assistant",
            timestamp: 1500,
            threadKey: "q-1802",
            questId: "q-1802",
            threadRefs: [{ threadKey: "q-1802", questId: "q-1802", source: "explicit" }],
            parent_tool_use_id: null,
            message: {
              id: "a-root-thinking-thread",
              type: "message",
              role: "assistant",
              model: "gpt-5.6-sol",
              content: [{ type: "thinking", thinking: "**Reviewing the route**\n\nBody" }],
              stop_reason: null,
              usage: { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
        {
          history_index: 41,
          message: {
            type: "assistant",
            timestamp: 2000,
            threadKey: "q-1802",
            questId: "q-1802",
            threadRefs: [{ threadKey: "q-1802", questId: "q-1802", source: "explicit" }],
            parent_tool_use_id: null,
            message: {
              id: "a-visible-thread",
              type: "message",
              role: "assistant",
              model: "gpt-5.6-sol",
              content: [{ type: "text", text: "Visible thread answer" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 5, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
      ],
      window: {
        thread_key: "q-1802",
        from_item: 0,
        item_count: 2,
        total_items: 2,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 42,
        section_item_count: 10,
        visible_item_count: 2,
      },
    });

    const windowMessages = useStore.getState().threadWindowMessages.get("s1")?.get("q-1802") ?? [];
    expect(windowMessages.map((msg) => msg.id)).toEqual(["a-visible-thread"]);
    expect(windowMessages.map((msg) => msg.content).join("\n")).not.toContain("Reviewing the route");
  });

  it("hydrates persistent reasoning details in selected thread order", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1842",
      entries: [
        {
          history_index: 40,
          message: {
            type: "codex_reasoning_detail",
            id: "codex-reasoning-r1",
            text: "**Inspecting selected history**\n\nFull detail.",
            status: "complete",
            timestamp: 1500,
            parent_tool_use_id: null,
            threadKey: "q-1842",
            questId: "q-1842",
          },
        },
      ],
      window: {
        thread_key: "q-1842",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 41,
        section_item_count: 10,
        visible_item_count: 2,
      },
    });

    expect(useStore.getState().threadWindowMessages.get("s1")?.get("q-1842")).toEqual([
      expect.objectContaining({
        id: "codex-reasoning-r1",
        historyIndex: 40,
        metadata: expect.objectContaining({ codexReasoningDetail: { status: "complete" } }),
      }),
    ]);

    fireMessage({
      type: "codex_reasoning_detail",
      id: "codex-reasoning-r1",
      text: "**Inspecting selected history**\n\nUpdated live detail.",
      status: "complete",
      timestamp: 1500,
      parent_tool_use_id: null,
      threadKey: "q-1842",
      questId: "q-1842",
    });

    expect(useStore.getState().threadWindowMessages.get("s1")?.get("q-1842")?.[0]).toMatchObject({
      id: "codex-reasoning-r1",
      content: "**Inspecting selected history**\n\nUpdated live detail.",
      historyIndex: 40,
    });
  });

  it("strips root Codex thinking blocks from mixed selected thread window entries", () => {
    // Selected-thread hydration must match live/full-history suppression without dropping the durable sibling tool.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1802",
      entries: [
        {
          history_index: 40,
          message: {
            type: "assistant",
            timestamp: 1500,
            threadKey: "q-1802",
            questId: "q-1802",
            threadRefs: [{ threadKey: "q-1802", questId: "q-1802", source: "explicit" }],
            parent_tool_use_id: null,
            message: {
              id: "a-root-thinking-tool-thread",
              type: "message",
              role: "assistant",
              model: "gpt-5.6-sol",
              content: [
                { type: "thinking", thinking: "**Evaluating quest ideas**\n\nThis should not persist." },
                { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "quest list" } },
              ],
              stop_reason: null,
              usage: { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
      ],
      window: {
        thread_key: "q-1802",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 41,
        section_item_count: 10,
        visible_item_count: 1,
      },
    });

    const [message] = useStore.getState().threadWindowMessages.get("s1")?.get("q-1802") ?? [];
    expect(message?.content).not.toContain("Evaluating quest ideas");
    expect(message?.contentBlocks).toEqual([
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "quest list" } },
    ]);
  });

  it("preserves parented Codex thinking in selected thread windows", () => {
    // Selected-window hydration must keep genuinely scoped subagent thinking while filtering only the root path.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "main",
      entries: [
        {
          history_index: 41,
          message: {
            type: "assistant",
            timestamp: 1500,
            parent_tool_use_id: "agent-1",
            message: {
              id: "a-parented-thinking-thread",
              type: "message",
              role: "assistant",
              model: "gpt-5.6-sol",
              content: [{ type: "thinking", thinking: "Scoped subagent reasoning" }],
              stop_reason: null,
              usage: { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
      ],
      window: {
        thread_key: "main",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 42,
        section_item_count: 10,
        visible_item_count: 1,
      },
    });

    const [message] = useStore.getState().threadWindowMessages.get("s1")?.get("main") ?? [];
    expect(message?.parentToolUseId).toBe("agent-1");
    expect(message?.contentBlocks).toBeUndefined();
    expect(message?.content).toBe("Scoped subagent reasoning");
    expect(message?.metadata?.codexReasoningDetail?.status).toBe("complete");
  });

  it("preserves root Claude thinking in selected thread windows", () => {
    // The Codex-only suppression rule must not change Claude history when switching thread windows.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "claude" } });

    fireMessage({
      type: "thread_window_sync",
      thread_key: "main",
      entries: [
        {
          history_index: 42,
          message: {
            type: "assistant",
            timestamp: 1500,
            parent_tool_use_id: null,
            message: {
              id: "a-claude-thinking-thread",
              type: "message",
              role: "assistant",
              model: "claude-sonnet",
              content: [{ type: "thinking", thinking: "Claude root reasoning" }],
              stop_reason: null,
              usage: { input_tokens: 5, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
          },
        },
      ],
      window: {
        thread_key: "main",
        from_item: 0,
        item_count: 1,
        total_items: 1,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 43,
        section_item_count: 10,
        visible_item_count: 1,
      },
    });

    const [message] = useStore.getState().threadWindowMessages.get("s1")?.get("main") ?? [];
    expect(message?.contentBlocks).toEqual([{ type: "thinking", thinking: "Claude root reasoning" }]);
  });

  it("hydrates historical result errors with neighbor timestamps in selected-feed windows", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    vi.setSystemTime(new Date(3000));

    fireMessage({
      type: "thread_window_sync",
      thread_key: "main",
      entries: [
        {
          history_index: 19005,
          message: {
            type: "user_message",
            id: "timer-t53",
            content: "Backstop q1175 dashboard",
            timestamp: 1000,
          },
        },
        {
          history_index: 19006,
          message: {
            type: "result",
            data: {
              type: "result",
              subtype: "error_during_execution",
              is_error: true,
              result: "stream disconnected before completion",
              duration_ms: 1,
              duration_api_ms: 1,
              num_turns: 1,
              total_cost_usd: 0,
              stop_reason: null,
              usage: {
                input_tokens: 1,
                output_tokens: 1,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          },
        },
        {
          history_index: 19049,
          message: {
            type: "user_message",
            id: "server-restarted",
            content: "server restarted. continue ongoing work",
            timestamp: 2000,
          },
        },
      ],
      window: {
        thread_key: "main",
        from_item: 0,
        item_count: 3,
        total_items: 3,
        has_older_items: false,
        has_newer_items: false,
        source_history_length: 19100,
        section_item_count: 10,
        visible_item_count: 3,
      },
    });

    expect(
      useStore
        .getState()
        .threadWindowMessages.get("s1")
        ?.get("main")
        ?.map((message) => [message.id, message.timestamp]),
    ).toEqual([
      ["timer-t53", 1000],
      ["hist-error-19006", 1000],
      ["server-restarted", 2000],
    ]);
  });

  it("reuses cached thread window entries only after a server-validated cache hit", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    const window = {
      thread_key: "q-1040",
      from_item: 20,
      item_count: 1,
      total_items: 40,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 150,
      section_item_count: 10,
      visible_item_count: 2,
      window_hash: "thread-window-hash",
    };

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1040",
      entries: [
        {
          history_index: 120,
          message: {
            type: "user_message",
            id: "u-thread-cached",
            content: "selected feed message",
            timestamp: 2000,
            threadKey: "q-1040",
            questId: "q-1040",
            threadRefs: [{ threadKey: "q-1040", questId: "q-1040", source: "explicit" }],
          },
        },
      ],
      window,
    });

    fireMessage({
      type: "thread_window_sync",
      cache_hit: true,
      thread_key: "q-1040",
      entries: [],
      window,
    });

    expect(
      useStore
        .getState()
        .threadWindowMessages.get("s1")
        ?.get("q-1040")
        ?.map((message) => message.id),
    ).toEqual(["u-thread-cached"]);
  });

  it("hydrates resolved Codex Bash previews from cached selected-thread windows", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), backend_type: "codex" } });

    const window = {
      thread_key: "analysis-thread",
      from_item: 20,
      item_count: 1,
      total_items: 40,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 150,
      section_item_count: 10,
      visible_item_count: 2,
      window_hash: "thread-window-bash-hash",
    };
    const entries = [
      {
        history_index: 120,
        message: {
          type: "assistant",
          message: {
            id: "a-bash-thread",
            type: "message",
            role: "assistant",
            model: "gpt-5.5",
            content: [{ type: "tool_use", id: "bash-thread", name: "Bash", input: { command: "takode scan session" } }],
            stop_reason: null,
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
          timestamp: 1000,
          tool_start_times: { "bash-thread": 5678 },
          threadKey: "analysis-thread",
          questId: "analysis-thread",
          threadRefs: [{ threadKey: "analysis-thread", questId: "analysis-thread", source: "explicit" }],
        },
      },
      {
        history_index: 121,
        message: {
          type: "tool_result_preview",
          previews: [
            {
              tool_use_id: "bash-thread",
              content: "scan output",
              is_error: false,
              total_size: 11,
              is_truncated: false,
            },
          ],
        },
      },
    ];

    fireMessage({ type: "thread_window_sync", thread_key: "analysis-thread", entries, window });
    useStore.setState({ toolResults: new Map(), toolStartTimestamps: new Map() });
    useStore.getState().setToolStartTimestamps("s1", { "bash-thread": 1 });

    fireMessage({
      type: "thread_window_sync",
      cache_hit: true,
      thread_key: "analysis-thread",
      entries: [],
      window,
    });

    const state = useStore.getState();
    expect(state.toolResults.get("s1")?.get("bash-thread")?.content).toBe("scan output");
    expect(state.toolStartTimestamps.get("s1")?.get("bash-thread")).toBe(5678);
  });

  it("refetches a cache-hit selected-thread window without replacing visible state when the local cache is invalid", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    const existingThreadWindow = {
      thread_key: "q-1040",
      from_item: 30,
      item_count: 10,
      total_items: 40,
      has_older_items: true,
      has_newer_items: false,
      source_history_length: 150,
      section_item_count: 10,
      visible_item_count: 2,
    };
    useStore
      .getState()
      .setThreadWindow("s1", "q-1040", existingThreadWindow, [
        { id: "still-visible-thread", role: "user", content: "keep thread", timestamp: 1 },
      ]);
    localStorage.setItem("cc-thread-window-cache:v1:s1:q-1040", "{not valid json");
    lastWs.send.mockClear();

    fireMessage({
      type: "thread_window_sync",
      cache_hit: true,
      thread_key: "q-1040",
      entries: [],
      window: {
        thread_key: "q-1040",
        from_item: 20,
        item_count: 10,
        total_items: 40,
        has_older_items: true,
        has_newer_items: true,
        source_history_length: 150,
        section_item_count: 10,
        visible_item_count: 2,
        window_hash: "invalid-local-thread-window",
      },
    });

    expect(
      useStore
        .getState()
        .threadWindowMessages.get("s1")
        ?.get("q-1040")
        ?.map((message) => message.id),
    ).toEqual(["still-visible-thread"]);
    expect(useStore.getState().threadWindows.get("s1")?.get("q-1040")).toEqual(existingThreadWindow);
    expect(lastWs.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(lastWs.send.mock.calls[0][0])).toEqual({
      type: "thread_window_request",
      thread_key: "q-1040",
      from_item: 20,
      item_count: 10,
      section_item_count: 10,
      visible_item_count: 2,
      activate_view: true,
    });
  });

  it("uses thread_window_sync as the sole authoritative selected-thread window state", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().setThreadWindow(
      "s1",
      "q-1040",
      {
        thread_key: "q-1040",
        from_item: 20,
        item_count: 1,
        total_items: 40,
        has_older_items: true,
        has_newer_items: true,
        source_history_length: 150,
        section_item_count: 10,
        visible_item_count: 2,
      },
      [{ id: "visible-thread", role: "assistant", content: "visible", timestamp: 1 }],
    );
    const window = {
      thread_key: "q-1040",
      from_item: 20,
      item_count: 1,
      total_items: 40,
      has_older_items: true,
      has_newer_items: true,
      source_history_length: 150,
      section_item_count: 10,
      visible_item_count: 2,
      window_hash: "hash-thread",
    };

    fireMessage({
      type: "thread_window_sync",
      thread_key: "q-1040",
      entries: [
        {
          history_index: 120,
          message: {
            type: "user_message",
            id: "u-thread",
            content: "thread user",
            timestamp: 1000,
            threadKey: "q-1040",
            questId: "q-1040",
          },
        },
      ],
      window,
    });

    const state = useStore.getState();
    expect(
      state.threadWindowMessages
        .get("s1")
        ?.get("q-1040")
        ?.map((message) => message.id),
    ).toEqual(["u-thread"]);
    expect(state.threadWindows.get("s1")?.get("q-1040")).toEqual(window);
    expect("threadFeedWindowSyncs" in state).toBe(false);
  });
});
