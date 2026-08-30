// @vitest-environment jsdom

import "@testing-library/jest-dom";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadTabsProjectionTab } from "../../shared/leader-thread-tabs-projection.js";
import { SAVE_THREAD_VIEWPORT_EVENT, readLeaderSelectedThreadKey } from "../utils/thread-viewport.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";

const mockSendToSession = vi.hoisted(() => vi.fn((_sessionId: string, _message: unknown) => true));
const mockGetQuestTitles = vi.hoisted(() => vi.fn().mockResolvedValue({ quests: [], missingQuestIds: ["q-1"] }));

vi.mock("../ws.js", () => ({
  connectSession: vi.fn(),
  sendToSession: mockSendToSession,
}));
vi.mock("../api.js", () => ({
  api: {
    getQuestTitles: mockGetQuestTitles,
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
    unarchiveSession: vi.fn().mockResolvedValue({ ok: true }),
    acknowledgeModelProvenanceMigration: vi.fn().mockResolvedValue({ ok: true }),
  },
}));
vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: vi.fn() }));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./Composer.js", () => ({
  Composer: ({ threadKey }: { threadKey: string }) => <div data-testid="composer" data-thread-key={threadKey} />,
}));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({
    sessionId,
    threadKey,
    projectThreadRoutes,
  }: {
    sessionId: string;
    threadKey: string;
    projectThreadRoutes?: boolean;
  }) => (
    <div
      data-testid="message-feed"
      data-session-id={sessionId}
      data-thread-key={threadKey}
      data-project-thread-routes={projectThreadRoutes ? "true" : "false"}
    />
  ),
}));
vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    currentThreadKey,
    openThreadKeys,
    threadRows,
    onSelectThread,
  }: {
    currentThreadKey: string;
    openThreadKeys?: string[];
    threadRows?: Array<{ threadKey: string; title: string }>;
    onSelectThread?: (threadKey: string) => void;
  }) => (
    <div
      data-testid="work-board-bar"
      data-current-thread-key={currentThreadKey}
      data-open-thread-keys={(openThreadKeys ?? []).join(",")}
      data-thread-titles={(threadRows ?? []).map((row) => `${row.threadKey}:${row.title}`).join("|")}
      data-has-thread-navigation={onSelectThread ? "true" : "false"}
    />
  ),
}));

import { useStore } from "../store.js";
import { ChatView } from "./ChatView.js";

function projectedTab(title: string, updatedAt: number): LeaderThreadTabsProjectionTab {
  return {
    threadKey: "q-1",
    questId: "q-1",
    title,
    boardStatus: "WORKING",
    journey: {
      mode: "active",
      phaseIds: ["alignment", "work", "memory"],
      currentPhaseId: "work",
      activePhaseIndex: 1,
      phaseCount: 3,
    },
    sourceLeaderSessionId: null,
    sourceRowCreatedAt: null,
    workerSessionId: null,
    workerSessionNum: null,
    active: true,
    queued: false,
    proposed: false,
    completed: false,
    canClose: false,
    attention: { needsInput: true, mutedNeedsInput: false, reviewUnread: false, updatedAt },
    updatedAt,
  };
}

function projectionValue(title: string, updatedAt: number, orderedOpenThreadKeys: string[] = ["q-1", "q-2"]) {
  const q1 = projectedTab(title, updatedAt);
  const q2: LeaderThreadTabsProjectionTab = {
    ...projectedTab("Projected q-2", updatedAt),
    threadKey: "q-2",
    questId: "q-2",
    completed: true,
    active: false,
    boardStatus: "DONE",
    canClose: true,
    attention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
  };
  const tabsByKey = new Map([
    ["q-1", q1],
    ["q-2", q2],
  ]);
  return createLeaderThreadTabsProjectionValue({
    tabState: {
      version: 1,
      orderedOpenThreadKeys,
      closedThreadTombstones: [],
      updatedAt,
    },
    tabs: orderedOpenThreadKeys.map((threadKey) => tabsByKey.get(threadKey)!),
    mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    threadStatuses: {},
    activePhaseSummary: [{ label: "Work", count: 1, tone: "phase" }],
  });
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "#/session/leader?thread=q-1";
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockGetQuestTitles.mockClear();
  useStore.getState().reset();
  useStore.setState({
    connectionStatus: new Map([["leader", "connected"]]),
    sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
    sessions: new Map([
      [
        "leader",
        {
          session_id: "leader",
          model: "test",
          cwd: "/repo",
          permissionMode: "default",
          backend_state: "connected",
          backend_error: null,
          isOrchestrator: true,
          leaderOpenThreadTabs: {
            version: 1,
            orderedOpenThreadKeys: ["q-stale"],
            closedThreadTombstones: [],
            updatedAt: 1,
          },
        } as never,
      ],
    ]),
    sessionBoards: new Map([
      [
        "leader",
        [
          {
            questId: "q-1",
            title: "Matching board title",
            status: "WORKING",
            createdAt: 10,
            updatedAt: 10,
            waitForInput: ["n-1"],
          },
        ],
      ],
    ]),
    sessionNotifications: new Map([
      [
        "leader",
        [
          {
            id: "n-1",
            category: "needs-input",
            summary: "Confirm q-1",
            timestamp: 10,
            messageId: null,
            threadKey: "q-1",
            questId: "q-1",
            done: false,
          },
        ],
      ],
    ]),
    messages: new Map([
      ["leader", [{ id: "main-message", role: "assistant", content: "Main remains selected", timestamp: 1 }]],
    ]),
  });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      value: projectionValue("Projected q-1", 10),
    }),
  );
});

