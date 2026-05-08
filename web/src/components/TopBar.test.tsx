// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockNavigateTo = vi.fn();
const mockNavigateToSession = vi.fn();

vi.mock("../api.js", () => ({
  api: {
    relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
    getSessionNotifications: vi.fn().mockResolvedValue([]),
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    updateLeaderProfilePortrait: vi.fn(),
  },
}));
vi.mock("../utils/navigation.js", () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
  navigateToSession: (...args: unknown[]) => mockNavigateToSession(...args),
}));
vi.mock("../ws.js", () => ({
  sendToSession: vi.fn(() => true),
}));
vi.mock("./SessionInfoPopover.js", () => ({
  SessionInfoPopover: ({ anchorElement }: { anchorElement?: HTMLElement | null }) => (
    <div data-testid="session-info-popover" data-anchor-present={anchorElement ? "true" : "false"} />
  ),
}));

interface MockStoreState {
  currentSessionId: string | null;
  zoomLevel: number;
  cliConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | null>;
  sidebarOpen: boolean;
  setSidebarOpen: ReturnType<typeof vi.fn>;
  setSessionInfoOpenSessionId: ReturnType<typeof vi.fn>;
  taskPanelOpen: boolean;
  setTaskPanelOpen: ReturnType<typeof vi.fn>;
  activeTab: "chat" | "diff";
  setActiveTab: ReturnType<typeof vi.fn>;
  sessions: Map<
    string,
    {
      cwd?: string;
      permissionMode?: string;
      backend_type?: string;
      claimedQuestStatus?: string;
      claimedQuestVerificationInboxUnread?: boolean;
    }
  >;
  sdkSessions: {
    sessionId: string;
    createdAt: number;
    archived?: boolean;
    cwd?: string;
    name?: string;
    sessionNum?: number | null;
    permissionMode?: string;
    backendType?: string;
    cliSessionId?: string | null;
    cliConnected?: boolean;
    state?: "idle" | "starting" | "connected" | "running" | "compacting" | "exited" | null;
    claimedQuestStatus?: string | null;
    claimedQuestVerificationInboxUnread?: boolean;
    isOrchestrator?: boolean;
    leaderProfilePortrait?: {
      id: string;
      poolId: string;
      label: string;
      smallUrl: string;
      largeUrl: string;
      smallSize: number;
      largeSize: number;
      smallBytes: number;
      largeBytes: number;
    };
  }[];
  updateSdkSession: ReturnType<typeof vi.fn>;
  changedFiles: Map<string, Set<string>>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionNotifications: Map<string, Array<any>>;
  sessionNames: Map<string, string>;
  diffFileStats: Map<string, Map<string, { additions: number; deletions: number }>>;
  quests: { status: string }[];
  refreshQuests: ReturnType<typeof vi.fn>;
  questNamedSessions: Set<string>;
  shortcutSettings?: {
    enabled: boolean;
    preset: "standard" | "vscode-light" | "vim-light";
    overrides: Record<string, string | null>;
  };
  openSessionSearch: ReturnType<typeof vi.fn>;
  closeSessionSearch: ReturnType<typeof vi.fn>;
  setSessionNotifications: ReturnType<typeof vi.fn>;
  requestScrollToMessage: ReturnType<typeof vi.fn>;
  setExpandAllInTurn: ReturnType<typeof vi.fn>;
  requestBottomAlignOnNextUserMessage: ReturnType<typeof vi.fn>;
}

