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
describe("disconnectSession", () => {
  it("unbinds an open socket, keeps it briefly for the next session, then closes it", () => {
    wsModule.connectSession("s1");
    const ws = lastWs;

    wsModule.disconnectSession("s1");

    // The server stops sending s1 to it, but the connection itself is kept.
    expect(ws.send).toHaveBeenCalledWith(JSON.stringify({ type: "session_switch", session_id: null }));
    expect(ws.close).not.toHaveBeenCalled();
    ws.send.mockClear();
    // Sending after disconnect should be a no-op
    wsModule.sendToSession("s1", { type: "interrupt" });
    expect(ws.send).not.toHaveBeenCalled();
    // Nothing reused it, so it closes.
    vi.advanceTimersByTime(5_000);
    expect(ws.close).toHaveBeenCalled();
  });

  it("closes a socket that is not open yet", () => {
    wsModule.connectSession("s1");
    const ws = lastWs;
    ws.readyState = MockWebSocket.CONNECTING;

    wsModule.disconnectSession("s1");

    expect(ws.close).toHaveBeenCalled();
    expect(ws.send).not.toHaveBeenCalled();
  });

  // A session switch on a slow link must not pay for a new connection: the next
  // session takes over the open socket, and anything the old session still had
  // in flight is dropped until the new session's session_init arrives.
  it("reuses the open socket for the next session", () => {
    wsModule.connectSession("s1");
    const ws = lastWs;
    ws.onopen?.(new Event("open"));
    wsModule.disconnectSession("s1");
    ws.send.mockClear();

    wsModule.connectSession("s2");

    expect(MockWebSocket.instances).toHaveLength(1);
    const sent = ws.send.mock.calls.map(([raw]) => JSON.parse(raw as string) as { type: string });
    expect(sent[0]).toEqual({ type: "session_switch", session_id: "s2" });
    expect(sent[1]?.type).toBe("session_subscribe");

    // A late message for s1 is ignored; s2's stream starts at its session_init.
    fireMessage({ type: "session_init", session: makeSession("s1") });
    expect(useStore.getState().sessions.get("s2")).toBeUndefined();
    fireMessage({ type: "session_init", session: makeSession("s2") });
    expect(useStore.getState().sessions.get("s2")?.session_id).toBe("s2");
    vi.advanceTimersByTime(10_000);
    expect(ws.close).not.toHaveBeenCalled();
  });
});
