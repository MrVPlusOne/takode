// @vitest-environment jsdom
import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockConnectSession = vi.fn();
const mockDisconnectSession = vi.fn();

interface MockStoreState {
  colorTheme: string;
  darkMode: boolean;
  zoomLevel: number;
  currentSessionId: string | null;
  searchPreviewSessionId: string | null;
  terminalCwd: string | null;
  connectionStatus: Map<string, "connecting" | "connected" | "disconnected">;
  cliConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  askPermission: Map<string, boolean>;
  diffFileStats: Map<string, Map<string, { additions: number; deletions: number }>>;
  shortcutSettings: {
    enabled: boolean;
    preset: "standard" | "vscode-light" | "vim-light";
    overrides: Record<string, string | null>;
  };
  sdkSessions: Array<{
    sessionId: string;
    createdAt: number;
    archived?: boolean;
    cronJobId?: string | null;
    state?: "starting" | "connected" | "running" | "exited" | null;
    cwd?: string;
    model?: string;
    gitBranch?: string;
    gitAhead?: number;
    gitBehind?: number;
    totalLinesAdded?: number;
    totalLinesRemoved?: number;
    pendingTimerCount?: number;
    backendType?: "claude" | "codex" | "claude-sdk";
    repoRoot?: string;
    cliConnected?: boolean;
    isWorktree?: boolean;
    worktreeExists?: boolean;
    worktreeDirty?: boolean;
    lastActivityAt?: number;
    lastUserMessageAt?: number;
    isOrchestrator?: boolean;
    herdedBy?: string;
    sessionNum?: number | null;
    reviewerOf?: number;
    claimedQuestStatus?: string;
  }>;
  treeGroups: Array<{ id: string; name: string }>;
  treeAssignments: Map<string, string>;
  treeNodeOrder: Map<string, string[]>;
  collapsedTreeGroups: Set<string>;
  expandedHerdNodes: Set<string>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionSortMode: "created" | "activity";
  messages: Map<string, Array<{ id: string; historyIndex?: number }>>;
  sidebarOpen: boolean;
  taskPanelOpen: boolean;
  activeTab: "chat" | "diff";
  codexSubagentInspector: { sessionId: string } | null;
  newSessionModalState: null;
  serverRestarting: boolean;
  serverReachable: boolean;
  setServerReachable: ReturnType<typeof vi.fn>;
  setCurrentSession: ReturnType<typeof vi.fn>;
  markSessionViewed: ReturnType<typeof vi.fn>;
  requestScrollToMessage: ReturnType<typeof vi.fn>;
  setExpandAllInTurn: ReturnType<typeof vi.fn>;
  setPendingScrollToMessageIndex: ReturnType<typeof vi.fn>;
  setPendingScrollToMessageId: ReturnType<typeof vi.fn>;
  closeNewSessionModal: ReturnType<typeof vi.fn>;
  closeCodexSubagentInspector: ReturnType<typeof vi.fn>;
  setSidebarOpen: ReturnType<typeof vi.fn>;
  setActiveTab: ReturnType<typeof vi.fn>;
  openSessionSearch: ReturnType<typeof vi.fn>;
  closeSessionSearch: ReturnType<typeof vi.fn>;
  questOverlayId: string | null;
  questOverlayFeedbackTarget: { index: number; requestId: number } | null;
  openQuestOverlay: ReturnType<typeof vi.fn>;
  closeQuestOverlay: ReturnType<typeof vi.fn>;
  openNewSessionModal: ReturnType<typeof vi.fn>;
  openTerminal: ReturnType<typeof vi.fn>;
  sessions: Map<string, { backend_type?: string; cwd?: string }>;
}

let mockState: MockStoreState;

function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    colorTheme: "dark",
    darkMode: true,
    zoomLevel: 1,
    currentSessionId: "s1",
    searchPreviewSessionId: null,
    terminalCwd: null,
    connectionStatus: new Map([["s1", "connected"]]),
    cliConnected: new Map([["s1", true]]),
    cliDisconnectReason: new Map(),
    sessionStatus: new Map([["s1", "idle"]]),
    pendingPermissions: new Map(),
    askPermission: new Map(),
    diffFileStats: new Map(),
    shortcutSettings: { enabled: false, preset: "standard", overrides: {} },
    sdkSessions: [{ sessionId: "s1", createdAt: 1, archived: false, cwd: "/repo/s1", backendType: "claude" }],
    treeGroups: [{ id: "default", name: "Default" }],
    treeAssignments: new Map(),
    treeNodeOrder: new Map(),
    collapsedTreeGroups: new Set(),
    expandedHerdNodes: new Set(),
    sessionAttention: new Map(),
    sessionSortMode: "created",
    messages: new Map([
      [
        "s1",
        [
          { id: "m0", historyIndex: 0 },
          { id: "m1", historyIndex: 1 },
          { id: "m2", historyIndex: 2 },
        ],
      ],
    ]),
    sidebarOpen: false,
    taskPanelOpen: false,
    activeTab: "chat",
    codexSubagentInspector: null,
    newSessionModalState: null,
    serverRestarting: false,
    serverReachable: true,
    setServerReachable: vi.fn(),
    setCurrentSession: vi.fn(),
    markSessionViewed: vi.fn(),
    requestScrollToMessage: vi.fn(),
    setExpandAllInTurn: vi.fn(),
    setPendingScrollToMessageIndex: vi.fn(),
    setPendingScrollToMessageId: vi.fn(),
    closeNewSessionModal: vi.fn(),
    closeCodexSubagentInspector: vi.fn(() => {
      mockState.codexSubagentInspector = null;
    }),
    setSidebarOpen: vi.fn(),
    setActiveTab: vi.fn(),
    openSessionSearch: vi.fn(),
    closeSessionSearch: vi.fn(),
    questOverlayId: null,
    questOverlayFeedbackTarget: null,
    openQuestOverlay: vi.fn((questId: string, _searchHighlight?: string, feedbackIndex?: number) => {
      mockState.questOverlayId = questId;
      mockState.questOverlayFeedbackTarget =
        feedbackIndex === undefined
          ? null
          : { index: feedbackIndex, requestId: (mockState.questOverlayFeedbackTarget?.requestId ?? 0) + 1 };
    }),
    closeQuestOverlay: vi.fn(() => {
      mockState.questOverlayId = null;
      mockState.questOverlayFeedbackTarget = null;
    }),
    openNewSessionModal: vi.fn(),
    openTerminal: vi.fn(),
    sessions: new Map([["s1", { backend_type: "claude" }]]),
    ...overrides,
  };
}