let storeState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  storeState = {
    currentSessionId: "s1",
    zoomLevel: 1,
    cliConnected: new Map([["s1", true]]),
    cliDisconnectReason: new Map(),
    sessionStatus: new Map([["s1", "idle"]]),
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    setSessionInfoOpenSessionId: vi.fn(),
    taskPanelOpen: false,
    setTaskPanelOpen: vi.fn(),
    activeTab: "chat",
    setActiveTab: vi.fn(),
    sessions: new Map([["s1", { cwd: "/repo" }]]),
    sdkSessions: [],
    updateSdkSession: vi.fn(),
    changedFiles: new Map(),
    pendingPermissions: new Map(),
    sessionAttention: new Map(),
    sessionNotifications: new Map(),
    sessionNames: new Map(),
    diffFileStats: new Map(),
    quests: [],
    refreshQuests: vi.fn().mockResolvedValue(undefined),
    questNamedSessions: new Set(),
    shortcutSettings: { enabled: false, preset: "standard", overrides: {} },
    openSessionSearch: vi.fn(),
    closeSessionSearch: vi.fn(),
    setSessionNotifications: vi.fn(),
    requestScrollToMessage: vi.fn(),
    setExpandAllInTurn: vi.fn(),
    requestBottomAlignOnNextUserMessage: vi.fn(),
    ...overrides,
  };
}

