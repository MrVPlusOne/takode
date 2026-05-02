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
describe("handleMessage: session_created", () => {
  it("refreshes sdk sessions without opening sockets for every listed session", async () => {
    listSessionsMock.mockResolvedValueOnce([
      { sessionId: "s-new-1", cwd: "/tmp/a", createdAt: Date.now(), archived: false },
      { sessionId: "s-new-2", cwd: "/tmp/b", createdAt: Date.now(), archived: false },
    ]);

    wsModule.connectSession("s-origin");
    fireMessage({ type: "session_created", session_id: "s-new-1" });
    // session_created is debounced (1s) to coalesce rapid bursts
    vi.advanceTimersByTime(1000);
    await Promise.resolve();

    expect(listSessionsMock).toHaveBeenCalledTimes(1);
    expect(useStore.getState().sdkSessions.map((s) => s.sessionId)).toEqual(["s-new-1", "s-new-2"]);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0]?.url).toBe("ws://localhost:3456/ws/browser/s-origin");

    const { getFrontendPerfEntries } = await import("./utils/frontend-perf-recorder.js");
    expect(getFrontendPerfEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "session_created_refresh",
          sessionId: "s-origin",
          createdSessionId: "s-new-1",
          sessionCount: 2,
          ok: true,
        }),
      ]),
    );
  });

  it("records tree_groups_update diagnostics for spawn refresh bursts", async () => {
    wsModule.connectSession("s-origin");

    fireMessage({
      type: "tree_groups_update",
      treeGroups: [{ id: "leaders", name: "Leaders" }],
      treeAssignments: { "leader-1": "leaders", "worker-1": "leaders" },
      treeNodeOrder: { leaders: ["leader-1", "worker-1"] },
    });

    const { getFrontendPerfEntries } = await import("./utils/frontend-perf-recorder.js");
    expect(getFrontendPerfEntries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "tree_groups_update_apply",
          sessionId: "s-origin",
          groupCount: 1,
          assignmentCount: 2,
          nodeOrderParentCount: 1,
          nodeOrderChildCount: 2,
        }),
      ]),
    );
  });
});
