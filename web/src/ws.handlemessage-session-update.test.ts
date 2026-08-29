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
const getQuestTitlesMock = vi.hoisted(() => vi.fn().mockResolvedValue({ quests: [], missingQuestIds: [] }));

// Mock the API module so PostHog doesn't break in jsdom
vi.mock("./api.js", () => ({
  api: {
    getDiffStats: getDiffStatsMock,
    listSessions: listSessionsMock,
    getQuestTitles: getQuestTitlesMock,
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
  getQuestTitlesMock.mockReset();
  getQuestTitlesMock.mockResolvedValue({ quests: [], missingQuestIds: [] });
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
describe("handleMessage: session_update", () => {
  it("updates the session in the store", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({ type: "session_update", session: { model: "claude-sonnet-4-20250514" } });

    expect(useStore.getState().sessions.get("s1")!.model).toBe("claude-sonnet-4-20250514");
  });

  it("normalizes legacy live recovery updates after an authoritative progress update", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    fireMessage({
      type: "session_update",
      session: {
        codex_result_error_auto_pause_recovery_testing: true,
        codex_result_error_auto_pause_recovery_progress: "active",
      },
    });
    fireMessage({ type: "session_update", session: { codex_result_error_auto_pause_recovery_testing: false } });
    expect(useStore.getState().sessions.get("s1")?.codex_result_error_auto_pause_recovery_progress).toBeNull();

    fireMessage({ type: "session_update", session: { codex_result_error_auto_pause_recovery_testing: true } });
    expect(useStore.getState().sessions.get("s1")?.codex_result_error_auto_pause_recovery_progress).toBe("testing");
  });

  it("applies leader open-thread tabs carried by board updates", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), isOrchestrator: true } });

    fireMessage({
      type: "board_updated",
      board: [{ questId: "q-9", title: "Active quest", status: "IMPLEMENTING", createdAt: 1, updatedAt: 2 }],
      completedBoard: [],
      leaderOpenThreadTabs: {
        version: 1,
        orderedOpenThreadKeys: ["q-9"],
        closedThreadTombstones: [],
        updatedAt: 2,
      },
    });

    expect(useStore.getState().sessionBoards.get("s1")).toEqual([
      { questId: "q-9", title: "Active quest", status: "IMPLEMENTING", createdAt: 1, updatedAt: 2 },
    ]);
    expect(useStore.getState().sessions.get("s1")!.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-9"]);
  });

  it("force-refreshes only server-open leader quest titles after a global quest update", async () => {
    // Every connected browser receives the quest update; each must refresh its
    // own bounded retained-tab title cache rather than the full quest corpus.
    wsModule.connectSession("s1");
    fireMessage({
      type: "session_init",
      session: {
        ...makeSession("s1"),
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1932", "main", "q-1932"],
          closedThreadTombstones: [],
          updatedAt: 2,
        },
      },
    });

    fireMessage({ type: "quest_list_updated" });

    await vi.waitFor(() => expect(getQuestTitlesMock).toHaveBeenCalledWith(["q-1932"]));
  });

  it("applies an exact quest preview synchronously before bounded refresh completes", () => {
    wsModule.connectSession("s1");
    fireMessage({
      type: "session_init",
      session: {
        ...makeSession("s1"),
        isOrchestrator: true,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1932"],
          closedThreadTombstones: [],
          updatedAt: 2,
        },
      },
    });

    fireMessage({
      type: "quest_list_updated",
      quest: {
        questId: "q-1932",
        title: "Commit evidence is immediately inspectable",
        version: 5,
        updatedAt: 50,
        commitShas: ["abc1234", "def5678"],
      },
    });

    expect(useStore.getState().questTitlePreviews.get("q-1932")).toEqual({
      questId: "q-1932",
      title: "Commit evidence is immediately inspectable",
      version: 5,
      updatedAt: 50,
      commitShas: ["abc1234", "def5678"],
    });
  });

  it("replaces board participant projections across reviewer lifecycle updates", () => {
    // The WebSocket handler must replace the authoritative row status on each
    // coalesced lifecycle projection while retaining the active board worker.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), isOrchestrator: true } });
    const board = [
      {
        questId: "q-1761",
        title: "Restore reviewer chip",
        worker: "worker-1",
        workerNum: 2402,
        status: "CODE_REVIEWING",
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    fireMessage({
      type: "board_updated",
      board,
      completedBoard: [],
      rowSessionStatuses: {
        "q-1761": {
          worker: { sessionId: "worker-1", sessionNum: 2402, status: "idle" },
          reviewer: { sessionId: "reviewer-1", sessionNum: 2403, status: "running" },
        },
      },
    });
    expect(useStore.getState().sessionBoardRowStatuses.get("s1")?.["q-1761"]?.reviewer?.sessionId).toBe("reviewer-1");

    fireMessage({
      type: "board_updated",
      board,
      completedBoard: [],
      rowSessionStatuses: {
        "q-1761": {
          worker: { sessionId: "worker-1", sessionNum: 2402, status: "idle" },
          reviewer: { sessionId: "reviewer-2", sessionNum: 2404, status: "running" },
        },
      },
    });
    expect(useStore.getState().sessionBoardRowStatuses.get("s1")?.["q-1761"]).toMatchObject({
      worker: { sessionId: "worker-1", sessionNum: 2402 },
      reviewer: { sessionId: "reviewer-2", sessionNum: 2404 },
    });

    fireMessage({
      type: "board_updated",
      board,
      completedBoard: [],
      rowSessionStatuses: {
        "q-1761": {
          worker: { sessionId: "worker-1", sessionNum: 2402, status: "idle" },
          reviewer: null,
        },
      },
    });
    expect(useStore.getState().sessionBoardRowStatuses.get("s1")?.["q-1761"]).toMatchObject({
      worker: { sessionId: "worker-1", sessionNum: 2402 },
      reviewer: null,
    });
  });
});