vi.mock("../store.js", () => {
  const useStore: any = (selector: (s: MockStoreState) => unknown) => selector(storeState);
  useStore.getState = () => storeState;
  return {
    useStore,
    countUserPermissions: (perms: Map<string, unknown> | undefined): number => {
      if (!perms) return 0;
      let count = 0;
      for (const p of perms.values()) {
        const perm = p as { evaluating?: boolean; autoApproved?: string };
        if (!perm?.evaluating && !perm?.autoApproved) count++;
      }
      return count;
    },
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

import { TopBar } from "./TopBar.js";
import { getGlobalNeedsInputEntries } from "./GlobalNeedsInputMenu.js";

beforeEach(() => {
  vi.clearAllMocks();
  window.innerWidth = 1280;
  resetStore();
});

describe("TopBar", () => {
  it("derives the global needs-input aggregate from unresolved needs-input notifications only", () => {
    resetStore({
      sdkSessions: [
        { sessionId: "s1", createdAt: 40, cliConnected: true, state: "running", sessionNum: 11, name: "One" },
        { sessionId: "s2", createdAt: 30, cliConnected: true, state: "idle", sessionNum: 12, name: "Two" },
        { sessionId: "archived", createdAt: 20, archived: true, sessionNum: 13, name: "Archived" },
      ],
      sessionNotifications: new Map([
        [
          "s1",
          [
            { id: "n-1", category: "needs-input", summary: "Need scope", timestamp: 3, messageId: "m1", done: false },
            { id: "review", category: "review", summary: "Review", timestamp: 4, messageId: "m2", done: false },
          ],
        ],
        [
          "s2",
          [
            { id: "done", category: "needs-input", summary: "Done", timestamp: 5, messageId: "m3", done: true },
            { id: "n-2", category: "needs-input", summary: "Need launch", timestamp: 6, messageId: "m4", done: false },
          ],
        ],
        [
          "archived",
          [{ id: "hidden", category: "needs-input", summary: "Archived", timestamp: 7, messageId: "m5", done: false }],
        ],
      ]),
    });

    const entries = getGlobalNeedsInputEntries(storeState as any);

    expect(entries.map((entry) => entry.notification.id)).toEqual(["n-2", "n-1"]);
    expect(entries.map((entry) => entry.sessionNum)).toEqual([12, 11]);
  });

  it("does not render the global control for running, permission, review, or blue unread state alone", () => {
    resetStore({
      sdkSessions: [
        { sessionId: "s-running", createdAt: 40, cliConnected: true, state: "running" },
        { sessionId: "s-waiting", createdAt: 30, cliConnected: true, state: "idle" },
        { sessionId: "s-unread", createdAt: 20, cliConnected: true, state: "idle" },
      ],
      sessionStatus: new Map([
        ["s-running", "running"],
        ["s-waiting", "idle"],
        ["s-unread", "idle"],
      ]),
      cliConnected: new Map([
        ["s-running", true],
        ["s-waiting", true],
        ["s-unread", true],
      ]),
      pendingPermissions: new Map([["s-waiting", new Map([["perm-1", {}]])]]),
      sessionAttention: new Map([["s-unread", "review"]]),
      sessionNotifications: new Map([
        [
          "s-unread",
          [{ id: "review", category: "review", summary: "Review only", timestamp: Date.now(), done: false }],
        ],
      ]),
    });

    render(<TopBar />);

    expect(screen.queryByRole("button", { name: /unresolved needs-input/ })).not.toBeInTheDocument();
  });

  it("opens an aggregated needs-input menu across sessions", () => {
    resetStore({
      sessionNotifications: new Map([
        [
          "s1",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Pick deployment window",
              timestamp: 1,
              messageId: "m1",
              done: false,
            },
          ],
        ],
        [
          "s2",
          [
            {
              id: "n-2",
              category: "needs-input",
              summary: "Confirm rollback plan",
              timestamp: 2,
              messageId: "m2",
              done: false,
            },
            { id: "review", category: "review", summary: "Review", timestamp: 3, messageId: "m3", done: false },
          ],
        ],
      ]),
      sdkSessions: [
        { sessionId: "s1", createdAt: 10, sessionNum: 101, name: "Worker One" },
        { sessionId: "s2", createdAt: 20, sessionNum: 102, name: "Worker Two" },
      ],
    });

    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: "2 unresolved needs-input notifications across sessions" }));

    expect(screen.getByRole("dialog", { name: "Global needs-input notifications" })).toBeInTheDocument();
    expect(screen.getByText("#102 Worker Two")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm rollback plan" })).toBeInTheDocument();
    expect(screen.getByText("#101 Worker One")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pick deployment window" })).toBeInTheDocument();
  });

  it("stops quest badge polling while the tab is hidden", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });

    try {
      render(<TopBar />);
      expect(storeState.refreshQuests).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(20_000);
      expect(storeState.refreshQuests).toHaveBeenCalledTimes(1);

      visibilityState = "visible";
      fireEvent(document, new Event("visibilitychange"));
      expect(storeState.refreshQuests).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(15_000);
      expect(storeState.refreshQuests).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows session number next to the session name in the title area", () => {
    resetStore({
      sessions: new Map([["s1", { cwd: "/repo", permissionMode: "acceptEdits", backend_type: "claude" }]]),
      sessionNames: new Map([["s1", "Main Session"]]),
      sdkSessions: [{ sessionId: "s1", createdAt: 1, sessionNum: 111, name: "Main Session" }],
    });

    render(<TopBar />);
    expect(screen.getByText("#111")).toBeInTheDocument();
    expect(screen.getByText("Main Session")).toBeInTheDocument();
  });

  it("shows a leader portrait before the leader session name and routes it to session info", async () => {
    resetStore({
      sessions: new Map([["s1", { cwd: "/repo", permissionMode: "acceptEdits", backend_type: "claude" }]]),
      sessionNames: new Map([["s1", "Leader Session"]]),
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          sessionNum: 111,
          name: "Leader Session",
          isOrchestrator: true,
          leaderProfilePortrait: {
            id: "tako1-01",
            poolId: "tako",
            label: "Tako 1.1",
            smallUrl: "/leader-profile-portraits/tako/tako1-01.v2.96.webp",
            largeUrl: "/leader-profile-portraits/tako/tako1-01.v2.320.webp",
            smallSize: 96,
            largeSize: 320,
            smallBytes: 2912,
            largeBytes: 19216,
          },
        },
      ],
    });

    render(<TopBar />);
    const portrait = screen.getByTestId("topbar-leader-profile-portrait");
    expect(portrait).toBeInTheDocument();
    expect(screen.getByText("Leader Session")).toBeInTheDocument();

    fireEvent.click(portrait);

    expect(screen.queryByRole("dialog", { name: "Leader profile" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("session-info-popover")).toHaveAttribute("data-anchor-present", "true");
    });
  });

  it("does not show a duplicate plan/agent mode label in title bar", () => {
    resetStore({
      sessions: new Map([["s1", { cwd: "/repo", permissionMode: "plan", backend_type: "codex" }]]),
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          sessionNum: 111,
          name: "Main Session",
          permissionMode: "plan",
          backendType: "codex",
        },
      ],
    });

    render(<TopBar />);
    expect(screen.queryByTitle("Current mode: Plan")).not.toBeInTheDocument();
  });

  it("shows checked quest marker from SDK metadata for a selected snapshot-only session", () => {
    // Direct navigation to an archived/exited session may render the title from
    // the /api/sessions snapshot before any live session state exists.
    resetStore({
      currentSessionId: "archived-worker",
      sessions: new Map(),
      cliConnected: new Map([["archived-worker", false]]),
      sessionStatus: new Map(),
      sessionNames: new Map([["archived-worker", "Use active leader thread tab as voice transcription context"]]),
      questNamedSessions: new Set(["archived-worker"]),
      sdkSessions: [
        {
          sessionId: "archived-worker",
          createdAt: 1,
          archived: true,
          state: "exited",
          sessionNum: 1544,
          name: "Use active leader thread tab as voice transcription context",
          claimedQuestStatus: "done",
          claimedQuestVerificationInboxUnread: true,
        },
      ],
    });

    render(<TopBar />);

    expect(screen.getByText("☑ Use active leader thread tab as voice transcription context")).toBeInTheDocument();
  });

  it("preserves incomplete quest marker for selected in-progress SDK sessions", () => {
    resetStore({
      currentSessionId: "worker",
      sessions: new Map(),
      cliConnected: new Map([["worker", true]]),
      sessionNames: new Map([["worker", "Fix stale quest completion status in session sidebar titles"]]),
      questNamedSessions: new Set(["worker"]),
      sdkSessions: [
        {
          sessionId: "worker",
          createdAt: 1,
          state: "connected",
          sessionNum: 1550,
          name: "Fix stale quest completion status in session sidebar titles",
          claimedQuestStatus: "in_progress",
        },
      ],
    });

    render(<TopBar />);

    expect(screen.getByText("☐ Fix stale quest completion status in session sidebar titles")).toBeInTheDocument();
  });

  it("shows diff badge count only for files within cwd", () => {
    resetStore({
      changedFiles: new Map([
        ["s1", new Set(["/repo/src/a.ts", "/repo/src/b.ts", "/Users/stan/.claude/plans/plan.md"])],
      ]),
    });

    render(<TopBar />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("hides diff badge when all changed files are out of scope", () => {
    resetStore({
      changedFiles: new Map([["s1", new Set(["/Users/stan/.claude/plans/plan.md"])]]),
    });

    render(<TopBar />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("publishes opened session info panel id for sidebar-linked highlights", async () => {
    render(<TopBar />);

    fireEvent.click(screen.getByRole("button", { name: /session s1/i }));
    await waitFor(() => {
      expect(storeState.setSessionInfoOpenSessionId).toHaveBeenLastCalledWith("s1");
    });

    fireEvent.click(screen.getByRole("button", { name: /session s1/i }));
    await waitFor(() => {
      expect(storeState.setSessionInfoOpenSessionId).toHaveBeenLastCalledWith(null);
    });
  });

  it("removes the duplicate title-bar copy and right-side session info buttons", () => {
    resetStore({
      sessions: new Map([["s1", { cwd: "/repo", permissionMode: "acceptEdits", backend_type: "claude" }]]),
      sessionNames: new Map([["s1", "Main Session"]]),
      sdkSessions: [
        {
          sessionId: "s1",
          createdAt: 1,
          sessionNum: 111,
          name: "Main Session",
          cliSessionId: "cli-session-123",
        },
      ],
    });

    render(<TopBar />);

    expect(screen.queryByTitle(/Copy CLI Session ID/)).not.toBeInTheDocument();
    expect(screen.queryByTitle("Session info")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /main session/i })).toBeInTheDocument();
  });

  it("shows the enabled search shortcut in the hover title", () => {
    resetStore({
      shortcutSettings: { enabled: true, preset: "standard", overrides: {} },
    });

    render(<TopBar />);
    expect(screen.getByTitle("Search messages (Ctrl+F)")).toBeInTheDocument();
  });
});
