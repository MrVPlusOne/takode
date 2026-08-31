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
  MockWebSocket.OPEN = 1;

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
describe("sendToSession", () => {
  it("JSON-stringifies and sends the message", () => {
    wsModule.connectSession("s1");
    const msg = { type: "user_message" as const, content: "hello" };

    expect(wsModule.sendToSession("s1", msg)).toBe(true);

    const payload = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(payload.type).toBe("user_message");
    expect(payload.content).toBe("hello");
    expect(typeof payload.client_msg_id).toBe("string");
  });

  it("does nothing when session has no socket", () => {
    // Should not throw
    expect(wsModule.sendToSession("nonexistent", { type: "interrupt" })).toBe(false);
  });

  it("does not confuse a missing socket with an unavailable global OPEN constant", () => {
    // Disconnected/Playground environments may expose an incomplete WebSocket
    // constructor. Socket ownership must be checked before readiness equality.
    MockWebSocket.OPEN = undefined as unknown as number;

    expect(wsModule.sendToSession("playground-without-socket", { type: "interrupt" })).toBe(false);
  });

  it("declines a socket-shaped value that has no send capability", () => {
    wsModule.connectSession("s1");
    (lastWs as unknown as { send?: unknown }).send = undefined;

    expect(wsModule.sendToSession("s1", { type: "interrupt" })).toBe(false);
  });

  it("declines an owned callable socket when the OPEN constant is missing", () => {
    wsModule.connectSession("s1");
    MockWebSocket.OPEN = undefined as unknown as number;

    expect(typeof lastWs.send).toBe("function");
    expect(lastWs.readyState).toBe(1);
    expect(wsModule.sendToSession("s1", { type: "interrupt" })).toBe(false);
    expect(lastWs.send).not.toHaveBeenCalled();
  });

  it("declines an owned callable socket when readyState is missing", () => {
    wsModule.connectSession("s1");
    (lastWs as unknown as { readyState?: number }).readyState = undefined;

    expect(typeof lastWs.send).toBe("function");
    expect(MockWebSocket.OPEN).toBe(1);
    expect(wsModule.sendToSession("s1", { type: "interrupt" })).toBe(false);
    expect(lastWs.send).not.toHaveBeenCalled();
  });

  it("declines an owned callable socket when both readiness values are missing", () => {
    MockWebSocket.OPEN = undefined as unknown as number;
    wsModule.connectSession("s1");

    expect(typeof lastWs.send).toBe("function");
    expect(lastWs.readyState).toBeUndefined();
    expect(wsModule.sendToSession("s1", { type: "interrupt" })).toBe(false);
    expect(lastWs.send).not.toHaveBeenCalled();
  });

  it("preserves provided client_msg_id", () => {
    wsModule.connectSession("s1");
    wsModule.sendToSession("s1", {
      type: "user_message",
      content: "hello",
      client_msg_id: "fixed-id-1",
    });

    const payload = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(payload.client_msg_id).toBe("fixed-id-1");
  });

  it("adds client_msg_id for interrupt control message", () => {
    wsModule.connectSession("s1");
    wsModule.sendToSession("s1", { type: "interrupt" });

    const payload = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(payload.type).toBe("interrupt");
    expect(typeof payload.client_msg_id).toBe("string");
  });

  it("adds client_msg_id for exact pending-input retry and cancel actions", () => {
    wsModule.connectSession("s1");
    wsModule.sendToSession("s1", { type: "retry_pending_codex_input", id: "pending-1" });
    wsModule.sendToSession("s1", { type: "cancel_pending_codex_input", id: "pending-2" });
    wsModule.sendToSession("s1", { type: "resolve_codex_turn_recovery", recoveryId: "recovery-1" });

    const retry = JSON.parse(lastWs.send.mock.calls[0][0]);
    const cancel = JSON.parse(lastWs.send.mock.calls[1][0]);
    const resolve = JSON.parse(lastWs.send.mock.calls[2][0]);
    expect(retry).toMatchObject({ type: "retry_pending_codex_input", id: "pending-1" });
    expect(cancel).toMatchObject({ type: "cancel_pending_codex_input", id: "pending-2" });
    expect(typeof retry.client_msg_id).toBe("string");
    expect(typeof cancel.client_msg_id).toBe("string");
    expect(resolve).toMatchObject({ type: "resolve_codex_turn_recovery", recoveryId: "recovery-1" });
    expect(typeof resolve.client_msg_id).toBe("string");
    expect(new Set([retry.client_msg_id, cancel.client_msg_id, resolve.client_msg_id]).size).toBe(3);
  });

  it("adds client_msg_id for leader thread tab updates", () => {
    wsModule.connectSession("s1");
    wsModule.sendToSession("s1", {
      type: "leader_thread_tabs_update",
      operation: { type: "open", threadKey: "q-1089", placement: "first" },
    });

    const payload = JSON.parse(lastWs.send.mock.calls[0][0]);
    expect(payload.type).toBe("leader_thread_tabs_update");
    expect(payload.operation).toEqual({ type: "open", threadKey: "q-1089", placement: "first" });
    expect(typeof payload.client_msg_id).toBe("string");
  });
});

describe("waitForConnection", () => {
  it("does not resolve a missing socket when the global OPEN constant is unavailable", async () => {
    MockWebSocket.OPEN = undefined as unknown as number;
    const waiting = expect(wsModule.waitForConnection("missing-playground-socket")).rejects.toThrow(
      "Connection timeout",
    );

    await vi.advanceTimersByTimeAsync(10_000);
    await waiting;
  });

  it("does not resolve a socket-shaped value without send capability", async () => {
    wsModule.connectSession("incomplete-socket");
    (lastWs as unknown as { send?: unknown }).send = undefined;
    const waiting = expect(wsModule.waitForConnection("incomplete-socket")).rejects.toThrow("Connection timeout");

    await vi.advanceTimersByTimeAsync(10_000);
    await waiting;
  });

  it("does not resolve an owned callable socket when the OPEN constant is missing", async () => {
    wsModule.connectSession("missing-open-state");
    MockWebSocket.OPEN = undefined as unknown as number;
    const waiting = expect(wsModule.waitForConnection("missing-open-state")).rejects.toThrow("Connection timeout");

    await vi.advanceTimersByTimeAsync(10_000);
    await waiting;
  });

  it("does not resolve an owned callable socket when readyState is missing", async () => {
    wsModule.connectSession("missing-ready-state");
    (lastWs as unknown as { readyState?: number }).readyState = undefined;
    const waiting = expect(wsModule.waitForConnection("missing-ready-state")).rejects.toThrow("Connection timeout");

    await vi.advanceTimersByTimeAsync(10_000);
    await waiting;
  });

  it("does not resolve an owned callable socket when both readiness values are missing", async () => {
    MockWebSocket.OPEN = undefined as unknown as number;
    wsModule.connectSession("missing-readiness");
    const waiting = expect(wsModule.waitForConnection("missing-readiness")).rejects.toThrow("Connection timeout");

    await vi.advanceTimersByTimeAsync(10_000);
    await waiting;
  });

  it("resolves for an owned connected socket with send capability", async () => {
    wsModule.connectSession("connected-socket");
    const waiting = wsModule.waitForConnection("connected-socket");

    await vi.advanceTimersByTimeAsync(50);
    await expect(waiting).resolves.toBeUndefined();
  });
});
