// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useSyncExternalStore, type ReactNode } from "react";
import type { LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import { persistLeaderSelectedThreadKey, readLeaderSelectedThreadKey } from "../utils/thread-viewport.js";
import { parseHash, threadRouteFromHash } from "../utils/routing.js";
import type { LeaderWorkboardView } from "../store-types.js";

interface MockStoreState {
  currentSessionId: string | null;
  sidebarOpen: boolean;
  setSidebarOpen: ReturnType<typeof vi.fn>;
  setSessionInfoOpenSessionId: ReturnType<typeof vi.fn>;
  activeTab: "chat" | "diff";
  setActiveTab: ReturnType<typeof vi.fn>;
  changedFiles: Map<string, Set<string>>;
  diffFileStats: Map<string, Map<string, { additions: number; deletions: number }>>;
  pendingPermissions: Map<string, Map<string, { tool_name?: string; request_id?: string }>>;
  connectionStatus: Map<string, "connecting" | "connected" | "disconnected">;
  sessions: Map<
    string,
    {
      backend_state?: "initializing" | "resuming" | "recovering" | "connected" | "disconnected" | "broken";
      backend_error?: string | null;
      isOrchestrator?: boolean;
      leaderOpenThreadTabs?: LeaderOpenThreadTabsState;
    }
  >;
  cliConnected: Map<string, boolean>;
  cliEverConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  sdkSessions: Array<{
    sessionId: string;
    name?: string;
    archived?: boolean;
    isOrchestrator?: boolean;
    leaderOpenThreadTabs?: LeaderOpenThreadTabsState;
  }>;
  sessionNotifications: Map<string, import("../types.js").SessionNotification[]>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionAttentionRecords: Map<string, import("../types.js").SessionAttentionRecord[]>;
  sessionBoards: Map<string, unknown[]>;
  sessionCompletedBoards: Map<string, unknown[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  leaderProjections: Map<string, import("../types.js").LeaderProjectionSnapshot>;
  messages: Map<string, unknown[]>;
  historyLoading: Map<string, boolean>;
  quests: Array<Record<string, unknown> & { questId: string; title: string; status: string }>;
  sessionNames: Map<string, string>;
  questNamedSessions: Set<string>;
  refreshQuests: ReturnType<typeof vi.fn>;
  leaderWorkboardViews: Map<string, LeaderWorkboardView>;
  setLeaderWorkboardView: ReturnType<typeof vi.fn>;
  shortcutSettings: {
    enabled: boolean;
    preset: "standard" | "vscode-light" | "vim-light";
    overrides: Record<string, string | null>;
  };
  zoomLevel: number;
}

let mockState: MockStoreState;
const mockSendToSession = vi.fn((_sessionId: string, _msg: unknown) => true);
const mockMessageFeedRenders = vi.fn();

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    currentSessionId: "s1",
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    setSessionInfoOpenSessionId: vi.fn(),
    activeTab: "chat",
    setActiveTab: vi.fn(),
    changedFiles: new Map(),
    diffFileStats: new Map(),
    pendingPermissions: new Map(),
    connectionStatus: new Map([["s1", "connected"]]),
    sessions: new Map([["s1", { backend_state: "connected", backend_error: null, isOrchestrator: true }]]),
    cliConnected: new Map([["s1", true]]),
    cliEverConnected: new Map([["s1", true]]),
    cliDisconnectReason: new Map([["s1", null]]),
    sessionStatus: new Map([["s1", "idle"]]),
    sdkSessions: [{ sessionId: "s1", archived: false, isOrchestrator: true }],
    sessionNotifications: new Map(),
    sessionAttention: new Map(),
    sessionAttentionRecords: new Map(),
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    leaderProjections: new Map(),
    messages: new Map(),
    historyLoading: new Map(),
    quests: [],
    sessionNames: new Map([["s1", "Leader Session"]]),
    questNamedSessions: new Set(),
    refreshQuests: vi.fn().mockResolvedValue(undefined),
    leaderWorkboardViews: new Map(),
    setLeaderWorkboardView: vi.fn(),
    shortcutSettings: { enabled: false, preset: "standard", overrides: {} },
    zoomLevel: 1,
    ...overrides,
  };
  if (!overrides.setLeaderWorkboardView) {
    mockState.setLeaderWorkboardView = vi.fn((sessionId: string, view: LeaderWorkboardView | null) => {
      if (view) mockState.leaderWorkboardViews.set(sessionId, view);
      else mockState.leaderWorkboardViews.delete(sessionId);
    });
  }
}

