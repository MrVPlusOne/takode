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
describe("handleMessage: status_change", () => {
  it("sets session status to compacting", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({ type: "status_change", status: "compacting" });

    expect(useStore.getState().sessionStatus.get("s1")).toBe("compacting");
  });

  it("sets session status to arbitrary value", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({ type: "status_change", status: "running" });

    expect(useStore.getState().sessionStatus.get("s1")).toBe("running");
  });

  it("stores active turn route from running status and clears it when idle", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-975", questId: "q-975" },
    });

    expect(useStore.getState().activeTurnRoutes.get("s1")).toEqual({ threadKey: "q-975", questId: "q-975" });

    fireMessage({ type: "status_change", status: "idle" });

    expect(useStore.getState().activeTurnRoutes.get("s1")).toBeNull();
  });

  it("clears the active Codex reasoning preview on any status boundary", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    useStore.getState().setActiveCodexReasoningPreview("s1", {
      text: "Checking routing metadata",
      updatedAt: Date.now(),
      threadKey: "q-975",
      questId: "q-975",
    });

    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "q-976", questId: "q-976" },
    });

    expect(useStore.getState().activeCodexReasoningPreviews.has("s1")).toBe(false);
  });

  it("stores active Codex reasoning preview from running status updates", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({
      type: "status_change",
      status: "running",
      activeTurnRoute: { threadKey: "main" },
      activeCodexReasoningPreview: {
        text: "Summarizing options",
        updatedAt: 123,
        threadKey: "main",
      },
    });

    expect(useStore.getState().activeCodexReasoningPreviews.get("s1")).toMatchObject({
      text: "Summarizing options",
      threadKey: "main",
    });
  });

  it("applies server-authored testing updates and clears omitted legacy terminal projections", () => {
    // Generic local running state is insufficient; only the server projection
    // may switch the auto-pause banner into its testing copy.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({ type: "status_change", status: "running", codexAutoPauseRecoveryTesting: true });
    expect(useStore.getState().sessions.get("s1")?.codex_result_error_auto_pause_recovery_testing).toBe(true);

    fireMessage({ type: "status_change", status: "idle" });
    expect(useStore.getState().sessions.get("s1")?.codex_result_error_auto_pause_recovery_testing).toBe(false);

    fireMessage({ type: "status_change", status: "running", codexAutoPauseRecoveryTesting: true });
    fireMessage({ type: "status_change", status: null });
    expect(useStore.getState().sessions.get("s1")?.codex_result_error_auto_pause_recovery_testing).toBe(false);
  });
});
