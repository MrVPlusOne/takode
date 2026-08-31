// @vitest-environment jsdom

import type { SessionState, PermissionRequest, ContentBlock, BrowserIncomingMessage } from "./types.js";
import { computeHistoryMessagesSyncHash } from "../shared/history-sync-hash.js";
import { HISTORY_WINDOW_SECTION_TURN_COUNT, HISTORY_WINDOW_VISIBLE_SECTION_COUNT } from "../shared/history-window.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";

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

function seedSdkSession(name?: string, isOrchestrator = false) {
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
describe("handleMessage: projection-owned session names", () => {
  function installNavigation(name: string | null) {
    fireMessage(
      createSessionNavigationProjectionEnvelope({
        overrides: { identity: { name } },
      }),
    );
    useStore.getState().clearRecentlyRenamed("s1");
  }

  function updateNavigation(name: string, revision = 2, quest: Record<string, unknown> = {}) {
    fireMessage(
      createSessionNavigationProjectionEnvelope({
        type: "synced_projection_update",
        revision,
        overrides: { identity: { name }, quest },
      }),
    );
  }

  it("updates session name only from the canonical projection", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Swift Falcon");
    installNavigation("Swift Falcon");

    updateNavigation("Fix Authentication Bug");
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Fix Authentication Bug");
  });

  it("marks session as recently renamed from the same live projection publication", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Calm River");
    installNavigation("Calm River");

    const observed: Array<{ name?: string; renamed: boolean }> = [];
    const unsubscribe = useStore.subscribe((state) => {
      observed.push({
        name: state.sdkSessions[0]?.name,
        renamed: state.recentlyRenamed.has("s1"),
      });
    });
    updateNavigation("Deploy Dashboard");
    unsubscribe();

    expect(observed).toEqual([{ name: "Deploy Dashboard", renamed: true }]);
  });

  it("keeps direct detail names from overriding the server-authoritative projection", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("My Custom Project");
    installNavigation("My Custom Project");

    fireMessage({ type: "session_update", session: { name: "Detail-only name" } });
    expect(useStore.getState().sdkSessions[0]?.name).toBe("My Custom Project");

    updateNavigation("Auto Generated Title");
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Auto Generated Title");
  });

  it("does not mark as recently renamed when the projected name is the same", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Same Name");
    installNavigation("Same Name");

    updateNavigation("Same Name");
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(false);
  });

  it("updates a previously unnamed row from a live projection", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession();
    installNavigation(null);

    updateNavigation("Brand New Title");
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Brand New Title");
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(true);
  });

  it("accepts projected names regardless of their naming pattern", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Bright Falcon");
    installNavigation("Bright Falcon");

    updateNavigation("Auto Title");
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Auto Title");

    useStore.getState().clearRecentlyRenamed("s1");
    updateNavigation("Another Auto Title", 3);
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Another Auto Title");
  });

  it("keeps canonical quest metadata on same-title detail updates", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Worker Session");
    installNavigation("Worker Session");

    fireMessage({
      type: "session_quest_claimed",
      quest: { id: "q-348", title: "Fix Authentication Bug", status: "done", verificationInboxUnread: true },
    });
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Worker Session");

    updateNavigation("Fix Authentication Bug", 2, {
      claimedQuestId: "q-348",
      claimedQuestTitle: "Fix Authentication Bug",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
    useStore.getState().clearRecentlyRenamed("s1");
    fireMessage({ type: "session_update", session: { name: "Fix Authentication Bug" } });

    const state = useStore.getState();
    expect(state.sdkSessions[0]).toMatchObject({
      name: "Fix Authentication Bug",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
    expect(state.recentlyRenamed.has("s1")).toBe(false);
  });
});
