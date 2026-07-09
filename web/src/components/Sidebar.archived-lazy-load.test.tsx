// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { MouseEvent } from "react";
import type { SdkSessionInfo } from "../types.js";

const mockApi = {
  listSessions: vi.fn().mockResolvedValue([]),
  listArchivedSessionsPage: vi.fn().mockResolvedValue({
    sessions: [],
    total: 0,
    offset: 0,
    limit: 25,
    hasMore: false,
    nextOffset: null,
  }),
  searchSessions: vi.fn().mockResolvedValue({ query: "", tookMs: 0, totalMatches: 0, results: [] }),
  getSettings: vi.fn().mockResolvedValue({ serverName: "" }),
  getTreeGroups: vi.fn().mockResolvedValue({ groups: [], assignments: {}, nodeOrder: {} }),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  retryWorktreeCleanup: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock("../api.js", () => ({
  api: {
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    listArchivedSessionsPage: (...args: unknown[]) => mockApi.listArchivedSessionsPage(...args),
    searchSessions: (...args: unknown[]) => mockApi.searchSessions(...args),
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getTreeGroups: (...args: unknown[]) => mockApi.getTreeGroups(...args),
    markSessionRead: (...args: unknown[]) => mockApi.markSessionRead(...args),
    retryWorktreeCleanup: (...args: unknown[]) => mockApi.retryWorktreeCleanup(...args),
    deleteSession: vi.fn().mockResolvedValue({}),
    archiveSession: vi.fn().mockResolvedValue({}),
    archiveGroup: vi.fn().mockResolvedValue({ ok: true, archived: 0, failed: 0 }),
    unarchiveSession: vi.fn().mockResolvedValue({}),
    createTreeGroup: vi.fn().mockResolvedValue({ ok: true }),
    assignSessionToTreeGroup: vi.fn().mockResolvedValue({ ok: true }),
    assignSessionsToTreeGroup: vi.fn().mockResolvedValue({ ok: true }),
    herdWorkerToLeader: vi
      .fn()
      .mockResolvedValue({ herded: [], notFound: [], conflicts: [], reassigned: [], leaders: [] }),
    updateSettings: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("../ws.js", () => ({
  connectSession: vi.fn(),
  disconnectSession: vi.fn(),
}));

vi.mock("../utils/copy-utils.js", () => ({
  writeClipboardText: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/pending-creation.js", () => ({
  cancelPendingCreation: vi.fn(),
}));

vi.mock("./SessionItem.js", () => ({
  SessionItem: ({
    session,
    sessionName,
    onRetryWorktreeCleanup,
  }: {
    session: {
      id: string;
      archived?: boolean;
      isWorktree?: boolean;
      model?: string | null;
      worktreeCleanupStatus?: string;
      worktreeExists?: boolean;
    };
    sessionName?: string;
    onRetryWorktreeCleanup?: (event: MouseEvent, sessionId: string) => void;
  }) => (
    <div data-testid="session-row" data-session-id={session.id}>
      <button type="button" data-testid="session-item" data-session-id={session.id}>
        {sessionName ?? session.model ?? session.id}
      </button>
      {session.archived &&
        session.isWorktree &&
        session.worktreeExists === true &&
        session.worktreeCleanupStatus !== "pending" &&
        onRetryWorktreeCleanup && (
          <button type="button" onClick={(event) => onRetryWorktreeCleanup(event, session.id)}>
            Retry worktree cleanup
          </button>
        )}
    </div>
  ),
}));

interface MockStoreState {
  [key: string]: unknown;
  sdkSessions: SdkSessionInfo[];
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  sessionTaskHistory: Map<string, any[]>;
  sessionKeywords: Map<string, string[]>;
  sessionNotifications: Map<string, any[]>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  setSdkSessions: ReturnType<typeof vi.fn>;
  updateSdkSession: ReturnType<typeof vi.fn>;
}

let mockState: MockStoreState;

function makeSdkSession(id: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: id,
    state: "connected",
    cwd: "/repo",
    createdAt: Date.now(),
    archived: false,
    ...overrides,
  };
}

function createMockState(): MockStoreState {
  return {
    sessions: new Map(),
    sdkSessions: [],
    currentSessionId: null,
    cliConnected: new Map(),
    cliDisconnectReason: new Map(),
    sessionStatus: new Map(),
    sessionNames: new Map(),
    recentlyRenamed: new Set(),
    sessionPreviews: new Map(),
    sessionTaskHistory: new Map(),
    sessionKeywords: new Map(),
    sessionNotifications: new Map(),
    sessionAttention: new Map(),
    pendingPermissions: new Map(),
    askPermission: new Map(),
    reorderMode: false,
    sessionSortMode: "created",
    treeGroups: [],
    treeAssignments: new Map(),
    treeNodeOrder: new Map(),
    collapsedTreeGroups: new Set(),
    collapsedTreeNodes: new Set(),
    expandedHerdNodes: new Set(),
    pendingSessions: new Map(),
    diffFileStats: new Map(),
    serverName: "",
    zoomLevel: 1,
    shortcutSettings: { enabled: false, preset: "standard", overrides: {} },
    quests: [],
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    sessionTimers: new Map(),
    setCurrentSession: vi.fn(),
    removeSession: vi.fn(),
    clearRecentlyRenamed: vi.fn(),
    setReorderMode: vi.fn(),
    setSessionSortMode: vi.fn(),
    toggleTreeGroupCollapse: vi.fn(),
    toggleTreeNodeCollapse: vi.fn(),
    toggleHerdNodeExpand: vi.fn(),
    setServerName: vi.fn(),
    setSearchPreviewSessionId: vi.fn(),
    setSidebarOpen: vi.fn(),
    openTerminal: vi.fn(),
    openNewSessionModal: vi.fn(),
    closeNewSessionModal: vi.fn(),
    markSessionViewed: vi.fn(),
    markSessionUnread: vi.fn(),
    markAllSessionsViewed: vi.fn(),
    clearSessionAttention: vi.fn(),
    setTreeGroups: vi.fn(),
    focusComposer: vi.fn(),
    markRecentlyRenamed: vi.fn(),
    markQuestNamed: vi.fn(),
    clearQuestNamed: vi.fn(),
    setSessionName: vi.fn((sessionId: string, name: string) => mockState.sessionNames.set(sessionId, name)),
    setSessionPreview: vi.fn((sessionId: string, preview: string) => mockState.sessionPreviews.set(sessionId, preview)),
    setSessionTaskHistory: vi.fn((sessionId: string, history: any[]) =>
      mockState.sessionTaskHistory.set(sessionId, history),
    ),
    setSessionKeywords: vi.fn((sessionId: string, keywords: string[]) =>
      mockState.sessionKeywords.set(sessionId, keywords),
    ),
    setSessionBoard: vi.fn(),
    setSdkSessions: vi.fn((sessions: SdkSessionInfo[]) => {
      mockState.sdkSessions = sessions;
    }),
    updateSdkSession: vi.fn((sessionId: string, updates: Partial<SdkSessionInfo>) => {
      mockState.sdkSessions = mockState.sdkSessions.map((session) =>
        session.sessionId === sessionId ? { ...session, ...updates } : session,
      );
    }),
  };
}

vi.mock("../store.js", () => {
  const useStore = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStore.getState = () => mockState;
  useStore.setState = (patch: Partial<MockStoreState> | ((state: MockStoreState) => Partial<MockStoreState>)) => {
    const next = typeof patch === "function" ? patch(mockState) : patch;
    mockState = { ...mockState, ...next };
  };
  return {
    useStore,
    countUserPermissions: () => 0,
    hydrateChatDisplaySettingsFromServer: vi.fn(),
    hydrateShortcutSettingsFromServer: vi.fn().mockResolvedValue(undefined),
  };
});

import { Sidebar } from "./Sidebar.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockState = createMockState();
  mockApi.listSessions.mockResolvedValue([]);
  mockApi.listArchivedSessionsPage.mockResolvedValue({
    sessions: [],
    total: 0,
    offset: 0,
    limit: 25,
    hasMore: false,
    nextOffset: null,
  });
  mockApi.retryWorktreeCleanup.mockResolvedValue({ ok: true });
  window.location.hash = "";
});

it("keeps Archived visible on all-archived cold starts and renders rows from the first archived page", async () => {
  const archived = makeSdkSession("archived-1", {
    archived: true,
    name: "Archived Only",
    model: "codex",
  });
  mockApi.listSessions.mockResolvedValue([]);
  mockApi.listArchivedSessionsPage.mockResolvedValueOnce({
    sessions: [archived],
    total: 1052,
    offset: 0,
    limit: 25,
    hasMore: true,
    nextOffset: 1,
  });

  const view = render(<Sidebar />);

  expect(screen.getByText("Archived")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Archived"));

  await waitFor(() => expect(mockApi.listArchivedSessionsPage).toHaveBeenCalledWith({ offset: 0, limit: 25 }));
  expect(mockApi.listSessions).not.toHaveBeenCalledWith({ includeArchived: true });
  await waitFor(() =>
    expect(mockState.setSdkSessions).toHaveBeenLastCalledWith([expect.objectContaining({ archived: true })]),
  );

  view.rerender(<Sidebar />);

  expect(screen.getByText("Archived (1052)")).toBeInTheDocument();
  expect(screen.getByTestId("session-item")).toHaveAttribute("data-session-id", "archived-1");
  expect(screen.getByText("Archived Only")).toBeInTheDocument();
  expect(screen.getByText("Load more archived sessions")).toBeInTheDocument();
});

it("does not infer the archived count from cached rows before the page loads", () => {
  mockState.sdkSessions = [
    makeSdkSession("active-1", { archived: false }),
    makeSdkSession("archived-1", { archived: true }),
    makeSdkSession("archived-2", { archived: true }),
  ];

  render(<Sidebar />);

  expect(screen.getByText("Archived")).toBeInTheDocument();
  expect(screen.queryByText("Archived (2)")).not.toBeInTheDocument();
});

it("loads additional archived pages without replacing active session rows", async () => {
  const active = makeSdkSession("active-1", { name: "Active Session" });
  const firstArchived = makeSdkSession("archived-1", { archived: true, name: "First Archived", model: "codex" });
  const secondArchived = makeSdkSession("archived-2", { archived: true, name: "Second Archived", model: "codex" });
  mockState.sdkSessions = [active];
  mockApi.listSessions.mockResolvedValue([active]);
  mockApi.listArchivedSessionsPage
    .mockResolvedValueOnce({
      sessions: [firstArchived],
      total: 2,
      offset: 0,
      limit: 25,
      hasMore: true,
      nextOffset: 1,
    })
    .mockResolvedValueOnce({
      sessions: [secondArchived],
      total: 2,
      offset: 1,
      limit: 25,
      hasMore: false,
      nextOffset: null,
    });

  const view = render(<Sidebar />);
  fireEvent.click(screen.getByText("Archived"));
  await waitFor(() => expect(mockApi.listArchivedSessionsPage).toHaveBeenCalledWith({ offset: 0, limit: 25 }));
  view.rerender(<Sidebar />);
  fireEvent.click(screen.getByText("Load more archived sessions"));
  await waitFor(() => expect(mockApi.listArchivedSessionsPage).toHaveBeenCalledWith({ offset: 1, limit: 25 }));
  view.rerender(<Sidebar />);

  expect(mockState.sdkSessions.map((session) => session.sessionId)).toEqual(
    expect.arrayContaining(["active-1", "archived-1", "archived-2"]),
  );
  expect(screen.getByText("First Archived")).toBeInTheDocument();
  expect(screen.getByText("Second Archived")).toBeInTheDocument();
  expect(screen.queryByText("Load more archived sessions")).not.toBeInTheDocument();
});

it("reconciles archived worktree retry state from the retry response without reload", async () => {
  let setTimeoutSpy: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const archived = makeSdkSession("archived-1", {
      archived: true,
      isWorktree: true,
      worktreeExists: true,
      worktreeCleanupStatus: "failed",
      worktreeCleanupError: "simulated cleanup failure",
      name: "Archived Worktree",
      model: "codex",
    });
    const pendingCandidate = {
      sessionId: "archived-1",
      sessionNum: 7,
      name: "Archived Worktree",
      archivedAt: 1,
      repoRoot: "/repo",
      branch: "main",
      actualBranch: "main-wt-1",
      worktreePath: "/tmp/main-wt-1",
      cleanupStatus: "pending",
      cleanupError: null,
      cleanupStartedAt: 2,
      cleanupFinishedAt: null,
      exists: true,
      inUseBy: [],
      retryable: false,
      owned: true,
      ownershipReason: "takode-worktree-root",
      safety: { status: "blocked", summary: "cleanup is already pending" },
    };
    mockApi.listSessions.mockResolvedValue([]);
    mockApi.listArchivedSessionsPage.mockResolvedValueOnce({
      sessions: [archived],
      total: 1,
      offset: 0,
      limit: 25,
      hasMore: false,
      nextOffset: null,
    });
    mockApi.retryWorktreeCleanup.mockResolvedValueOnce({
      ok: true,
      cleanup: { status: "pending", path: "/tmp/main-wt-1" },
      candidate: pendingCandidate,
    });

    const view = render(<Sidebar />);
    fireEvent.click(screen.getByText("Archived"));
    await waitFor(() => expect(mockApi.listArchivedSessionsPage).toHaveBeenCalledWith({ offset: 0, limit: 25 }));
    expect(mockApi.listSessions).not.toHaveBeenCalledWith({ includeArchived: true });
    await waitFor(() =>
      expect(mockState.setSdkSessions).toHaveBeenLastCalledWith([expect.objectContaining({ archived: true })]),
    );
    view.rerender(<Sidebar />);
    expect(screen.getByText("Retry worktree cleanup")).toBeInTheDocument();

    setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(() => 0 as unknown as ReturnType<typeof window.setTimeout>);
    fireEvent.click(screen.getByText("Retry worktree cleanup"));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockState.updateSdkSession).toHaveBeenCalledWith(
      "archived-1",
      expect.objectContaining({ worktreeCleanupStatus: "pending" }),
    );
    expect(mockState.sdkSessions[0]?.worktreeCleanupStatus).toBe("pending");

    view.rerender(<Sidebar />);
    expect(screen.queryByText("Retry worktree cleanup")).not.toBeInTheDocument();
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1500);
  } finally {
    setTimeoutSpy?.mockRestore();
  }
});
