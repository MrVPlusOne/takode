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
let buildSidebarVisibleSessions: typeof import("./utils/sidebar-visible-sessions.js").buildSidebarVisibleSessions;

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
  ({ buildSidebarVisibleSessions } = await import("./utils/sidebar-visible-sessions.js"));
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

function seedSdkSession(name: string, isOrchestrator = false) {
  useStore.getState().setSdkSessions([
    {
      sessionId: "s1",
      state: "connected",
      cwd: "/home/user",
      createdAt: 1,
      name,
      isOrchestrator,
    },
  ]);
}

// ===========================================================================
// Connection
// ===========================================================================
describe("handleMessage: session_init", () => {
  it("adds session to store without inventing a browser-side name or setting CLI connected", () => {
    // session_init is just a state snapshot — CLI connection status comes from
    // explicit backend_connected/backend_disconnected messages, not from session_init.
    wsModule.connectSession("s1");
    const session = makeSession("s1");

    fireMessage({ type: "session_init", session });

    const state = useStore.getState();
    expect(state.sessions.has("s1")).toBe(true);
    expect(state.sessions.get("s1")!.model).toBe("claude-opus-4-20250514");
    expect(state.cliConnected.get("s1")).toBeUndefined();
    expect(state.sessionStatus.get("s1")).toBe("idle");
    expect(state.sdkSessions).toEqual([]);
  });

  it("does not overwrite an existing canonical session name", () => {
    seedSdkSession("Custom Name");

    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    expect(useStore.getState().sdkSessions[0]?.name).toBe("Custom Name");
  });

  it("does not overwrite an orchestrator SDK-row name from claimedQuestTitle", () => {
    seedSdkSession("Leader 7", true);

    wsModule.connectSession("s1");
    fireMessage({
      type: "session_init",
      session: {
        ...makeSession("s1"),
        isOrchestrator: true,
        claimedQuestId: "q-348",
        claimedQuestTitle: "Prevent leader auto-renames",
        claimedQuestStatus: "in_progress",
      },
    });

    const state = useStore.getState();
    expect(state.sdkSessions[0]?.name).toBe("Leader 7");
  });

  it("keeps direct Side Chat child WebSocket snapshots out of sidebar projection", () => {
    wsModule.connectSession("root");
    fireMessage({
      type: "session_init",
      session: {
        ...makeSession("root"),
        slackThreads: {
          "st-1": {
            id: "st-1",
            rootSessionId: "root",
            childSessionId: "hidden-child",
            anchorMessageId: "assistant-1",
            anchorHistoryIndex: 1,
            anchorPreview: "Root reply",
            createdAt: 100,
            updatedAt: 100,
            messageCount: 0,
            seeded: false,
          },
        },
      },
    });
    useStore.getState().setSdkSessions([
      {
        sessionId: "root",
        state: "connected",
        cwd: "/home/user",
        createdAt: 2,
        archived: false,
        treeGroupId: "default",
      },
    ]);

    wsModule.connectSession("hidden-child");
    fireMessage({
      type: "session_init",
      session: {
        ...makeSession("hidden-child"),
        treeGroupId: undefined,
      },
    });

    const state = useStore.getState();
    const sidebar = buildSidebarVisibleSessions({
      sdkSessions: state.sdkSessions,
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map(),
      collapsedTreeGroups: new Set(),
      expandedHerdNodes: new Set(),
      sessionAttention: state.sessionAttention,
      sessionSortMode: "created",
    });

    expect(state.sessions.has("hidden-child")).toBe(true);
    expect(sidebar.activeSessions.map((session) => session.id)).toEqual(["root"]);
    expect(sidebar.treeViewGroups.flatMap((group) => group.nodes.map((node) => node.leader.id))).toEqual(["root"]);
  });
});