function setMockQuestOverlay(questId: string | null, feedbackIndex?: number) {
  mockState.questOverlayId = questId;
  mockState.questOverlayFeedbackTarget =
    questId && feedbackIndex !== undefined ? { index: feedbackIndex, requestId: 1 } : null;
}

vi.mock("./store.js", () => {
  const useStore: any = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStore.getState = () => mockState;
  return {
    useStore,
    getSessionSearchState: () => ({
      query: "",
      isOpen: false,
      mode: "strict",
      category: "all",
      matches: [],
      currentMatchIndex: -1,
    }),
  };
});

const mockCheckHealthStatus = vi
  .fn()
  .mockResolvedValue({ ok: true, buildId: "development", servedFrontendBuildId: "development" });
const mockMarkSessionRead = vi.fn().mockResolvedValue({ ok: true });
const mockListSessions = vi.fn().mockResolvedValue([]);
const mockSearchSessions = vi.fn().mockResolvedValue({ query: "", tookMs: 0, totalMatches: 0, results: [] });
const mockRefreshSessionGitStatus = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./api.js", () => ({
  api: {
    markSessionRead: (...args: unknown[]) => mockMarkSessionRead(...args),
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    searchSessions: (...args: unknown[]) => mockSearchSessions(...args),
    refreshSessionGitStatus: (...args: unknown[]) => mockRefreshSessionGitStatus(...args),
  },
  checkHealthStatus: (...args: unknown[]) => mockCheckHealthStatus(...args),
}));

vi.mock("./ws.js", () => ({
  connectSession: (...args: unknown[]) => mockConnectSession(...args),
  disconnectSession: (...args: unknown[]) => mockDisconnectSession(...args),
  refreshSyncedProjectionSubscriptions: vi.fn(() => true),
  sendVsCodeSelectionUpdate: vi.fn(),
}));

vi.mock("./session-list-hydration.js", () => ({
  beginActiveSessionListRequest: vi.fn(() => 1),
  hydrateSessionList: vi.fn(),
  installActiveSessionMetadataRefreshListeners: vi.fn(() => vi.fn()),
}));

vi.mock("./components/Sidebar.js", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));

vi.mock("./components/TaskPanel.js", () => ({
  TaskPanel: () => <div data-testid="task-panel" />,
}));

vi.mock("./components/TopBar.js", () => ({
  TopBar: ({
    fullPageLabel,
    onOpenUniversalSearch,
  }: {
    fullPageLabel?: string;
    onOpenUniversalSearch?: () => void;
  }) => (
    <div data-testid="top-bar" data-full-page-label={fullPageLabel ?? ""}>
      <button type="button" onClick={onOpenUniversalSearch}>
        Universal Search
      </button>
    </div>
  ),
}));

vi.mock("./components/CodexSubagentInspector.js", () => ({
  CodexSubagentInspector: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="codex-subagent-inspector-host" data-session-id={sessionId} />
  ),
}));

vi.mock("./components/ChatView.js", () => ({
  ChatView: ({
    sessionId,
    preview,
    routeThreadKey,
  }: {
    sessionId: string;
    preview?: boolean;
    routeThreadKey?: string | null;
  }) => (
    <div
      data-testid="chat-view"
      data-session-id={sessionId}
      data-preview={preview ? "true" : "false"}
      data-route-thread-key={routeThreadKey ?? ""}
    />
  ),
}));

vi.mock("./components/EmptyState.js", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));

vi.mock("./components/DiffPanel.js", () => ({
  DiffPanel: () => <div data-testid="diff-panel" />,
}));

vi.mock("./components/Playground.js", () => ({
  Playground: () => <div data-testid="playground" />,
}));

vi.mock("./components/SettingsPage.js", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));

vi.mock("./components/ChangelogPage.js", () => ({
  ChangelogPage: () => <div data-testid="changelog-page" />,
}));

vi.mock("./components/LogsPage.js", () => ({
  LogsPage: () => <div data-testid="logs-page" />,
}));

vi.mock("./components/EnvManager.js", () => ({
  EnvManager: () => <div data-testid="env-manager" />,
}));

vi.mock("./components/TodosAndTimersPage.js", () => ({
  TodosAndTimersPage: () => <div data-testid="todos-and-timers-page" />,
}));

vi.mock("./components/MemoryPage.js", () => ({
  MemoryPage: () => <div data-testid="memory-page" />,
}));

vi.mock("./components/TerminalPage.js", () => ({
  TerminalPage: () => <div data-testid="terminal-page" />,
}));

vi.mock("./components/SessionCreationView.js", () => ({
  SessionCreationView: () => <div data-testid="session-creation-view" />,
}));

vi.mock("./components/NewSessionModal.js", () => ({
  NewSessionModal: () => null,
}));

vi.mock("./components/QuestmasterPage.js", () => ({
  QuestmasterPage: () => <div data-testid="questmaster-page" />,
}));

vi.mock("./components/QuestDetailPanel.js", () => ({
  QuestDetailPanel: () => null,
}));

