// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionState, SdkSessionInfo } from "../types.js";

const mockConnectSession = vi.fn();
const mockConnectAllSessions = vi.fn();
const mockDisconnectSession = vi.fn();
const mockScrollIntoView = vi.fn();

vi.mock("../ws.js", () => ({
  connectSession: (...args: unknown[]) => mockConnectSession(...args),
  connectAllSessions: (...args: unknown[]) => mockConnectAllSessions(...args),
  disconnectSession: (...args: unknown[]) => mockDisconnectSession(...args),
}));

vi.mock("../utils/pending-creation.js", () => ({
  cancelPendingCreation: vi.fn(),
}));

const mockApi = {
  listSessions: vi.fn().mockResolvedValue([]),
  searchSessions: vi.fn().mockResolvedValue({ query: "", tookMs: 0, totalMatches: 0, results: [] }),
  deleteSession: vi.fn().mockResolvedValue({}),
  archiveSession: vi.fn().mockResolvedValue({}),
  archiveGroup: vi.fn().mockResolvedValue({ ok: true, archived: 1, failed: 0 }),
  unarchiveSession: vi.fn().mockResolvedValue({}),
  relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
  updateSessionConfig: vi.fn().mockResolvedValue({ ok: true, restartRequired: false, session: {}, sessionState: {} }),
  getBackendModels: vi.fn().mockResolvedValue([]),
  createTreeGroup: vi.fn().mockResolvedValue({ ok: true, group: { id: "group-2", name: "Group 2" } }),
  assignSessionToTreeGroup: vi.fn().mockResolvedValue({ ok: true }),
  assignSessionsToTreeGroup: vi.fn().mockResolvedValue({ ok: true }),
  herdWorkerToLeader: vi
    .fn()
    .mockResolvedValue({ herded: ["worker-1"], notFound: [], conflicts: [], reassigned: [], leaders: [] }),
  getSettings: vi.fn().mockResolvedValue({ serverName: "" }),
  updateSettings: vi.fn().mockResolvedValue({}),
  getTreeGroups: vi
    .fn()
    .mockResolvedValue({ groups: [{ id: "default", name: "Default" }], assignments: {}, nodeOrder: {} }),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
};

vi.mock("../api.js", () => ({
  api: {
    listSessions: (...args: unknown[]) => mockApi.listSessions(...args),
    searchSessions: (...args: unknown[]) => mockApi.searchSessions(...args),
    deleteSession: (...args: unknown[]) => mockApi.deleteSession(...args),
    archiveSession: (...args: unknown[]) => mockApi.archiveSession(...args),
    archiveGroup: (...args: unknown[]) => mockApi.archiveGroup(...args),
    unarchiveSession: (...args: unknown[]) => mockApi.unarchiveSession(...args),
    relaunchSession: (...args: unknown[]) => mockApi.relaunchSession(...args),
    updateSessionConfig: (...args: unknown[]) => mockApi.updateSessionConfig(...args),
    getBackendModels: (...args: unknown[]) => mockApi.getBackendModels(...args),
    createTreeGroup: (...args: unknown[]) => mockApi.createTreeGroup(...args),
    assignSessionToTreeGroup: (...args: unknown[]) => mockApi.assignSessionToTreeGroup(...args),
    assignSessionsToTreeGroup: (...args: unknown[]) => mockApi.assignSessionsToTreeGroup(...args),
    herdWorkerToLeader: (...args: unknown[]) => mockApi.herdWorkerToLeader(...args),
    getSettings: (...args: unknown[]) => mockApi.getSettings(...args),
    updateSettings: (...args: unknown[]) => mockApi.updateSettings(...args),
    getTreeGroups: (...args: unknown[]) => mockApi.getTreeGroups(...args),
    markSessionRead: (...args: unknown[]) => mockApi.markSessionRead(...args),
  },
}));

const mockWriteClipboardText = vi.fn().mockResolvedValue(undefined);
vi.mock("../utils/copy-utils.js", () => ({
  writeClipboardText: (...args: unknown[]) => mockWriteClipboardText(...args),
}));

interface MockStoreState {
  sessions: Map<string, SessionState>;
  sdkSessions: SdkSessionInfo[];
  currentSessionId: string | null;
  cliConnected: Map<string, boolean>;
  [key: string]: unknown;
}

function makeSession(id: string, overrides: Partial<SessionState> = {}): SessionState {
  return {
    session_id: id,
    model: "claude-sonnet-4-5-20250929",
    cwd: "/home/user/projects/myapp",
    tools: [],
    permissionMode: "default",
    claude_code_version: "1.0",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...overrides,
  };
}

function makeSdkSession(id: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: id,
    state: "connected",
    cwd: "/home/user/projects/myapp",
    createdAt: Date.now(),
    archived: false,
    ...overrides,
  };
}

let mockState: MockStoreState;

