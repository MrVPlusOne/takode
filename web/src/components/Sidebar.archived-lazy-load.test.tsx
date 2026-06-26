// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SdkSessionInfo } from "../types.js";

const mockApi = {
  listSessions: vi.fn().mockResolvedValue([]),
  searchSessions: vi.fn().mockResolvedValue({ query: "", tookMs: 0, totalMatches: 0, results: [] }),
  getSettings: vi.fn().mockResolvedValue({ serverName: "" }),
  getTreeGroups: vi.fn().mockResolvedValue({ groups: [], assignments: {}, nodeOrder: {} }),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock("../api.js", () => ({
  api: {
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    searchSessions: (...args: unknown[]) => mockApi.searchSessions(...args),
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    getTreeGroups: (...args: unknown[]) => mockApi.getTreeGroups(...args),
    markSessionRead: (...args: unknown[]) => mockApi.markSessionRead(...args),
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
  SessionItem: ({ session, sessionName }: { session: { id: string; model?: string | null }; sessionName?: string }) => (
    <button type="button" data-testid="session-item" data-session-id={session.id}>
      {sessionName ?? session.model ?? session.id}
    </button>
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
  window.location.hash = "";
});

it("keeps Archived visible on all-archived cold starts and renders rows from the full backend fetch", async () => {
  const archived = makeSdkSession("archived-1", {
    archived: true,
    name: "Archived Only",
    model: "codex",
  });
  mockApi.listSessions.mockResolvedValueOnce([]).mockResolvedValueOnce([archived]);

  const view = render(<Sidebar />);

  expect(screen.getByText("Archived")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Archived"));

  await waitFor(() => expect(mockApi.listSessions).toHaveBeenCalledWith({ includeArchived: true }));
  await waitFor(() =>
    expect(mockState.setSdkSessions).toHaveBeenLastCalledWith([expect.objectContaining({ archived: true })]),
  );

  view.rerender(<Sidebar />);

  expect(screen.getByText("Archived (1)")).toBeInTheDocument();
  expect(screen.getByTestId("session-item")).toHaveAttribute("data-session-id", "archived-1");
  expect(screen.getByText("Archived Only")).toBeInTheDocument();
});