vi.mock("./components/UniversalSearchOverlay.js", () => ({
  UniversalSearchOverlay: ({
    open,
    initialMode,
    onClose,
    onOpenQuest,
  }: {
    open: boolean;
    initialMode?: string;
    onClose: () => void;
    onOpenQuest: (questId: string, query: string) => void;
  }) =>
    open ? (
      <div
        role="dialog"
        aria-label="Universal Search"
        data-testid="universal-search-overlay"
        data-initial-mode={initialMode ?? ""}
      >
        <input aria-label="Universal Search input" />
        <button type="button" onClick={() => onOpenQuest("q-1272", "needle")}>
          Open quest result
        </button>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    ) : null,
}));

vi.mock("./utils/vscode-context.js", () => ({
  announceVsCodeReady: vi.fn(),
  maybeReadVsCodeSelectionContext: vi.fn(() => undefined),
}));

vi.mock("./utils/vscode-bridge.js", () => ({
  ensureVsCodeEditorPreference: vi.fn().mockResolvedValue(undefined),
}));

import App from "./App.js";
import { hydrateSessionList } from "./session-list-hydration.js";
import { resetSessionGitStatusAutoRefreshForTest } from "./utils/session-git-status-auto-refresh.js";
import { retireSessionMessageRoute } from "./utils/routing.js";
import { BACKEND_CONNECTION_OPEN_EVENT, resetBuildCompatibilityForTest } from "./build-compatibility.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hydrateSessionList).mockReset();
  resetSessionGitStatusAutoRefreshForTest();
  mockListSessions.mockResolvedValue([]);
  mockSearchSessions.mockResolvedValue({ query: "", tookMs: 0, totalMatches: 0, results: [] });
  mockRefreshSessionGitStatus.mockResolvedValue({ ok: true });
  mockCheckHealthStatus.mockResolvedValue({ ok: true, buildId: "development", servedFrontendBuildId: "development" });
  resetBuildCompatibilityForTest();
  setViewportWidth(1024);
  resetStore();
  window.location.hash = "#/session/s1";
});

