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
describe("handleMessage: stream_event", () => {
  it("keeps generation stats through message boundaries", () => {
    // Live text never reaches the browser; stream events only drive the
    // generation timer and token count, which a message stop must not reset.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({ type: "stream_event", event: { type: "message_start" }, parent_tool_use_id: null });
    const startedAt = useStore.getState().streamingStartedAt.get("s1");
    expect(startedAt).toEqual(expect.any(Number));
    fireMessage({
      type: "stream_event",
      event: { type: "message_delta", delta: { stop_reason: null }, usage: { output_tokens: 34 } },
      parent_tool_use_id: null,
    });
    fireMessage({ type: "stream_event", event: { type: "message_stop" }, parent_tool_use_id: null });

    const state = useStore.getState();
    expect(state.streamingStartedAt.get("s1")).toBe(startedAt);
    expect(state.streamingOutputTokens.get("s1")).toBe(34);
  });

  it("does not invent retained reasoning rows from raw thinking stream events", () => {
    // The server publishes routed retained rows separately; raw stream events never create them in the browser.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
    });

    fireMessage({
      type: "stream_event",
      event: { type: "content_block_start", content_block: { type: "thinking", thinking: "Inspecting " } },
      parent_tool_use_id: null,
    });
    fireMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "session state" } },
      parent_tool_use_id: null,
    });

    expect(useStore.getState().codexReasoningPreviews.has("s1")).toBe(false);
  });

  it("stores full server-authored Codex reasoning text without Takode-side truncation", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
    });
    const longReasoning = `Start ${"x".repeat(4_500)} End`;

    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
      codexReasoningPreviews: [{ text: longReasoning, updatedAt: 123, threadKey: "q-975", questId: "q-975" }],
    });

    expect(useStore.getState().codexReasoningPreviews.get("s1")?.get("q-975")?.text).toBe(longReasoning);
    expect(useStore.getState().codexReasoningPreviews.get("s1")?.get("q-975")?.truncated).toBeUndefined();
  });

  it("does not let raw non-reasoning streams clear server-authored retained rows", () => {
    // The matching server status update owns clear ordering after authoritative thread routing.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
    });
    useStore
      .getState()
      .setCodexReasoningPreviews("s1", [
        { text: "Reasoning trace", updatedAt: 1, threadKey: "q-975", questId: "q-975" },
      ]);

    fireMessage({
      type: "stream_event",
      event: { type: "content_block_start", content_block: { type: "text", text: "" } },
      parent_tool_use_id: null,
    });

    expect(useStore.getState().codexReasoningPreviews.get("s1")?.has("q-975")).toBe(true);
  });

  it("does not invent a retained row from a late raw thinking delta", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
    });
    fireMessage({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: " late" } },
      parent_tool_use_id: null,
    });

    expect(useStore.getState().codexReasoningPreviews.has("s1")).toBe(false);
  });
});