describe("ChatView leader thread tabs projection", () => {
  it("does not feed authoritative projection refreshes back into tab commands or navigation", async () => {
    const viewportSnapshots: string[] = [];
    const onViewportSnapshot = (event: Event) => {
      viewportSnapshots.push((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId ?? "");
    };
    window.addEventListener(SAVE_THREAD_VIEWPORT_EVENT, onViewportSnapshot);

    const view = render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-1" />);
    try {
      await waitFor(() =>
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1,q-2"),
      );
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1");
      expect(window.location.hash).toBe("#/session/leader?thread=q-1");
      const selectedThreadBeforeRefresh = readLeaderSelectedThreadKey("leader");
      expect(selectedThreadBeforeRefresh).toBe("q-1");

      mockSendToSession.mockClear();
      viewportSnapshots.length = 0;
      act(() => {
        useStore.getState().applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({
            type: "synced_projection_update",
            key: "leader",
            revision: 2,
            value: projectionValue("Refreshed projected q-1", 20, ["q-2", "q-1"]),
          }),
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-2,q-1");
        expect(screen.getByTestId("work-board-bar")).toHaveAttribute(
          "data-thread-titles",
          expect.stringContaining("q-1:Refreshed projected q-1"),
        );
      });

      act(() => {
        useStore.getState().applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({
            type: "synced_projection_update",
            key: "leader",
            revision: 3,
            value: projectionValue("Refreshed projected q-1", 30, ["q-1"]),
          }),
        );
      });
      await waitFor(() => expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1"));

      const sentMessages = mockSendToSession.mock.calls as unknown as Array<[string, { type?: string }]>;
      expect(sentMessages.filter(([, message]) => message.type === "leader_thread_tabs_update")).toEqual([]);
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1");
      expect(screen.getByTestId("composer")).toHaveAttribute("data-thread-key", "q-1");
      expect(window.location.hash).toBe("#/session/leader?thread=q-1");
      expect(readLeaderSelectedThreadKey("leader")).toBe(selectedThreadBeforeRefresh);
      expect(viewportSnapshots).toEqual([]);
    } finally {
      window.removeEventListener(SAVE_THREAD_VIEWPORT_EVENT, onViewportSnapshot);
      view.unmount();
    }
  });

  it("reopens a dismissed scheduled tab through an explicit board-backed route", async () => {
    // Projection-first cold loads must retain the board row as an explicit navigation target.
    useStore.getState().reset();
    window.location.hash = "#/session/leader?thread=q-3";
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      connectionStatus: new Map([["leader", "connected"]]),
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            backend_state: "connected",
            backend_error: null,
            isOrchestrator: true,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-1"],
              closedThreadTombstones: [{ threadKey: "q-3", closedAt: 30 }],
              updatedAt: 30,
            },
          } as never,
        ],
      ]),
      sessionBoards: new Map([
        [
          "leader",
          [
            { questId: "q-1", title: "Active work", status: "WORKING", createdAt: 1, updatedAt: 10 },
            { questId: "q-3", title: "Queued follow-up", status: "QUEUED", createdAt: 2, updatedAt: 20 },
          ],
        ],
      ]),
      messages: new Map([
        ["leader", [{ id: "main-message", role: "assistant", content: "Main remains selected", timestamp: 1 }]],
      ]),
    });
    const activeTab = projectedTab("Active work", 10);
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader",
        value: createLeaderThreadTabsProjectionValue({
          tabState: {
            version: 1,
            orderedOpenThreadKeys: ["q-1"],
            closedThreadTombstones: [{ threadKey: "q-3", closedAt: 30 }],
            updatedAt: 30,
          },
          tabs: [activeTab],
          mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          threadStatuses: {},
          activePhaseSummary: [{ label: "Work", count: 1, tone: "phase" }],
        }),
      }),
    );
    mockSendToSession.mockClear();

    render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-3" />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-3"));
    expect(mockSendToSession).toHaveBeenCalledWith("leader", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-3",
        placement: "first",
        source: "route",
      },
    });
    expect(window.location.hash).toBe("#/session/leader?thread=q-3");
  });

  it("prioritizes active tabs before migrating a restored scheduled-first order", async () => {
    // First-upgrade migration applies the narrow server precedence rule instead of persisting stale local order.
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", '["q-2","q-1"]');
    window.location.hash = "#/session/leader";
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      connectionStatus: new Map([["leader", "connected"]]),
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
          } as never,
        ],
      ]),
      sessionBoards: new Map([
        [
          "leader",
          [
            { questId: "q-1", title: "Active", status: "WORKING", createdAt: 1, updatedAt: 1 },
            { questId: "q-2", title: "Queued", status: "QUEUED", createdAt: 2, updatedAt: 2 },
          ],
        ],
      ]),
      messages: new Map([
        ["leader", [{ id: "main-message", role: "assistant", content: "Main remains selected", timestamp: 1 }]],
      ]),
    });
    const active = projectedTab("Active", 10);
    const queued: LeaderThreadTabsProjectionTab = {
      ...projectedTab("Queued", 20),
      threadKey: "q-2",
      questId: "q-2",
      boardStatus: "QUEUED",
      active: false,
      queued: true,
      neverStartedScheduled: true,
      canClose: true,
    };
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader",
        value: createLeaderThreadTabsProjectionValue({
          tabState: null,
          tabs: [active, queued],
          mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
          threadStatuses: {},
          activePhaseSummary: [{ label: "Work", count: 1, tone: "phase" }],
        }),
      }),
    );
    mockSendToSession.mockClear();

    render(<ChatView sessionId="leader" />);

    await waitFor(() =>
      expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1,q-2"),
    );
    expect(mockSendToSession).toHaveBeenCalledWith("leader", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "migrate",
        orderedOpenThreadKeys: ["q-1", "q-2"],
        migratedAt: expect.any(Number),
      },
    });
  });

  it("migrates local tabs when an accepted projection has derived tabs but no durable tab state", async () => {
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", '["q-local","q-1"]');
    window.location.hash = "#/session/leader";
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      connectionStatus: new Map([["leader", "connected"]]),
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-stale"],
              closedThreadTombstones: [],
              updatedAt: 1,
            },
          } as never,
        ],
      ]),
      messages: new Map([
        [
          "leader",
          [
            {
              id: "local-thread",
              role: "assistant",
              content: "Local retained thread",
              timestamp: 1,
              metadata: { threadRefs: [{ threadKey: "q-local", questId: "q-local", source: "explicit" }] },
            },
          ],
        ],
      ]),
      quests: [{ questId: "q-local", title: "Locally retained tab", status: "in_progress" } as never],
    });
    const value = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [projectedTab("Server-derived tab", 20)],
      threadStatuses: {},
      activePhaseSummary: [],
    });
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "leader", value }));
    mockSendToSession.mockClear();

    render(<ChatView sessionId="leader" />);

    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-local,q-1");
    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith("leader", {
        type: "leader_thread_tabs_update",
        operation: {
          type: "migrate",
          orderedOpenThreadKeys: ["q-local", "q-1"],
          migratedAt: expect.any(Number),
        },
      }),
    );
  });

  it("waits for connected legacy board authority and retries migration after a failed send", async () => {
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", '["q-2","q-1"]');
    window.location.hash = "#/session/leader";
    let migrationAttempts = 0;
    mockSendToSession.mockImplementation((_sessionId, message) => {
      const operation = (message as { operation?: { type?: string } }).operation;
      if (operation?.type !== "migrate") return true;
      migrationAttempts += 1;
      return migrationAttempts > 1;
    });
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
          } as never,
        ],
      ]),
      messages: new Map([
        ["leader", [{ id: "main-message", role: "assistant", content: "Main remains selected", timestamp: 1 }]],
      ]),
    });

    render(<ChatView sessionId="leader" />);

    const migrationCalls = () =>
      mockSendToSession.mock.calls.filter(
        ([, message]) => (message as { operation?: { type?: string } }).operation?.type === "migrate",
      );
    expect(migrationCalls()).toHaveLength(0);

    act(() => useStore.getState().setConnectionStatus("leader", "connected"));
    expect(migrationCalls()).toHaveLength(0);

    const board = [
      { questId: "q-1", title: "Active", status: "WORKING", createdAt: 1, updatedAt: 1 },
      { questId: "q-2", title: "Queued", status: "QUEUED", createdAt: 2, updatedAt: 2 },
    ];
    act(() => useStore.getState().setSessionBoard("leader", board));
    await waitFor(() => expect(migrationCalls()).toHaveLength(1));
    expect(migrationCalls()[0]).toEqual([
      "leader",
      {
        type: "leader_thread_tabs_update",
        operation: {
          type: "migrate",
          orderedOpenThreadKeys: ["q-1", "q-2"],
          migratedAt: expect.any(Number),
        },
      },
    ]);

    act(() =>
      useStore.getState().setSessionBoard(
        "leader",
        board.map((row) => ({ ...row })),
      ),
    );
    await waitFor(() => expect(migrationCalls()).toHaveLength(2));
    act(() =>
      useStore.getState().setSessionBoard(
        "leader",
        board.map((row) => ({ ...row })),
      ),
    );
    await act(async () => Promise.resolve());
    expect(migrationCalls()).toHaveLength(2);
  });

  it("migrates valid legacy localStorage only once after connected board state is known", async () => {
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", '["q-941","q-777"]');
    window.location.hash = "#/session/leader";
    useStore.setState({
      connectionStatus: new Map([["leader", "connected"]]),
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
          } as never,
        ],
      ]),
      sessionBoards: new Map([["leader", []]]),
      messages: new Map([
        [
          "leader",
          [
            { id: "q-941", role: "assistant", content: "Migrated thread", timestamp: 2 },
            { id: "q-777", role: "assistant", content: "Second migrated thread", timestamp: 3 },
          ],
        ],
      ]),
      quests: [
        { questId: "q-941", title: "Migrated thread", status: "in_progress" } as never,
        { questId: "q-777", title: "Second migrated thread", status: "in_progress" } as never,
      ],
    });

    const view = render(<ChatView sessionId="leader" />);

    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941,q-777");
    await waitFor(() =>
      expect(mockSendToSession).toHaveBeenCalledWith("leader", {
        type: "leader_thread_tabs_update",
        operation: {
          type: "migrate",
          orderedOpenThreadKeys: ["q-941", "q-777"],
          migratedAt: expect.any(Number),
        },
      }),
    );

    view.rerender(<ChatView sessionId="leader" />);
    expect(
      mockSendToSession.mock.calls.filter(
        ([, message]) => (message as { operation?: { type?: string } }).operation?.type === "migrate",
      ),
    ).toHaveLength(1);
  });

  it("ignores corrupt legacy localStorage when authoritative server tab state exists", async () => {
    useStore.getState().reset();
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:leader", "{not-json");
    window.location.hash = "#/session/leader";
    useStore.setState({
      connectionStatus: new Map([["leader", "connected"]]),
      sdkSessions: [{ sessionId: "leader", archived: false, isOrchestrator: true } as never],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: true,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-server"],
              closedThreadTombstones: [],
              updatedAt: 1,
            },
          } as never,
        ],
      ]),
      sessionBoards: new Map([["leader", []]]),
      messages: new Map([["leader", [{ id: "q-server", role: "assistant", content: "Server tab", timestamp: 2 }]]]),
      quests: [{ questId: "q-server", title: "Server tab", status: "in_progress" } as never],
    });

    render(<ChatView sessionId="leader" />);

    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-server");
    await waitFor(() => expect(localStorage.getItem("test-server:cc-leader-open-thread-tabs:leader")).toBeNull());
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      "leader",
      expect.objectContaining({ operation: expect.objectContaining({ type: "migrate" }) }),
    );
  });

  it("replaces a historical completed banner with projected current Work without feeding it back", async () => {
    useStore.getState().reset();
    window.location.hash = "#/session/leader?thread=q-1974";
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: true,
          sessionNum: 2489,
        } as never,
        {
          sessionId: "leader-current",
          archived: false,
          isOrchestrator: true,
          sessionNum: 2220,
        } as never,
        {
          sessionId: "worker-historical",
          archived: false,
          sessionNum: 2569,
        } as never,
        {
          sessionId: "worker-current",
          archived: false,
          sessionNum: 2580,
        } as never,
        {
          sessionId: "reviewer-historical",
          archived: false,
          sessionNum: 2570,
        } as never,
      ],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            backend_state: "connected",
            backend_error: null,
            isOrchestrator: true,
          } as never,
        ],
      ]),
      sessionCompletedBoards: new Map([
        [
          "leader",
          [
            {
              questId: "q-1974",
              title: "Implement non-blocking chat link previews",
              worker: "worker-historical",
              workerNum: 2569,
              status: "WORKING",
              journey: {
                mode: "active",
                phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
                currentPhaseId: "work",
                activePhaseIndex: 3,
              },
              createdAt: 10,
              updatedAt: 20,
              completedAt: 30,
            },
          ],
        ],
      ]),
      sessionBoardRowStatuses: new Map([
        [
          "leader",
          {
            "q-1974": {
              worker: {
                sessionId: "worker-historical",
                sessionNum: 2569,
                status: "idle",
              },
              reviewer: {
                sessionId: "reviewer-historical",
                sessionNum: 2570,
                status: "idle",
              },
            },
          },
        ],
      ]),
      quests: [
        {
          id: "q-1974",
          questId: "q-1974",
          version: 16,
          title: "Implement non-blocking chat link previews",
          status: "in_progress",
          description: "",
          tags: [],
          createdAt: 1,
          updatedAt: 200,
          statusChangedAt: 200,
          sessionId: "worker-current",
          claimedAt: 200,
          leaderSessionId: "leader-current",
          commitShas: [],
        } as never,
      ],
      messages: new Map([["leader", []]]),
    });

    const projectedCurrentTab: LeaderThreadTabsProjectionTab = {
      threadKey: "q-1974",
      questId: "q-1974",
      title: "Implement non-blocking chat link previews",
      boardStatus: "WORKING",
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
        activePhaseIndex: 1,
        phaseCount: 3,
      },
      sourceLeaderSessionId: "leader-current",
      sourceRowCreatedAt: 200,
      workerSessionId: "worker-current",
      workerSessionNum: 2580,
      active: true,
      queued: false,
      proposed: false,
      completed: false,
      canClose: false,
      attention: {
        needsInput: false,
        mutedNeedsInput: false,
        reviewUnread: false,
        updatedAt: 0,
      },
      updatedAt: 200,
    };
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader",
        value: createLeaderThreadTabsProjectionValue({
          tabState: {
            version: 1,
            orderedOpenThreadKeys: ["q-1974"],
            closedThreadTombstones: [],
            updatedAt: 200,
          },
          tabs: [projectedCurrentTab],
          mainAttention: {
            needsInput: false,
            mutedNeedsInput: false,
            reviewUnread: false,
            updatedAt: 0,
          },
          threadStatuses: {},
          activePhaseSummary: [],
        }),
      }),
    );
    mockSendToSession.mockClear();

    render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-1974" />);

    const banner = await screen.findByTestId("quest-thread-banner");
    const journey = within(banner).getByTestId("quest-journey-compact-summary");
    expect(journey).toHaveTextContent("Work");
    expect(journey).toHaveTextContent("2/3");
    expect(journey).not.toHaveTextContent("Completed");
    expect(within(banner).getByLabelText("Worker #2580")).toBeTruthy();
    expect(within(banner).queryByLabelText("Worker #2569")).toBeNull();
    expect(within(banner).queryByLabelText("Reviewer #2570")).toBeNull();
    expect(window.location.hash).toBe("#/session/leader?thread=q-1974");
    expect(
      (mockSendToSession.mock.calls as unknown as Array<[string, { type?: string }]>).filter(
        ([, message]) => message.type === "leader_thread_tabs_update",
      ),
    ).toEqual([]);
  });

  it("does not treat a malformed supplied projection as leader-role authority", () => {
    useStore.getState().reset();
    window.location.hash = "#/session/leader?thread=q-stale";
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader",
          archived: false,
          isOrchestrator: false,
          leaderThreadTabsProjection: { malformed: true },
        } as never,
      ],
      sessions: new Map([
        [
          "leader",
          {
            session_id: "leader",
            model: "test",
            cwd: "/repo",
            permissionMode: "default",
            isOrchestrator: false,
            leaderOpenThreadTabs: {
              version: 1,
              orderedOpenThreadKeys: ["q-stale"],
              closedThreadTombstones: [],
              updatedAt: 1,
            },
          } as never,
        ],
      ]),
      messages: new Map([["leader", [{ id: "main", role: "assistant", content: "Main", timestamp: 1 }]]]),
    });

    render(<ChatView sessionId="leader" hasThreadRoute routeThreadKey="q-stale" />);

    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-project-thread-routes", "false");
    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "");
    expect(screen.getByTestId("work-board-bar")).toHaveAttribute("data-has-thread-navigation", "false");
  });
});
