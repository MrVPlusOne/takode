// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "./types.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "./test-fixtures/leader-thread-tabs-projection.js";
import { getSyncedProjectionValue } from "./store-synced-projections.js";
import { persistLeaderSelectedThreadKey } from "./utils/thread-viewport.js";

const apiMocks = vi.hoisted(() => ({
  getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));
vi.mock("./utils/names.js", () => ({ generateUniqueSessionName: vi.fn(() => "Test Session") }));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;

function open(socket: MockWebSocket): void {
  socket.onopen?.(new Event("open"));
}

function messages(socket: MockWebSocket): Array<Record<string, any>> {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string) as Record<string, any>);
}

function receive(socket: MockWebSocket, data: Record<string, unknown>): void {
  socket.onmessage?.({ data: JSON.stringify(data) });
}

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: id,
    model: "claude-opus-4-20250514",
    cwd: "/repo",
    tools: [],
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
    repo_root: "/repo",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...overrides,
  };
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "";
  MockWebSocket.instances = [];

  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  wsModule = await import("./ws.js");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("leader thread tabs projection WebSocket carrier", () => {
  it("subscribes only active leaders with identity-only projection requests", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "leader", archived: false, isOrchestrator: true } as never,
        { sessionId: "worker", archived: false, isOrchestrator: false } as never,
        { sessionId: "archived-leader", archived: true, isOrchestrator: true } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader", revision: 4 }));

    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    const subscribe = messages(carrier)[0]!;
    const subscriptions = subscribe.synced_projection_subscriptions as Array<{
      projection: string;
      key: string;
    }>;
    expect(subscriptions).toContainEqual({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "leader",
    });
    expect(subscriptions).not.toContainEqual(
      expect.objectContaining({ projection: LEADER_THREAD_TABS_PROJECTION, key: "carrier" }),
    );
    expect(subscriptions).not.toContainEqual(
      expect.objectContaining({ projection: LEADER_THREAD_TABS_PROJECTION, key: "worker" }),
    );
    expect(subscriptions).not.toContainEqual(
      expect.objectContaining({ projection: LEADER_THREAD_TABS_PROJECTION, key: "archived-leader" }),
    );
    expect(subscriptions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projection: SESSION_ATTENTION_PROJECTION, key: "worker" }),
        expect.objectContaining({ projection: SESSION_NAVIGATION_PROJECTION, key: "worker" }),
      ]),
    );
  });

  it("adds a newly hydrated leader projection subscription once without duplicating refreshes", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "candidate", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    carrier.send.mockClear();

    useStore.setState({
      sessions: new Map([["candidate", { isOrchestrator: true } as never]]),
    });
    expect(wsModule.refreshSyncedProjectionSubscriptions("carrier")).toBe(true);
    expect(messages(carrier)).toHaveLength(1);
    expect(messages(carrier)[0]?.subscriptions).toContainEqual({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "candidate",
    });

    expect(wsModule.refreshSyncedProjectionSubscriptions("carrier")).toBe(true);
    expect(carrier.send).toHaveBeenCalledTimes(1);
  });

  it("uses projected tab availability for the initial selected thread instead of stale legacy state", () => {
    window.location.hash = "#/session/leader";
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: true,
        } as never,
      ],
      sessions: new Map([
        [
          "leader",
          {
            isOrchestrator: true,
          } as never,
        ],
      ]),
    });
    useStore.getState().setCurrentSession("leader");
    useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader" }));
    persistLeaderSelectedThreadKey("leader", "q-2");

    wsModule.connectSession("leader");
    const socket = MockWebSocket.instances.at(-1)!;
    open(socket);

    expect(messages(socket)[0]).toMatchObject({
      type: "session_subscribe",
      initial_thread_window: { thread_key: "q-2" },
    });
  });

  it("treats an explicit projected clear as Main even when stale local and legacy tabs remain", () => {
    window.location.hash = "#/session/leader";
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: true,
        } as never,
      ],
    });
    useStore.getState().setCurrentSession("leader");
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader",
        value: createLeaderThreadTabsProjectionValue({
          tabState: {
            version: 1,
            orderedOpenThreadKeys: [],
            closedThreadTombstones: [],
            updatedAt: 10,
          },
          tabs: [],
          mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          threadStatuses: {},
          activePhaseSummary: [],
        }),
      }),
    );
    persistLeaderSelectedThreadKey("leader", "q-stale");

    wsModule.connectSession("leader");
    const socket = MockWebSocket.instances.at(-1)!;
    open(socket);

    expect(messages(socket)[0]).toMatchObject({
      type: "session_subscribe",
      initial_thread_window: { thread_key: "main" },
    });
  });

  it.each([
    "accepted",
    "unavailable",
  ] as const)("keeps detailed browser updates independent under %s projection authority", (authority) => {
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: true,
          ...(authority === "unavailable" ? { leaderThreadTabsProjection: { malformed: true } as never } : {}),
        } as never,
      ],
    });
    useStore.getState().setCurrentSession("leader");
    wsModule.connectSession("leader");
    const socket = MockWebSocket.instances.at(-1)!;
    open(socket);

    if (authority === "accepted") {
      const subscriptions = messages(socket)[0]?.synced_projection_subscriptions as Array<{
        projection: string;
        key: string;
      }>;
      receive(socket, createLeaderThreadTabsProjectionEnvelope({ key: "leader" }));
      receive(socket, {
        type: "synced_projection_subscriptions_ack",
        complete: true,
        subscriptions,
      });
    }

    receive(socket, {
      type: "session_init",
      session: makeSession("leader", { isOrchestrator: true }),
    });
    receive(socket, { type: "session_update", session: { model: "updated-model" } });
    receive(socket, {
      type: "board_updated",
      board: [{ questId: "q-board", title: "Board detail", status: "WORKING", createdAt: 1, updatedAt: 2 }],
      completedBoard: [],
    });
    receive(socket, {
      type: "session_activity_update",
      session_id: "leader",
      session: {
        leaderActiveBoardRows: [
          { questId: "q-activity", title: "Activity detail", status: "WORKING", createdAt: 3, updatedAt: 4 },
        ],
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 2,
        notificationStatusUpdatedAt: 2_000,
      },
    });
    receive(socket, {
      type: "state_snapshot",
      sessionStatus: "idle",
      permissionMode: "default",
      backendConnected: true,
      uiMode: null,
      askPermission: true,
      board: [{ questId: "q-snapshot", title: "Snapshot detail", status: "WORKING", createdAt: 5, updatedAt: 6 }],
      notifications: [
        {
          id: "notification-1",
          category: "review",
          summary: "Review ready",
          timestamp: 3_000,
          messageId: null,
          done: false,
        },
      ],
      notificationUrgency: "review",
      activeNotificationCount: 1,
      activeNeedsInputNotificationCount: 0,
      activeReviewNotificationCount: 1,
      mutedNeedsInputNotificationCount: 0,
      notificationStatusVersion: 3,
      notificationStatusUpdatedAt: 3_000,
    });

    expect(useStore.getState().sessions.get("leader")?.model).toBe("updated-model");
    expect(useStore.getState().sessionBoards.get("leader")?.[0]?.questId).toBe("q-snapshot");
    expect(useStore.getState().sessionNotifications.get("leader")?.[0]?.id).toBe("notification-1");
    expect(useStore.getState().sdkSessions[0]?.activeNotificationCount).toBe(1);
    const projection = getSyncedProjectionValue(useStore.getState(), LEADER_THREAD_TABS_PROJECTION, "leader");
    expect(projection?.tabs.map((tab) => tab.threadKey) ?? []).toEqual(authority === "accepted" ? ["q-1", "q-2"] : []);
  });
});