function createMockState(overrides: Partial<MockStoreState> = {}): MockStoreState {
  return {
    sessions: new Map(),
    sdkSessions: [],
    currentSessionId: null,
    cliConnected: new Map(),
    cliDisconnectReason: new Map(),
    sessionStatus: new Map(),
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    sessionPreviewUpdatedAt: new Map(),
    sessionTaskPreview: new Map(),
    sessionTaskHistory: new Map(),
    sessionKeywords: new Map(),
    sessionNotifications: new Map(),
    recentlyRenamed: new Set(),
    questNamedSessions: new Set(),
    pendingPermissions: new Map(),
    sessionAttention: new Map(),
    diffFileStats: new Map(),
    shortcutSettings: { enabled: false, preset: "standard", overrides: {} },
    searchPreviewSessionId: null,
    sessionInfoOpenSessionId: null,
    reorderMode: false,
    setReorderMode: vi.fn(),
    sessionSortMode: "created",
    setSessionSortMode: vi.fn(),
    pendingSessions: new Map(),
    serverName: "",
    treeGroups: [],
    treeAssignments: new Map(),
    treeNodeOrder: new Map(),
    collapsedTreeGroups: new Set(),
    collapsedTreeNodes: new Set(),
    expandedHerdNodes: new Set(),
    toggleTreeGroupCollapse: vi.fn(),
    toggleTreeNodeCollapse: vi.fn(),
    toggleHerdNodeExpand: vi.fn(),
    setServerName: vi.fn(),
    setSearchPreviewSessionId: vi.fn(),
    setCurrentSession: vi.fn(),
    removeSession: vi.fn(),
    newSession: vi.fn(),
    setSidebarOpen: vi.fn(),
    setSessionName: vi.fn(),
    setSessionPreview: vi.fn(),
    setSessionTaskHistory: vi.fn(),
    setSessionKeywords: vi.fn(),
    markRecentlyRenamed: vi.fn(),
    clearRecentlyRenamed: vi.fn(),
    setSdkSessions: vi.fn(),
    updateSession: vi.fn(),
    updateSdkSession: vi.fn(),
    closeTerminal: vi.fn(),
    openNewSessionModal: vi.fn(),
    closeNewSessionModal: vi.fn(),
    markSessionViewed: vi.fn(),
    markAllSessionsViewed: vi.fn(),
    markSessionUnread: vi.fn(),
    clearSessionAttention: vi.fn(),
    setTreeGroups: vi.fn(),
    focusComposer: vi.fn(),
    ...overrides,
  };
}

vi.mock("../store.js", () => {
  const useStoreFn = (selector: (state: MockStoreState) => unknown) => selector(mockState);
  useStoreFn.getState = () => mockState;
  useStoreFn.setState = (patch: Partial<MockStoreState>) => {
    mockState = { ...mockState, ...patch };
  };
  return {
    useStore: useStoreFn,
    countUserPermissions: (perms: Map<string, unknown> | undefined) => perms?.size ?? 0,
    hydrateChatDisplaySettingsFromServer: vi.fn(),
    hydrateShortcutSettingsFromServer: vi.fn().mockResolvedValue(undefined),
  };
});

import { Sidebar } from "./Sidebar.js";

describe("Sidebar session context menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = mockScrollIntoView;
    mockState = createMockState();
  });

  it("supports copy actions and confirms delete", async () => {
    const createdAt = 1700000000000;
    const session = makeSession("s1");
    const sdk = makeSdkSession("s1", { cliSessionId: "cli-abc-123", createdAt });
    mockState = createMockState({
      sessions: new Map([["s1", session]]),
      sdkSessions: [sdk],
      currentSessionId: "s1",
    });

    render(<Sidebar />);
    const sessionButton = screen.getByText("claude-sonnet-4-5-20250929").closest("button")!;
    fireEvent.contextMenu(sessionButton, { clientX: 100, clientY: 120 });

    expect(screen.getByText("Copy Session ID")).toBeInTheDocument();
    expect(screen.getByText("Copy CLI Session ID")).toBeInTheDocument();
    expect(screen.getByText("Delete Session")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Copy Session ID"));
    expect(mockWriteClipboardText).toHaveBeenCalledWith("s1");

    fireEvent.contextMenu(sessionButton, { clientX: 110, clientY: 125 });
    fireEvent.click(screen.getByText("Delete Session"));
    expect(screen.getByText("Delete session permanently?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(mockApi.deleteSession).toHaveBeenCalledWith("s1");
    });
  });

  it("copies session numbers with a leading hash from the context menu", () => {
    const session = makeSession("s1");
    const sdk = makeSdkSession("s1", { sessionNum: 1147 });
    mockState = createMockState({
      sessions: new Map([["s1", session]]),
      sdkSessions: [sdk],
      currentSessionId: "s1",
    });

    render(<Sidebar />);
    const sessionButton = screen.getByText("claude-sonnet-4-5-20250929").closest("button")!;
    fireEvent.contextMenu(sessionButton, { clientX: 100, clientY: 120 });

    expect(screen.getByText("Copy Session Number")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Copy Session Number"));
    expect(mockWriteClipboardText).toHaveBeenCalledWith("#1147");
  });

  it("opens Configure Session from the session context menu", async () => {
    const session = makeSession("s1", { backend_type: "codex", model: "gpt-5.4" });
    const sdk = makeSdkSession("s1", { sessionNum: 1533, backendType: "codex", model: "gpt-5.4" });
    mockState = createMockState({
      sessions: new Map([["s1", session]]),
      sdkSessions: [sdk],
      currentSessionId: "s1",
      cliConnected: new Map([["s1", true]]),
    });

    render(<Sidebar />);
    const sessionButton = screen.getByText("gpt-5.4").closest("button")!;
    fireEvent.contextMenu(sessionButton, { clientX: 100, clientY: 120 });

    expect(screen.getByText("Configure Session")).toBeInTheDocument();
    expect(screen.getByText("Configure Session").closest(".fixed")).toHaveClass("w-56");
    fireEvent.click(screen.getByText("Configure Session"));

    expect(await screen.findByRole("dialog", { name: "Configure Session" })).toBeInTheDocument();
    expect(screen.getByText(/Codex session settings for #1533/)).toBeInTheDocument();
  });
});