function leaderTabs(keys: string[], closed: LeaderOpenThreadTabsState["closedThreadTombstones"] = []) {
  return {
    version: 1,
    orderedOpenThreadKeys: keys,
    closedThreadTombstones: closed,
    updatedAt: 1,
  } satisfies LeaderOpenThreadTabsState;
}

function leaderSession(tabs?: LeaderOpenThreadTabsState) {
  return new Map([
    [
      "s1",
      {
        backend_state: "connected" as const,
        backend_error: null,
        isOrchestrator: true,
        ...(tabs ? { leaderOpenThreadTabs: tabs } : {}),
      },
    ],
  ]);
}

function threadMessage(questId: string, timestamp: number) {
  return {
    id: `m-${questId}`,
    role: "assistant",
    content: `${questId} update`,
    timestamp,
    metadata: { threadRefs: [{ threadKey: questId, questId, source: "explicit" }] },
  };
}

vi.mock("../store.js", () => ({
  useStore: (selector: (s: MockStoreState) => unknown) => selector(mockState),
  countUserPermissions: (perms: Map<string, unknown> | undefined): number => perms?.size ?? 0,
  getSessionSearchState: () => ({ query: "", isOpen: false, mode: "strict", category: "all", matches: [] }),
}));

vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: () => {} }));
vi.mock("../api.js", () => ({ api: { relaunchSession: vi.fn(), unarchiveSession: vi.fn() } }));
vi.mock("../ws.js", () => ({ sendToSession: (sessionId: string, msg: unknown) => mockSendToSession(sessionId, msg) }));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./TaskOutlineBar.js", () => ({ TaskOutlineBar: () => null }));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./Composer.js", () => ({
  Composer: ({ threadKey, transcriptionThreadTitle }: { threadKey?: string; transcriptionThreadTitle?: string }) => (
    <div
      data-testid="composer"
      data-thread-key={threadKey}
      data-transcription-thread-title={transcriptionThreadTitle}
    />
  ),
}));
vi.mock("./PermissionBanner.js", () => ({
  PermissionBanner: () => null,
  PlanReviewOverlay: () => null,
  PlanCollapsedChip: () => null,
  PermissionsCollapsedChip: () => null,
}));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({
    sessionId,
    threadKey,
    additionalAttentionRecords = [],
  }: {
    sessionId: string;
    threadKey?: string;
    additionalAttentionRecords?: Array<import("../types.js").SessionAttentionRecord>;
  }) => {
    mockMessageFeedRenders({ sessionId, threadKey });
    return (
      <div
        data-testid="message-feed"
        data-thread-key={threadKey}
        data-additional-attention-count={additionalAttentionRecords.length}
      >
        {sessionId}
      </div>
    );
  },
}));
vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    currentThreadKey,
    onSelectThread,
    openThreadKeys = [],
    closedThreadKeys = [],
    onCloseThreadTab,
    onReorderThreadTabs,
    threadRows = [],
  }: {
    currentThreadKey?: string;
    onSelectThread?: (threadKey: string) => void;
    openThreadKeys?: string[];
    closedThreadKeys?: string[];
    onCloseThreadTab?: (threadKey: string, nextThreadKey?: string) => void;
    onReorderThreadTabs?: (orderedThreadKeys: string[]) => void;
    threadRows?: Array<{ threadKey: string; questId?: string; title: string }>;
  }) => (
    <div
      data-testid="work-board-bar"
      data-current-thread-key={currentThreadKey}
      data-open-thread-keys={openThreadKeys.join(",")}
      data-closed-thread-keys={closedThreadKeys.join(",")}
    >
      {mockState.leaderWorkboardViews.get("s1") && (
        <div data-testid="workboard-panel" data-view={mockState.leaderWorkboardViews.get("s1") ?? undefined}>
          {mockState.leaderWorkboardViews.get("s1")}
        </div>
      )}
      {onSelectThread && (
        <>
          <button type="button" data-testid="mock-workboard-main" onClick={() => onSelectThread("main")}>
            Main
          </button>
          {threadRows.map((row) => (
            <button type="button" key={row.threadKey} onClick={() => onSelectThread(row.threadKey)}>
              {row.questId ?? row.threadKey} {row.title}
            </button>
          ))}
        </>
      )}
      {onCloseThreadTab &&
        openThreadKeys.map((threadKey, index) => (
          <button
            type="button"
            key={`close-${threadKey}`}
            data-testid="mock-workboard-close-tab"
            data-thread-key={threadKey}
            onClick={() => onCloseThreadTab(threadKey, openThreadKeys[index + 1])}
          >
            Close {threadKey}
          </button>
        ))}
      {onReorderThreadTabs && (
        <button
          type="button"
          data-testid="mock-workboard-reorder-tabs"
          onClick={() => onReorderThreadTabs([...openThreadKeys].reverse())}
        >
          Reorder tabs
        </button>
      )}
    </div>
  ),
}));
vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({ questId, children }: { questId: string; children?: ReactNode }) => (
    <span>{children ?? questId}</span>
  ),
}));
vi.mock("./SessionInlineLink.js", () => ({
  SessionInlineLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./SessionStatusDot.js", () => ({ SessionStatusDot: () => null }));
vi.mock("./GlobalNeedsInputMenu.js", () => ({ GlobalNeedsInputMenu: () => null }));
vi.mock("./CatIcons.js", () => ({ YarnBallDot: () => null }));
vi.mock("./QuestJourneyTimeline.js", () => ({
  isCompletedJourneyPresentationStatus: (status?: string) =>
    ["completed", "done"].includes((status ?? "").toLowerCase()),
  QuestJourneyPreviewCard: () => null,
  QuestJourneyTimeline: () => null,
}));
vi.mock("./session-participant-status.js", () => ({ useParticipantSessionStatusDotProps: () => ({}) }));

import { ChatView } from "./ChatView.js";
import { TopBar } from "./TopBar.js";

function RouteAwareLeaderSession() {
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
  );
  const route = parseHash(hash);
  const threadRoute = route.page === "session" ? threadRouteFromHash(hash) : { hasThreadParam: false, threadKey: null };
  const sessionId = route.page === "session" ? route.sessionId : "s1";

  return (
    <>
      <TopBar />
      <ChatView
        key={sessionId}
        sessionId={sessionId}
        hasThreadRoute={threadRoute.hasThreadParam}
        routeThreadKey={threadRoute.threadKey}
      />
    </>
  );
}

beforeEach(() => {
  resetStore();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "#/session/s1";
  mockSendToSession.mockClear();
  mockMessageFeedRenders.mockClear();
});

describe("ChatView leader open thread tabs", () => {
  it("hydrates authoritative open tabs from lightweight sdk session metadata before history loads", () => {
    resetStore({
      sessions: new Map([["s1", { backend_state: "connected", backend_error: null, isOrchestrator: true }]]),
      sdkSessions: [
        {
          sessionId: "s1",
          archived: false,
          isOrchestrator: true,
          leaderOpenThreadTabs: leaderTabs(["q-1200", "q-927"]),
        },
      ],
      historyLoading: new Map([["s1", true]]),
    });

    const view = render(<ChatView sessionId="s1" />);

    expect(within(view.container).getByTestId("work-board-bar")).toHaveAttribute(
      "data-open-thread-keys",
      "q-1200,q-927",
    );
  });

  it("sends open and close operations to the server without writing localStorage", () => {
    resetStore({
      messages: new Map([["s1", [threadMessage("q-941", 2)]]]),
      quests: [{ questId: "q-941", title: "Quest thread MVP", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    fireEvent.click(scope.getByRole("button", { name: /q-941 quest thread mvp/i }));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941");
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: { type: "open", threadKey: "q-941", placement: "first", source: "user" },
    });
    expect(localStorage.getItem("test-server:cc-leader-open-thread-tabs:s1")).toBeNull();

    fireEvent.click(scope.getByTestId("mock-workboard-close-tab"));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "");
    expect(mockSendToSession).toHaveBeenLastCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: { type: "close", threadKey: "q-941", closedAt: expect.any(Number) },
    });
  });

  it("persists a browser-local selected leader tab without writing open-tab localStorage", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", 2)]]]),
      quests: [{ questId: "q-941", title: "Persisted selection", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);

    fireEvent.click(scope.getByRole("button", { name: /q-941 persisted selection/i }));

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-941");
    expect(localStorage.getItem("test-server:cc-leader-open-thread-tabs:s1")).toBeNull();
  });

  it("passes the selected leader thread title to the composer for voice transcription vocabulary", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-1210"])),
      messages: new Map([["s1", [threadMessage("q-1210", 2)]]]),
      quests: [
        {
          questId: "q-1210",
          title: "Use active leader thread tab as voice transcription context",
          status: "in_progress",
        },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={true} routeThreadKey="q-1210" />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("composer")).toHaveAttribute("data-thread-key", "q-1210"));
    expect(scope.getByTestId("composer")).toHaveAttribute(
      "data-transcription-thread-title",
      "q-1210: Use active leader thread tab as voice transcription context",
    );
  });

  it("restores the browser-local selected leader tab when returning without an explicit thread route", async () => {
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", 2)]]]),
      quests: [{ questId: "q-941", title: "Restore me", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-current-thread-key", "q-941");
  });

  it("does not mount Main before restoring a server-open browser-local selected tab", () => {
    // The feed owns viewport save/restore side effects. If a returning leader
    // session first mounts Main and only later restores a saved quest tab,
    // selected-thread content can be snapshotted under the Main viewport key.
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", 2)]]]),
      quests: [{ questId: "q-941", title: "Initial restore", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);

    expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941");
    expect(mockMessageFeedRenders.mock.calls[0]?.[0]).toEqual({ sessionId: "s1", threadKey: "q-941" });
    expect(mockMessageFeedRenders).not.toHaveBeenCalledWith({ sessionId: "s1", threadKey: "main" });
  });

  it("falls back to Main when the browser-local selected tab is no longer server-open", async () => {
    persistLeaderSelectedThreadKey("s1", "q-999");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"], [{ threadKey: "q-999", closedAt: 10 }])),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-999", 3)]]]),
      quests: [
        { questId: "q-941", title: "Still open", status: "in_progress" },
        { questId: "q-999", title: "Closed elsewhere", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("main");
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941");
  });

  it("lets an explicit thread route override browser-local selected tab restore", async () => {
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-777"])),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3)]]]),
      quests: [
        { questId: "q-941", title: "Stored tab", status: "in_progress" },
        { questId: "q-777", title: "Routed tab", status: "in_progress" },
      ],
    });
    window.location.hash = "#/session/s1?thread=q-777";

    const view = render(<ChatView sessionId="s1" hasThreadRoute routeThreadKey="q-777" />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-777"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-777");
  });

  it.each([
    ["topbar-workboard-shortcut", "active"],
    ["topbar-completed-shortcut", "completed"],
  ] as const)("opens the %s panel in place from a quest thread", async (shortcutTestId, expectedView) => {
    persistLeaderSelectedThreadKey("s1", "q-42");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-42"])),
      sdkSessions: [{ sessionId: "s1", archived: false, isOrchestrator: true, name: "Leader Session" }],
      sessionBoards: new Map([["s1", [{ questId: "q-42", status: "IMPLEMENTING", title: "Active", updatedAt: 2 }]]]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-41", status: "DONE", title: "Completed", updatedAt: 1, completedAt: 1 }]],
      ]),
      messages: new Map([["s1", [threadMessage("q-42", 2)]]]),
      quests: [{ questId: "q-42", title: "Routed quest", status: "in_progress" }],
    });
    window.location.hash = "#/session/s1?thread=q-42";

    const view = render(<RouteAwareLeaderSession />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-42"));
    expect(scope.queryByTestId("workboard-panel")).not.toBeInTheDocument();

    fireEvent.click(scope.getByTestId(shortcutTestId));
    view.rerender(<RouteAwareLeaderSession />);

    await waitFor(() => expect(scope.getByTestId("workboard-panel")).toHaveAttribute("data-view", expectedView));
    expect(window.location.hash).toBe("#/session/s1?thread=q-42");
    expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-42");
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-current-thread-key", "q-42");
    expect(scope.getByTestId("workboard-panel")).toHaveAttribute("data-view", expectedView);
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-42");
  });

  it("renders server-owned tabs and applies remote close updates from another browser", () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-777"])),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3)]]]),
      quests: [
        { questId: "q-941", title: "Closed elsewhere", status: "in_progress" },
        { questId: "q-777", title: "Still open", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941,q-777");

    mockState.sessions = leaderSession(leaderTabs(["q-777"], [{ threadKey: "q-941", closedAt: 10 }]));
    view.rerender(<ChatView sessionId="s1" />);

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-777");
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-closed-thread-keys", "q-941");
  });

  it("sends manual reorder operations without changing selected tab or viewport ownership", () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-777", "q-555"])),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3), threadMessage("q-555", 4)]]]),
      quests: [
        { questId: "q-941", title: "First tab", status: "in_progress" },
        { questId: "q-777", title: "Second tab", status: "in_progress" },
        { questId: "q-555", title: "Third tab", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    fireEvent.click(scope.getByRole("button", { name: /q-777 second tab/i }));
    mockSendToSession.mockClear();

    fireEvent.click(scope.getByTestId("mock-workboard-reorder-tabs"));

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-555,q-777,q-941");
    expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-777");
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: { type: "reorder", orderedOpenThreadKeys: ["q-555", "q-777", "q-941"] },
    });

    mockState.sessions = leaderSession(leaderTabs(["q-555", "q-777", "q-941"]));
    view.rerender(<ChatView sessionId="s1" />);
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-555,q-777,q-941");
  });

  it("keeps newly opened tabs immediately after Main without reordering existing manual order", () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-777"])),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3), threadMessage("q-555", 4)]]]),
      quests: [
        { questId: "q-941", title: "First tab", status: "in_progress" },
        { questId: "q-777", title: "Second tab", status: "in_progress" },
        { questId: "q-555", title: "New tab", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    fireEvent.click(scope.getByTestId("mock-workboard-reorder-tabs"));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-777,q-941");
    mockSendToSession.mockClear();

    fireEvent.click(scope.getByRole("button", { name: /q-555 new tab/i }));

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-555,q-777,q-941");
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: { type: "open", threadKey: "q-555", placement: "first", source: "user" },
    });
  });

  it("migrates valid legacy localStorage only when no server state exists", async () => {
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:s1", '["q-941","q-777"]');
    resetStore({
      sessions: leaderSession(),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3)]]]),
      quests: [
        { questId: "q-941", title: "Migrated thread", status: "in_progress" },
        { questId: "q-777", title: "Second migrated thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941,q-777");
    await waitFor(() => {
      expect(mockSendToSession).toHaveBeenCalledWith("s1", {
        type: "leader_thread_tabs_update",
        operation: { type: "migrate", orderedOpenThreadKeys: ["q-941", "q-777"], migratedAt: expect.any(Number) },
      });
    });

    view.rerender(<ChatView sessionId="s1" />);
    expect(
      mockSendToSession.mock.calls.filter((call) => {
        const msg = call[1] as { operation?: { type?: string } };
        return msg.operation?.type === "migrate";
      }),
    ).toHaveLength(1);
  });

  it("ignores corrupt legacy localStorage when server state exists", async () => {
    localStorage.setItem("test-server:cc-leader-open-thread-tabs:s1", "{not-json");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-server"])),
      messages: new Map([["s1", [threadMessage("q-server", 2)]]]),
      quests: [{ questId: "q-server", title: "Server tab", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-server");
    await waitFor(() => {
      expect(localStorage.getItem("test-server:cc-leader-open-thread-tabs:s1")).toBeNull();
    });
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ operation: expect.objectContaining({ type: "migrate" }) }),
    );
  });

  it("keeps leader tabs open when their quests complete or finish a Journey", () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-777"])),
      sessionBoards: new Map([
        [
          "s1",
          [
            { questId: "q-941", status: "IMPLEMENTING", title: "Completing tab", updatedAt: 2 },
            { questId: "q-777", status: "IMPLEMENTING", title: "Still active", updatedAt: 1 },
          ],
        ],
      ]),
      messages: new Map([["s1", [threadMessage("q-941", 2), threadMessage("q-777", 3)]]]),
      quests: [
        { questId: "q-941", title: "Completing tab", status: "in_progress" },
        { questId: "q-777", title: "Still active", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941,q-777");

    mockState.sessionBoards = new Map([
      ["s1", [{ questId: "q-777", status: "IMPLEMENTING", title: "Still active", updatedAt: 4 }]],
    ]);
    mockState.sessionCompletedBoards = new Map([
      [
        "s1",
        [
          {
            questId: "q-941",
            status: "DONE",
            title: "Completing tab",
            updatedAt: 5,
            completedAt: 5,
            journey: { mode: "completed", phaseIds: ["alignment", "implement", "port"] },
          },
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" />);

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941,q-777");
    expect(mockSendToSession).not.toHaveBeenCalled();
  });

  it("persists active board-row quest tabs before completion so board removal does not drop them", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs([])),
      sessionBoards: new Map([
        ["s1", [{ questId: "q-1231", status: "PORTING", title: "Permission CLI", updatedAt: 10 }]],
      ]),
      messages: new Map([["s1", [threadMessage("q-1231", 10)]]]),
      quests: [{ questId: "q-1231", title: "Permission CLI", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1231"));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1231",
        placement: "first",
        source: "server_candidate",
        eventAt: 10,
      },
    });

    mockSendToSession.mockClear();
    mockState.sessionBoards = new Map([["s1", []]]);
    mockState.sessionCompletedBoards = new Map([
      [
        "s1",
        [
          {
            questId: "q-1231",
            status: "DONE",
            title: "Permission CLI",
            updatedAt: 20,
            completedAt: 20,
            journey: { mode: "completed", phaseIds: ["alignment", "implement", "port"] },
          },
        ],
      ],
    ]);
    mockState.quests = [{ questId: "q-1231", title: "Permission CLI", status: "done" }];
    view.rerender(<ChatView sessionId="s1" />);

    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-1231");
    expect(mockSendToSession).not.toHaveBeenCalled();
  });

  it("inserts newly active board-row candidates before older open leader tabs", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs(["q-old-a", "q-old-b", "q-old-c"])),
      sessionBoards: new Map([
        ["s1", [{ questId: "q-new", status: "IMPLEMENTING", title: "New active quest", updatedAt: 30 }]],
      ]),
      messages: new Map([
        [
          "s1",
          [
            threadMessage("q-old-a", 1),
            threadMessage("q-old-b", 2),
            threadMessage("q-old-c", 3),
            threadMessage("q-new", 30),
          ],
        ],
      ]),
      quests: [
        { questId: "q-old-a", title: "Older tab A", status: "in_progress" },
        { questId: "q-old-b", title: "Older tab B", status: "in_progress" },
        { questId: "q-old-c", title: "Older tab C", status: "in_progress" },
        { questId: "q-new", title: "New active quest", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    await waitFor(() =>
      expect(scope.getByTestId("work-board-bar")).toHaveAttribute(
        "data-open-thread-keys",
        "q-new,q-old-a,q-old-b,q-old-c",
      ),
    );
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-new",
        placement: "first",
        source: "server_candidate",
        eventAt: 30,
      },
    });
  });

  it("does not resurrect an active quest thread that the user explicitly closed", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs([], [{ threadKey: "q-1231", closedAt: 20 }])),
      sessionBoards: new Map([
        ["s1", [{ questId: "q-1231", status: "PORTING", title: "Closed quest", updatedAt: 10 }]],
      ]),
      messages: new Map([["s1", [threadMessage("q-1231", 10)]]]),
      quests: [{ questId: "q-1231", title: "Closed quest", status: "in_progress" }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", ""));
    expect(mockSendToSession).not.toHaveBeenCalled();
  });

  it("does not force unrelated historical completed quests into open thread tabs", async () => {
    resetStore({
      sessions: leaderSession(leaderTabs([])),
      sessionCompletedBoards: new Map([
        [
          "s1",
          [{ questId: "q-888", status: "DONE", title: "Historical completed quest", updatedAt: 10, completedAt: 10 }],
        ],
      ]),
      messages: new Map([["s1", [threadMessage("q-888", 10)]]]),
      quests: [{ questId: "q-888", title: "Historical completed quest", status: "done" }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    await waitFor(() => expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", ""));
    expect(mockSendToSession).not.toHaveBeenCalled();
  });

  it("auto-selects the target thread when a fresh attachment marker moves context from the selected source thread", async () => {
    const attachedAt = Date.now();
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt - 10)]]]),
      quests: [
        { questId: "q-941", title: "Source thread", status: "in_progress" },
        { questId: "q-1006", title: "Target thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));

    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt - 5),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "q-941", sourceQuestId: "q-941" }),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1006"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-1006");
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1006",
        placement: "first",
        source: "server_candidate",
        eventAt: attachedAt,
      },
    });
  });

  it("does not auto-select moved context when the attachment source is not the selected thread", async () => {
    const attachedAt = Date.now();
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt - 10)]]]),
      quests: [
        { questId: "q-941", title: "Selected thread", status: "in_progress" },
        { questId: "q-1006", title: "Target thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));

    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt - 5),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "main" }),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-941");
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1006",
        placement: "first",
        source: "server_candidate",
        eventAt: attachedAt,
      },
    });
  });

  it("does not create or select a closed completed target from an attachment marker", async () => {
    const attachedAt = Date.now();
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt - 10)]]]),
      quests: [
        { questId: "q-941", title: "Source thread", status: "in_progress" },
        { questId: "q-1006", title: "Completed target", status: "done" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));

    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt - 5),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "q-941", sourceQuestId: "q-941" }),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941");
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ operation: expect.objectContaining({ threadKey: "q-1006" }) }),
    );
  });

  it("can auto-select an already-open completed target without reopening it", async () => {
    const attachedAt = Date.now();
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941", "q-1006"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt - 10), threadMessage("q-1006", attachedAt - 9)]]]),
      quests: [
        { questId: "q-941", title: "Source thread", status: "in_progress" },
        { questId: "q-1006", title: "Completed target", status: "done" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));

    mockSendToSession.mockClear();
    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt - 5),
          threadMessage("q-1006", attachedAt - 4),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "q-941", sourceQuestId: "q-941" }),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1006"));
    expect(readLeaderSelectedThreadKey("s1")).toBe("q-1006");
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ operation: expect.objectContaining({ threadKey: "q-1006" }) }),
    );
  });

  it("does not auto-select when the user manually navigated after the attachment time", async () => {
    const attachedAt = 1;
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt)]]]),
      quests: [
        { questId: "q-941", title: "Source thread", status: "in_progress" },
        { questId: "q-1006", title: "Target thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    const sourceButton = await scope.findByRole("button", { name: /q-941 source thread/i });
    fireEvent.click(sourceButton);
    mockSendToSession.mockClear();

    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "q-941", sourceQuestId: "q-941" }),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1006",
        placement: "first",
        source: "server_candidate",
        eventAt: attachedAt,
      },
    });
  });

  it("does not auto-select when the marker did not move the latest user-authored message", async () => {
    const attachedAt = Date.now();
    persistLeaderSelectedThreadKey("s1", "q-941");
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"])),
      messages: new Map([["s1", [threadMessage("q-941", attachedAt - 10)]]]),
      quests: [
        { questId: "q-941", title: "Source thread", status: "in_progress" },
        { questId: "q-1006", title: "Target thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);
    const scope = within(view.container);
    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));

    mockState.messages = new Map([
      [
        "s1",
        [
          threadMessage("q-941", attachedAt - 5),
          movedUser("q-1006", attachedAt),
          movedMarker("q-1006", attachedAt, { sourceThreadKey: "q-941", sourceQuestId: "q-941" }),
          movedUser("q-2000", attachedAt + 1, 9),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" hasThreadRoute={false} routeThreadKey={null} />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-941"));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1006",
        placement: "first",
        source: "server_candidate",
        eventAt: attachedAt,
      },
    });
  });

  it("opens fresh server-created candidates but suppresses candidates older than a user close", async () => {
    const attachedAt = Date.now();
    resetStore({
      sessions: leaderSession(leaderTabs(["q-941"], [{ threadKey: "q-1005", closedAt: attachedAt + 1 }])),
      messages: new Map([["s1", []]]),
      quests: [
        { questId: "q-941", title: "Existing thread", status: "in_progress" },
        { questId: "q-1005", title: "Closed thread", status: "in_progress" },
        { questId: "q-1006", title: "Fresh thread", status: "in_progress" },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    mockState.messages = new Map([["s1", [movedUser("q-1005", attachedAt), movedMarker("q-1005", attachedAt)]]]);
    view.rerender(<ChatView sessionId="s1" />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    expect(scope.getByTestId("work-board-bar")).toHaveAttribute("data-open-thread-keys", "q-941");
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ operation: expect.objectContaining({ threadKey: "q-1005" }) }),
    );

    const freshAttachedAt = attachedAt + 10;
    mockState.sessions = leaderSession(leaderTabs(["q-941"], [{ threadKey: "q-1006", closedAt: freshAttachedAt - 1 }]));
    mockState.messages = new Map([
      [
        "s1",
        [
          movedUser("q-1005", attachedAt),
          movedMarker("q-1005", attachedAt),
          movedUser("q-1006", freshAttachedAt),
          movedMarker("q-1006", freshAttachedAt),
          threadMessage("q-941", freshAttachedAt + 1),
        ],
      ],
    ]);
    view.rerender(<ChatView sessionId="s1" />);

    await waitFor(() => expect(scope.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-1006"));
    expect(mockSendToSession).toHaveBeenCalledWith("s1", {
      type: "leader_thread_tabs_update",
      operation: {
        type: "open",
        threadKey: "q-1006",
        placement: "first",
        source: "server_candidate",
        eventAt: freshAttachedAt,
      },
    });
  });
});

function movedUser(questId: string, attachedAt: number, historyIndex = 1) {
  return {
    id: `u-${questId}`,
    role: "user",
    content: "Please make this a quest.",
    timestamp: attachedAt - 2,
    historyIndex,
    metadata: { threadRefs: [{ threadKey: questId, questId, source: "backfill" }] },
  };
}

function movedMarker(
  questId: string,
  attachedAt: number,
  source?: { sourceThreadKey?: string; sourceQuestId?: string },
) {
  return {
    id: `marker-${questId}`,
    role: "system",
    content: `1 message moved to ${questId}`,
    timestamp: attachedAt,
    historyIndex: 2,
    metadata: {
      threadAttachmentMarker: {
        type: "thread_attachment_marker",
        id: `marker-${questId}`,
        timestamp: attachedAt,
        markerKey: `thread-attachment:${questId}:u-${questId}`,
        threadKey: questId,
        questId,
        ...source,
        attachedAt,
        attachedBy: "leader",
        messageIds: [`u-${questId}`],
        messageIndices: [1],
        ranges: ["1"],
        count: 1,
        firstMessageId: `u-${questId}`,
        firstMessageIndex: 1,
      },
    },
  };
}
