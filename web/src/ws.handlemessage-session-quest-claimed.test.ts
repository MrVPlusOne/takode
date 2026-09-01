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

function installNavigation(name: string, isOrchestrator = false) {
  fireMessage(
    createSessionNavigationProjectionEnvelope({
      overrides: { identity: { name }, topology: { isOrchestrator } },
    }),
  );
  useStore.getState().clearRecentlyRenamed("s1");
}

function publishClaimProjection(options: {
  name: string;
  status: string;
  verificationInboxUnread?: boolean;
  isOrchestrator?: boolean;
}) {
  fireMessage(
    createSessionNavigationProjectionEnvelope({
      type: "synced_projection_update",
      revision: 2,
      overrides: {
        identity: { name: options.name },
        topology: { isOrchestrator: options.isOrchestrator ?? false },
        quest: {
          claimedQuestId: "q-348",
          claimedQuestTitle: "Prevent leader auto-renames",
          claimedQuestStatus: options.status,
          claimedQuestVerificationInboxUnread: options.verificationInboxUnread ?? null,
        },
      },
    }),
  );
}

// ===========================================================================
// Connection
// ===========================================================================
describe("handleMessage: session_quest_claimed", () => {
  it("updates current claim detail without synthesizing feed history", () => {
    // A completed review-owner claim can remain authoritative session metadata,
    // but only a separate durable lifecycle event may create a feed chip.
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });

    fireMessage({
      type: "session_quest_claimed",
      quest: {
        id: "q-2003",
        title: "Diagnose recurring alerts",
        status: "done",
        verificationInboxUnread: true,
      },
    });

    expect(useStore.getState().sessions.get("s1")).toMatchObject({
      claimedQuestId: "q-2003",
      claimedQuestTitle: "Diagnose recurring alerts",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
    expect(useStore.getState().messages.get("s1")).toEqual([]);
  });

  it("keeps detailed claim state while the projection owns the worker row", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Worker Session");
    installNavigation("Worker Session");

    fireMessage({
      type: "session_quest_claimed",
      quest: { id: "q-348", title: "Prevent leader auto-renames", status: "in_progress" },
    });

    let state = useStore.getState();
    expect(state.sessions.get("s1")).toMatchObject({
      claimedQuestId: "q-348",
      claimedQuestStatus: "in_progress",
    });
    expect(state.sdkSessions[0]).toMatchObject({ name: "Worker Session", claimedQuestId: null });

    publishClaimProjection({ name: "Prevent leader auto-renames", status: "in_progress" });
    state = useStore.getState();
    expect(state.sdkSessions[0]).toMatchObject({
      name: "Prevent leader auto-renames",
      claimedQuestId: "q-348",
      claimedQuestStatus: "in_progress",
    });
    expect(state.recentlyRenamed.has("s1")).toBe(true);
  });

  it("keeps review-pending done detail and projected checked-box state aligned", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: makeSession("s1") });
    seedSdkSession("Worker Session");
    installNavigation("Worker Session");

    fireMessage({
      type: "session_quest_claimed",
      quest: { id: "q-348", title: "Prevent leader auto-renames", status: "done", verificationInboxUnread: true },
    });

    let state = useStore.getState();
    expect(state.sessions.get("s1")?.claimedQuestStatus).toBe("done");
    expect(state.sessions.get("s1")?.claimedQuestVerificationInboxUnread).toBe(true);
    expect(state.sdkSessions[0]).toMatchObject({ name: "Worker Session", claimedQuestId: null });

    publishClaimProjection({
      name: "Prevent leader auto-renames",
      status: "done",
      verificationInboxUnread: true,
    });
    state = useStore.getState();
    expect(state.sdkSessions[0]).toMatchObject({
      name: "Prevent leader auto-renames",
      claimedQuestId: "q-348",
      claimedQuestStatus: "done",
      claimedQuestVerificationInboxUnread: true,
    });
  });

  it("updates orchestrator claim fields without renaming or animating the row", () => {
    wsModule.connectSession("s1");
    fireMessage({ type: "session_init", session: { ...makeSession("s1"), isOrchestrator: true } });
    seedSdkSession("Leader 7", true);
    installNavigation("Leader 7", true);

    fireMessage({
      type: "session_quest_claimed",
      quest: { id: "q-348", title: "Prevent leader auto-renames", status: "in_progress" },
    });
    expect(useStore.getState().sdkSessions[0]).toMatchObject({ name: "Leader 7", claimedQuestId: null });

    publishClaimProjection({ name: "Leader 7", status: "in_progress", isOrchestrator: true });
    const state = useStore.getState();
    expect(state.sdkSessions[0]).toMatchObject({
      name: "Leader 7",
      claimedQuestId: "q-348",
      claimedQuestStatus: "in_progress",
    });
    expect(state.recentlyRenamed.has("s1")).toBe(false);
  });
});

describe("handleMessage: settings_updated", () => {
  it("publishes server-authoritative session defaults for every open Settings page", () => {
    // Settings pages are not session-owned store state, so the websocket fan-out uses a window event as the UI bridge.
    const listener = vi.fn();
    window.addEventListener("takode:session-defaults-updated", listener);
    wsModule.connectSession("s1");

    fireMessage({
      type: "settings_updated",
      sessionDefaults: {
        codex: {
          model: "worker-model",
          serviceTier: null,
          reasoningEffort: "",
          internetAccess: false,
          maxContextLength: null,
          effectiveContextWindowPercent: 95,
        },
        claude: { model: "", permissionMode: "", reasoningEffort: "", maxContextLength: null },
        leader: {
          codex: {
            model: "leader-model",
            serviceTier: null,
            reasoningEffort: "",
            internetAccess: false,
            maxContextLength: null,
          },
          claude: { model: "", permissionMode: "", reasoningEffort: "", maxContextLength: null },
        },
        leaderUsesWorkerDefaults: false,
      },
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toMatchObject({
      codex: { model: "worker-model" },
      leader: { codex: { model: "leader-model" } },
      leaderUsesWorkerDefaults: false,
    });
    window.removeEventListener("takode:session-defaults-updated", listener);
  });
});

describe("handleMessage: todo_state_updated", () => {
  it("publishes the server revision so every open To-dos page refetches authoritative state", () => {
    const listener = vi.fn();
    window.addEventListener("takode:todo-state-updated", listener);
    wsModule.connectSession("s1");

    fireMessage({ type: "todo_state_updated", revision: 7, updatedAt: 1_786_608_000_000 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      revision: 7,
      updatedAt: 1_786_608_000_000,
    });
    window.removeEventListener("takode:todo-state-updated", listener);
  });
});