describe("App quest overlay routes", () => {
  it("keeps an initial routed target authoritative across StrictMode effect replay", async () => {
    window.location.hash = "#/questmaster?quest=q-1966&feedback=5";

    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    await waitFor(() => expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1966", undefined, 5));
    expect(window.location.hash).toBe("#/questmaster?quest=q-1966&feedback=5");
    expect(mockState.closeQuestOverlay).not.toHaveBeenCalled();
  });

  it("opens exact feedback targets from session and full-page hashes", async () => {
    window.location.hash = "#/session/s1?quest=q-1966&feedback=5";
    const view = render(<App />);

    await waitFor(() => expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1966", undefined, 5));

    view.unmount();
    resetStore();
    window.location.hash = "#/settings?quest=q-1966&feedback=5";
    render(<App />);

    await waitFor(() => expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1966", undefined, 5));
  });

  it("closes and reopens only the route-owned exact target across browser history changes", async () => {
    window.location.hash = "#/session/s1?quest=q-1966&feedback=5";
    render(<App />);
    await waitFor(() => expect(mockState.questOverlayFeedbackTarget?.index).toBe(5));

    window.location.hash = "#/session/s1";
    await waitFor(() => expect(mockState.closeQuestOverlay).toHaveBeenCalledTimes(1));

    window.location.hash = "#/session/s1?quest=q-1966&feedback=5";
    await waitFor(() => expect(mockState.openQuestOverlay).toHaveBeenCalledTimes(2));
  });

  it("normalizes direct overlay replacements and closes while a quest route owns the hash", async () => {
    window.location.hash = "#/session/s1?thread=q-9&quest=q-1966&feedback=5";
    const view = render(<App />);
    await waitFor(() => expect(mockState.questOverlayFeedbackTarget?.index).toBe(5));

    setMockQuestOverlay("q-77");
    view.rerender(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/session/s1?thread=q-9&quest=q-77"));

    setMockQuestOverlay(null);
    view.rerender(<App />);
    await waitFor(() => expect(window.location.hash).toBe("#/session/s1?thread=q-9"));
  });

  it("keeps direct overlay opens store-only when the hash has no quest route", () => {
    window.location.hash = "#/session/s1?thread=q-9";
    const view = render(<App />);

    setMockQuestOverlay("q-77");
    view.rerender(<App />);

    expect(mockState.questOverlayId).toBe("q-77");
    expect(window.location.hash).toBe("#/session/s1?thread=q-9");
  });

  it("lets a newer browser hash win over an unsynchronized direct store replacement", async () => {
    window.location.hash = "#/session/s1?quest=q-1966&feedback=5";
    render(<App />);
    await waitFor(() => expect(mockState.questOverlayFeedbackTarget?.index).toBe(5));

    setMockQuestOverlay("q-77");
    window.location.hash = "#/session/s1?quest=q-88&feedback=2";

    await waitFor(() => expect(mockState.openQuestOverlay).toHaveBeenLastCalledWith("q-88", undefined, 2));
    expect(window.location.hash).toBe("#/session/s1?quest=q-88&feedback=2");
  });

  it("lets browser Back close a route-owned overlay even after an unsynchronized store replacement", async () => {
    window.location.hash = "#/session/s1?quest=q-1966&feedback=5";
    render(<App />);
    await waitFor(() => expect(mockState.questOverlayFeedbackTarget?.index).toBe(5));

    setMockQuestOverlay("q-77");
    window.location.hash = "#/session/s1";

    await waitFor(() => expect(mockState.questOverlayId).toBeNull());
    expect(mockState.closeQuestOverlay).toHaveBeenCalledTimes(1);
  });
});

describe("App hidden panels", () => {
  it("does not mount the desktop sidebar while it is closed", () => {
    resetStore({ sidebarOpen: false, taskPanelOpen: false });

    render(<App />);

    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(screen.queryByTestId("task-panel")).toBeNull();
  });

  it("keeps the mobile sidebar mounted but inert while hidden", async () => {
    setViewportWidth(430);
    resetStore({ sidebarOpen: false, taskPanelOpen: false });

    const view = render(<App />);
    const sidebar = screen.getByTestId("sidebar");
    let shell = screen.getByTestId("app-sidebar-shell");
    expect(shell).toHaveAttribute("data-mobile-sidebar-state", "hidden");
    expect(shell).toHaveAttribute("aria-hidden", "true");
    expect(shell).toHaveClass("-translate-x-full", "pointer-events-none");
    await waitFor(() => expect((shell as HTMLElement & { inert: boolean }).inert).toBe(true));

    resetStore({ sidebarOpen: true, taskPanelOpen: false });
    view.rerender(<App />);

    shell = screen.getByTestId("app-sidebar-shell");
    expect(screen.getByTestId("sidebar")).toBe(sidebar);
    expect(shell).toHaveAttribute("data-mobile-sidebar-state", "open");
    expect(shell).not.toHaveAttribute("aria-hidden");
    await waitFor(() => expect((shell as HTMLElement & { inert: boolean }).inert).toBe(false));

    resetStore({ sidebarOpen: false, taskPanelOpen: false });
    view.rerender(<App />);

    shell = screen.getByTestId("app-sidebar-shell");
    expect(screen.getByTestId("sidebar")).toBe(sidebar);
    expect(shell).toHaveAttribute("data-mobile-sidebar-state", "hidden");
    expect(shell).toHaveAttribute("aria-hidden", "true");
    expect(shell).toHaveClass("-translate-x-full", "pointer-events-none");
    await waitFor(() => expect((shell as HTMLElement & { inert: boolean }).inert).toBe(true));
    expect(screen.queryByTestId("task-panel")).toBeNull();
  });

  it("mounts the sidebar and task panel only when opened", () => {
    resetStore({ sidebarOpen: true, taskPanelOpen: true });

    render(<App />);

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("task-panel")).toBeInTheDocument();
  });

  it("hosts the native Codex inspector outside ChatView while the Diff tab is active", () => {
    resetStore({ activeTab: "diff", codexSubagentInspector: { sessionId: "s1" } });

    render(<App />);

    expect(screen.getByTestId("diff-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
    expect(screen.getByTestId("codex-subagent-inspector-host")).toHaveAttribute("data-session-id", "s1");
  });

  it("keeps the inspector bound to its owning session while another session is previewed", () => {
    resetStore({
      searchPreviewSessionId: "s2",
      codexSubagentInspector: { sessionId: "s1" },
      sdkSessions: [
        { sessionId: "s1", createdAt: 1, backendType: "codex" },
        { sessionId: "s2", createdAt: 2, backendType: "codex" },
      ],
    });

    render(<App />);

    expect(screen.getByTestId("chat-view")).toHaveAttribute("data-session-id", "s2");
    expect(screen.getByTestId("chat-view")).toHaveAttribute("data-preview", "true");
    expect(screen.getByTestId("codex-subagent-inspector-host")).toHaveAttribute("data-session-id", "s1");
  });

  it("does not open Universal Search from the old Standard search shortcut", () => {
    resetStore({
      sidebarOpen: false,
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });

    render(<App />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true });

    expect(screen.queryByTestId("sidebar")).toBeNull();
    expect(mockState.openSessionSearch).not.toHaveBeenCalled();
    expect(screen.queryByTestId("universal-search-overlay")).toBeNull();
  });

  it("uses one top-bar Universal Search entry and leaves Recent to the overlay tabs", () => {
    // Recent is a mode within the shared modal, not a second app-level entry that duplicates the established Search affordance.
    render(<App />);

    expect(screen.queryByRole("button", { name: "Recent asks" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Universal Search" }));

    expect(screen.getByTestId("universal-search-overlay")).toHaveAttribute("data-initial-mode", "");
  });

  it("opens Universal Search from the Standard search shortcut", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });

    render(<App />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });

    expect(screen.getByTestId("universal-search-overlay")).toBeInTheDocument();
    expect(mockState.openSessionSearch).not.toHaveBeenCalled();
  });

  it("closes the Codex subagent inspector before a global search shortcut opens", () => {
    resetStore({
      codexSubagentInspector: { sessionId: "s1" },
      shortcutSettings: { enabled: true, preset: "standard", overrides: { search_session: "Ctrl+K" } },
    });

    render(<App />);
    expect(screen.getByTestId("codex-subagent-inspector-host")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    expect(mockState.closeCodexSubagentInspector).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("codex-subagent-inspector-host")).toBeNull();
    expect(screen.getByTestId("universal-search-overlay")).toBeInTheDocument();
  });

  it("opens Universal Search from an editable composer target using the configured shortcut", async () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: { search_session: "Ctrl+K" } },
    });

    render(<App />);
    const composerInput = document.createElement("textarea");
    document.body.appendChild(composerInput);
    composerInput.focus();
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(composerInput, event);

    expect(event.defaultPrevented).toBe(true);
    expect(await screen.findByTestId("universal-search-overlay")).toBeInTheDocument();
    expect(mockState.openSessionSearch).not.toHaveBeenCalled();
    composerInput.remove();
  });

  it("keeps Universal Search shortcut captured while the overlay input is focused", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });

    render(<App />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    const input = screen.getByLabelText("Universal Search input");
    input.focus();
    const event = new KeyboardEvent("keydown", {
      key: "f",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByTestId("universal-search-overlay")).toBeInTheDocument();
  });

  it("opens quest results as the global quest modal without navigating to Questmaster", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });
    window.location.hash = "#/session/s1";

    render(<App />);
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Open quest result" }));

    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1272", "needle");
    expect(window.location.hash).toBe("#/session/s1");
  });

  it("replaces an existing feedback route when Universal Search opens another quest", async () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });
    window.location.hash = "#/session/s1?thread=q-9&quest=q-1966&feedback=5";

    render(<App />);
    await waitFor(() => expect(mockState.questOverlayFeedbackTarget?.index).toBe(5));
    fireEvent.keyDown(document, { key: "f", ctrlKey: true, shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Open quest result" }));

    expect(mockState.openQuestOverlay).toHaveBeenLastCalledWith("q-1272", "needle");
    await waitFor(() => expect(window.location.hash).toBe("#/session/s1?thread=q-9&quest=q-1272"));
  });

  it("mounts TodosAndTimersPage on the scheduled route", () => {
    window.location.hash = "#/scheduled";

    render(<App />);

    expect(screen.getByTestId("todos-and-timers-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
  });

  it("lets full-page routes own the top chrome instead of rendering session identity chrome", () => {
    for (const [hash, testId, label] of [
      ["#/memory", "memory-page", "Memory"],
      ["#/changelog", "changelog-page", "Changelog"],
      ["#/terminal", "terminal-page", "Terminal"],
      ["#/scheduled", "todos-and-timers-page", "To-dos & Timers"],
      ["#/settings", "settings-page", "Settings"],
      ["#/questmaster", "questmaster-page", "Questmaster"],
    ] as const) {
      window.location.hash = hash;
      const view = render(<App />);

      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.getByTestId("top-bar")).toHaveAttribute("data-full-page-label", label);

      view.unmount();
    }
  });

  it("mounts MemoryPage on the memory route", () => {
    window.location.hash = "#/memory";

    render(<App />);

    expect(screen.getByTestId("memory-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
  });

  it("keeps the legacy streams hash pointed at MemoryPage", () => {
    window.location.hash = "#/streams";

    render(<App />);

    expect(screen.getByTestId("memory-page")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
  });

  it("does not render a page-level server unreachable banner while a chat session is visible", () => {
    resetStore({
      serverReachable: false,
      activeTab: "chat",
      currentSessionId: "s1",
      connectionStatus: new Map([["s1", "disconnected"]]),
    });

    render(<App />);

    expect(screen.queryByText("Server unreachable")).toBeNull();
  });

  it("keeps the server unreachable banner on non-chat views even if the session transport is connected", () => {
    resetStore({
      serverReachable: false,
      activeTab: "diff",
      currentSessionId: "s1",
      connectionStatus: new Map([["s1", "connected"]]),
    });

    render(<App />);

    expect(screen.getByText("Server unreachable")).toBeInTheDocument();
  });

  it("does not mount the hidden chat view while the diff tab is active", () => {
    resetStore({
      activeTab: "diff",
      currentSessionId: "s1",
      sessions: new Map([["s1", { backend_type: "claude" }]]),
      sdkSessions: [{ sessionId: "s1", createdAt: 1, archived: false, backendType: "claude" }],
    });
    window.location.hash = "#/session/s1";

    render(<App />);

    expect(screen.getByTestId("diff-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
  });

  it("marks route-open session reads as session views instead of broad explicit reads", async () => {
    window.location.hash = "#/session/s1";

    render(<App />);

    await waitFor(() =>
      expect(mockMarkSessionRead).toHaveBeenCalledWith("s1", {
        mode: "session-view",
      }),
    );
  });

  it("renders the right-pane chat in preview mode when searchPreviewSessionId is set", () => {
    resetStore({
      currentSessionId: "s1",
      searchPreviewSessionId: "s2",
      connectionStatus: new Map([
        ["s1", "connected"],
        ["s2", "disconnected"],
      ]),
      sessions: new Map([
        ["s1", { backend_type: "claude" }],
        ["s2", { backend_type: "claude" }],
      ]),
    });
    window.location.hash = "#/session/s1";

    render(<App />);

    const chatView = screen.getByTestId("chat-view");
    expect(chatView).toHaveAttribute("data-session-id", "s2");
    expect(chatView).toHaveAttribute("data-preview", "true");
    expect(mockConnectSession).toHaveBeenCalledWith("s2");
  });

  it("keeps search preview chat responsible for server unreachable status", () => {
    resetStore({
      serverReachable: false,
      currentSessionId: "s1",
      searchPreviewSessionId: "s2",
      connectionStatus: new Map([
        ["s1", "connected"],
        ["s2", "connected"],
      ]),
      sessions: new Map([
        ["s1", { backend_type: "claude" }],
        ["s2", { backend_type: "claude" }],
      ]),
    });
    window.location.hash = "#/session/s1";

    render(<App />);

    const chatView = screen.getByTestId("chat-view");
    expect(chatView).toHaveAttribute("data-session-id", "s2");
    expect(chatView).toHaveAttribute("data-preview", "true");
    expect(screen.queryByText("Server unreachable")).toBeNull();
  });

  it("does not republish unchanged health state on a successful poll", async () => {
    resetStore({ serverReachable: true });
    mockCheckHealthStatus.mockResolvedValueOnce({
      ok: true,
      buildId: "development",
      servedFrontendBuildId: "development",
    });

    render(<App />);

    await waitFor(() => expect(mockCheckHealthStatus).toHaveBeenCalled());
    expect(mockState.setServerReachable).not.toHaveBeenCalled();
  });

  it("marks the server reachable when a successful poll recovers from unreachable state", async () => {
    resetStore({ serverReachable: false });
    mockCheckHealthStatus.mockResolvedValueOnce({
      ok: true,
      buildId: "development",
      servedFrontendBuildId: "development",
    });

    render(<App />);

    await waitFor(() => expect(mockState.setServerReachable).toHaveBeenCalledWith(true));
  });

  it("keeps the app quiet when the initial health build matches", async () => {
    render(<App />);

    await waitFor(() => expect(mockCheckHealthStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("build-mismatch-notice")).toBeNull();
  });

  it("shows the Reload notice when the initial health response has a different build", async () => {
    mockCheckHealthStatus.mockResolvedValueOnce({
      ok: true,
      buildId: "new-backend-build",
      servedFrontendBuildId: "new-backend-build",
    });

    render(<App />);

    expect(await screen.findByRole("alert", { name: "Frontend update required" })).toBeInTheDocument();
  });

  it("diagnoses an identity-less backend without offering a Reload loop", async () => {
    mockCheckHealthStatus.mockResolvedValueOnce({
      ok: true,
      buildId: null,
      servedFrontendBuildId: "development",
    });

    render(<App />);

    expect(await screen.findByRole("alert", { name: "Takode restart required" })).toHaveTextContent(
      "backend has no build identity",
    );
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });

  it("lets a successful WebSocket recheck reset liveness failure accounting", async () => {
    // A reconnect proves the backend recovered; the next isolated poll failure must not be treated as two consecutive failures.
    mockCheckHealthStatus
      .mockResolvedValueOnce({ ok: false, buildId: null, servedFrontendBuildId: null })
      .mockResolvedValueOnce({ ok: true, buildId: "development", servedFrontendBuildId: "development" })
      .mockResolvedValueOnce({ ok: false, buildId: null, servedFrontendBuildId: null });

    vi.useFakeTimers();
    try {
      render(<App />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(mockState.setServerReachable).not.toHaveBeenCalledWith(false);

      window.dispatchEvent(new Event(BACKEND_CONNECTION_OPEN_EVENT));
      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(mockCheckHealthStatus).toHaveBeenCalledTimes(3);
      expect(mockState.setServerReachable).not.toHaveBeenCalledWith(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks build compatibility after a WebSocket opens", async () => {
    render(<App />);
    await waitFor(() => expect(mockCheckHealthStatus).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("build-mismatch-notice")).toBeNull();

    mockCheckHealthStatus.mockResolvedValueOnce({
      ok: true,
      buildId: "backend-after-reconnect",
      servedFrontendBuildId: "backend-after-reconnect",
    });
    window.dispatchEvent(new Event(BACKEND_CONNECTION_OPEN_EVENT));

    expect(await screen.findByRole("alert", { name: "Frontend update required" })).toBeInTheDocument();
    expect(mockCheckHealthStatus).toHaveBeenCalledTimes(2);
  });

  it("resolves readable message deep links through raw history index before selecting and scrolling", async () => {
    resetStore({
      currentSessionId: null,
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          archived: false,
          cwd: "/repo/s1",
          backendType: "claude",
          sessionNum: 123,
        },
      ],
      messages: new Map([
        [
          "s1",
          [
            { id: "m0", historyIndex: 0 },
            // Raw history index 1 can be a non-rendered entry such as tool_result_preview.
            { id: "m2", historyIndex: 2 },
          ],
        ],
      ]),
      sessions: new Map([["s1", { backend_type: "claude" }]]),
    });
    window.location.hash = "#/session/123/msg/2";

    render(<App />);

    await waitFor(() => {
      expect(mockState.setCurrentSession).toHaveBeenCalledWith("s1");
      expect(mockConnectSession).toHaveBeenCalledWith("s1");
      expect(mockState.requestScrollToMessage).toHaveBeenCalledWith("s1", "m2");
      expect(mockState.setExpandAllInTurn).toHaveBeenCalledWith("s1", "m2");
    });
    expect(screen.getByTestId("chat-view")).toHaveAttribute("data-session-id", "s1");
    expect(mockConnectSession).not.toHaveBeenCalledWith("123");
  });

  it("resolves stable message-id routes and preserves leader thread context", async () => {
    resetStore({
      currentSessionId: null,
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          archived: false,
          cwd: "/repo/s1",
          backendType: "codex",
          sessionNum: 123,
          isOrchestrator: true,
        },
      ],
      sessions: new Map([["s1", { backend_type: "codex", isOrchestrator: true } as any]]),
    });
    window.location.hash = "#/session/123/msg/stable-thread-message?thread=q-1622";

    render(<App />);

    await waitFor(() => {
      expect(mockState.setCurrentSession).toHaveBeenCalledWith("s1");
      expect(mockConnectSession).toHaveBeenCalledWith("s1");
      expect(mockState.setPendingScrollToMessageId).toHaveBeenCalledWith("s1", "stable-thread-message");
      expect(mockState.requestScrollToMessage).toHaveBeenCalledWith("s1", "stable-thread-message");
      expect(mockState.setExpandAllInTurn).toHaveBeenCalledWith("s1", "stable-thread-message");
    });
    expect(screen.getByTestId("chat-view")).toHaveAttribute("data-route-thread-key", "q-1622");
    expect(mockConnectSession).not.toHaveBeenCalledWith("123");
  });

  it("arms stable message-id route scrolling only once for the same hash", async () => {
    const sdkSession = {
      sessionId: "s1",
      createdAt: 1,
      archived: false,
      cwd: "/repo/s1",
      backendType: "codex" as const,
      sessionNum: 123,
      isOrchestrator: true,
    };
    resetStore({
      currentSessionId: null,
      sdkSessions: [sdkSession],
      sessions: new Map([["s1", { backend_type: "codex", isOrchestrator: true } as any]]),
    });
    window.location.hash = "#/session/123/msg/stable-thread-message?thread=q-1622";

    const view = render(<App />);

    await waitFor(() => {
      expect(mockState.requestScrollToMessage).toHaveBeenCalledWith("s1", "stable-thread-message");
    });
    expect(mockState.requestScrollToMessage).toHaveBeenCalledTimes(1);
    expect(mockState.setPendingScrollToMessageId).toHaveBeenCalledTimes(1);
    expect(mockState.setExpandAllInTurn).toHaveBeenCalledTimes(1);

    mockState.sdkSessions = [{ ...sdkSession, lastActivityAt: 2 }];
    view.rerender(<App />);

    await waitFor(() => expect(screen.getByTestId("chat-view")).toHaveAttribute("data-route-thread-key", "q-1622"));
    expect(mockState.requestScrollToMessage).toHaveBeenCalledTimes(1);
    expect(mockState.setPendingScrollToMessageId).toHaveBeenCalledTimes(1);
    expect(mockState.setExpandAllInTurn).toHaveBeenCalledTimes(1);
  });

  it("does not re-arm a retired search route on Browser Back but allows a fresh reopen", async () => {
    const sdkSessions = [
      {
        sessionId: "s1",
        createdAt: 1,
        archived: false,
        cwd: "/repo/s1",
        backendType: "codex" as const,
        sessionNum: 123,
        isOrchestrator: true,
      },
      {
        sessionId: "s2",
        createdAt: 2,
        archived: false,
        cwd: "/repo/s2",
        backendType: "codex" as const,
        sessionNum: 456,
        isOrchestrator: true,
      },
    ];
    resetStore({
      currentSessionId: null,
      sdkSessions,
      sessions: new Map([
        ["s1", { backend_type: "codex", isOrchestrator: true } as any],
        ["s2", { backend_type: "codex", isOrchestrator: true } as any],
      ]),
    });
    history.replaceState(null, "", "#/session/123/msg/stable-search-target?thread=main");

    render(<App />);

    await waitFor(() => expect(mockState.requestScrollToMessage).toHaveBeenCalledTimes(1));
    expect(retireSessionMessageRoute("s1", "main")).toBe(true);
    expect(window.location.hash).toBe("#/session/123?thread=main");
    const consumedRequestCount = mockState.requestScrollToMessage.mock.calls.length;

    window.location.hash = "/session/456";
    await waitFor(() => expect(screen.getByTestId("chat-view")).toHaveAttribute("data-session-id", "s2"));
    history.back();
    await waitFor(() => expect(window.location.hash).toBe("#/session/123?thread=main"));
    await waitFor(() => expect(screen.getByTestId("chat-view")).toHaveAttribute("data-session-id", "s1"));
    expect(mockState.requestScrollToMessage).toHaveBeenCalledTimes(consumedRequestCount);

    window.location.hash = "/session/123/msg/stable-search-target?thread=main";
    await waitFor(() => expect(mockState.requestScrollToMessage).toHaveBeenCalledTimes(consumedRequestCount + 1));
    expect(mockState.setPendingScrollToMessageId).toHaveBeenLastCalledWith("s1", "stable-search-target");
  });

  it("starts a cheap git status refresh when switching to a worktree session", async () => {
    resetStore({
      currentSessionId: "s1",
      sdkSessions: [
        { sessionId: "s1", createdAt: 1, archived: false, cwd: "/repo/s1", backendType: "claude", isWorktree: true },
        { sessionId: "s2", createdAt: 2, archived: false, cwd: "/repo/s2", backendType: "claude", isWorktree: true },
      ],
      sessions: new Map([
        ["s1", { backend_type: "claude", is_worktree: true } as any],
        ["s2", { backend_type: "claude", is_worktree: true } as any],
      ]),
    });
    window.location.hash = "#/session/s2";

    render(<App />);

    await waitFor(() => {
      expect(mockConnectSession).toHaveBeenCalledWith("s2");
      expect(mockRefreshSessionGitStatus).toHaveBeenCalledWith("s2", { force: false });
    });
  });

  it("does not show a fake session for an unresolved numeric message deep link", () => {
    resetStore({ currentSessionId: null, sdkSessions: [], sessions: new Map(), messages: new Map() });
    window.location.hash = "#/session/123/msg/2";

    render(<App />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-view")).toBeNull();
    expect(screen.queryByTestId("session-creation-view")).toBeNull();
    expect(mockState.setCurrentSession).not.toHaveBeenCalledWith("123");
    expect(mockConnectSession).not.toHaveBeenCalledWith("123");
  });

  it("falls back to bounded archived search for archived numeric routes", async () => {
    const archivedSession = {
      sessionId: "archived-route",
      createdAt: 2,
      archived: true,
      cwd: "/repo/archived",
      backendType: "claude" as const,
      sessionNum: 123,
    };
    resetStore({ currentSessionId: null, sdkSessions: [], sessions: new Map(), messages: new Map() });
    mockListSessions.mockResolvedValueOnce([]);
    mockSearchSessions.mockResolvedValueOnce({
      query: "#123",
      tookMs: 1,
      totalMatches: 1,
      results: [
        {
          sessionId: "archived-route",
          score: 1100,
          matchedField: "session_number",
          matchContext: null,
          matchedAt: 2,
          session: archivedSession,
        },
      ],
    });
    vi.mocked(hydrateSessionList).mockImplementation((sessions) => {
      mockState.sdkSessions = sessions as MockStoreState["sdkSessions"];
    });
    window.location.hash = "#/session/123";

    const view = render(<App />);

    await waitFor(() => expect(mockListSessions).toHaveBeenNthCalledWith(1, { includeArchived: false }));
    await waitFor(() =>
      expect(mockSearchSessions).toHaveBeenCalledWith("#123", {
        includeArchived: true,
        includeReviewers: true,
        limit: 10,
      }),
    );
    expect(hydrateSessionList).toHaveBeenNthCalledWith(1, [], {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: 1,
    });
    expect(hydrateSessionList).toHaveBeenNthCalledWith(2, [archivedSession], { preserveMissingSessions: true });

    view.rerender(<App />);

    await waitFor(() => {
      expect(mockState.setCurrentSession).toHaveBeenCalledWith("archived-route");
      expect(mockConnectSession).toHaveBeenCalledWith("archived-route");
    });
  });

  it("cleans up preview mode when searchPreviewSessionId is cleared", () => {
    resetStore({
      currentSessionId: "s1",
      searchPreviewSessionId: "s2",
      connectionStatus: new Map([
        ["s1", "connected"],
        ["s2", "disconnected"],
      ]),
      sessions: new Map([
        ["s1", { backend_type: "claude" }],
        ["s2", { backend_type: "claude" }],
      ]),
    });
    window.location.hash = "#/session/s1";

    const view = render(<App />);
    expect(screen.getByTestId("chat-view")).toHaveAttribute("data-session-id", "s2");

    resetStore({
      currentSessionId: "s1",
      searchPreviewSessionId: null,
      connectionStatus: new Map([["s1", "connected"]]),
      sessions: new Map([["s1", { backend_type: "claude" }]]),
    });
    view.rerender(<App />);

    const chatView = screen.getByTestId("chat-view");
    expect(chatView).toHaveAttribute("data-session-id", "s1");
    expect(chatView).toHaveAttribute("data-preview", "false");
    expect(mockDisconnectSession).toHaveBeenCalledWith("s2");
  });

  it("ignores the old Standard search shortcut inside inputs", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      sidebarOpen: false,
    });
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(input, { key: "f", ctrlKey: true });

    expect(mockState.openSessionSearch).not.toHaveBeenCalled();
    expect(mockState.setSidebarOpen).not.toHaveBeenCalled();
    input.remove();
  });

  it("triggers session switching even when focus is inside an input", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      currentSessionId: "s1",
      connectionStatus: new Map([
        ["s1", "connected"],
        ["s2", "connected"],
      ]),
      cliConnected: new Map([
        ["s1", true],
        ["s2", true],
      ]),
      sessionStatus: new Map([
        ["s1", "idle"],
        ["s2", "idle"],
      ]),
      sessions: new Map([
        ["s1", { backend_type: "claude" }],
        ["s2", { backend_type: "claude" }],
      ]),
      sdkSessions: [
        { sessionId: "s1", createdAt: 2, archived: false, cwd: "/repo/s1", backendType: "claude" },
        { sessionId: "s2", createdAt: 1, archived: false, cwd: "/repo/s2", backendType: "claude" },
      ],
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map([["default", ["s1", "s2"]]]),
    });
    window.location.hash = "#/session/s1";
    render(<App />);

    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "}",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(window.location.hash).toBe("#/session/s2");
    input.remove();
  });

  it("triggers terminal open even when focus is inside the session input", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      currentSessionId: "s1",
      sessions: new Map([["s1", { backend_type: "claude", cwd: "/repo/s1" }]]),
      sdkSessions: [{ sessionId: "s1", createdAt: 1, archived: false, cwd: "/repo/s1", backendType: "claude" }],
    });
    window.location.hash = "#/session/s1";
    render(<App />);

    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "T",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(mockState.openTerminal).toHaveBeenCalledWith("/repo/s1", "s1");
    expect(window.location.hash).toBe("#/terminal");
    input.remove();
  });

  it("triggers terminal return even when focus is inside the terminal input", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      currentSessionId: "s1",
      terminalCwd: "/repo/s1",
      sessions: new Map([["s1", { backend_type: "claude", cwd: "/repo/s1" }]]),
      sdkSessions: [{ sessionId: "s1", createdAt: 1, archived: false, cwd: "/repo/s1", backendType: "claude" }],
    });
    window.location.hash = "#/terminal";
    render(<App />);

    const input = document.createElement("textarea");
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "T",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(window.location.hash).toBe("#/session/s1");
    expect(mockState.setActiveTab).toHaveBeenCalledWith("chat");
    input.remove();
  });

  it("keeps non-global shortcuts blocked while focus is inside an input", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      currentSessionId: "s1",
    });
    window.location.hash = "#/session/s1";
    render(<App />);

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    const event = new KeyboardEvent("keydown", {
      key: "b",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId("universal-search-overlay")).toBeNull();
    expect(mockState.openSessionSearch).not.toHaveBeenCalled();
    expect(mockState.setSidebarOpen).not.toHaveBeenCalled();
    input.remove();
  });

  it("runs single-tap modifier shortcuts through the global matcher", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: { toggle_sidebar: "Tap:Shift" } },
      currentSessionId: "s1",
      sidebarOpen: false,
    });
    window.location.hash = "#/session/s1";
    render(<App />);

    fireEvent.keyDown(document, { key: "Shift", shiftKey: true });
    fireEvent.keyUp(document, { key: "Shift" });

    expect(mockState.setSidebarOpen).toHaveBeenCalledWith(true);
  });

  it("skips sessions hidden by collapsed herd rows when switching sessions", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
      currentSessionId: "leader",
      connectionStatus: new Map([
        ["leader", "connected"],
        ["worker-hidden", "connected"],
        ["standalone", "connected"],
      ]),
      cliConnected: new Map([
        ["leader", true],
        ["worker-hidden", true],
        ["standalone", true],
      ]),
      sessionStatus: new Map([
        ["leader", "idle"],
        ["worker-hidden", "idle"],
        ["standalone", "idle"],
      ]),
      sessions: new Map([
        ["leader", { backend_type: "claude" }],
        ["worker-hidden", { backend_type: "claude" }],
        ["standalone", { backend_type: "claude" }],
      ]),
      sdkSessions: [
        {
          sessionId: "leader",
          createdAt: 3,
          archived: false,
          cwd: "/repo/leader",
          backendType: "claude",
          isOrchestrator: true,
          sessionNum: 10,
        },
        {
          sessionId: "worker-hidden",
          createdAt: 2,
          archived: false,
          cwd: "/repo/worker-hidden",
          backendType: "claude",
          herdedBy: "leader",
          sessionNum: 11,
        },
        {
          sessionId: "standalone",
          createdAt: 1,
          archived: false,
          cwd: "/repo/standalone",
          backendType: "claude",
          sessionNum: 12,
        },
      ],
      treeGroups: [{ id: "default", name: "Default" }],
      treeAssignments: new Map(),
      treeNodeOrder: new Map([["default", ["leader", "standalone"]]]),
      expandedHerdNodes: new Set(),
    });
    window.location.hash = "#/session/leader";
    render(<App />);

    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "}",
        code: "BracketRight",
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(window.location.hash).toBe("#/session/standalone");
    expect(window.location.hash).not.toBe("#/session/worker-hidden");
  });
});
