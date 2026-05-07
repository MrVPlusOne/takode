// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    getSessionUsageLimits: vi.fn().mockRejectedValue(new Error("skip")),
    getPRStatus: vi.fn().mockRejectedValue(new Error("skip")),
    getClaudeMdFiles: vi.fn().mockResolvedValue({ cwd: "/repo", files: [] }),
    getAutoApprovalConfigForPath: vi.fn().mockResolvedValue({ config: null }),
    getHerdDiagnostics: vi.fn().mockResolvedValue({
      herdDispatcher: { pendingEventCount: 0, eventHistory: [] },
      isGenerating: false,
      cliConnected: true,
      cliInitReceived: true,
      pendingMessagesCount: 0,
      disconnectGraceActive: false,
      herdedWorkers: [],
      pendingPermissionsCount: 0,
    }),
    unherdSession: vi.fn().mockResolvedValue({ ok: true }),
    setSessionPermissionMode: vi
      .fn()
      .mockResolvedValue({ ok: true, sessionId: "worker-1", permissionMode: "codex-auto-review" }),
    listSessions: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../api.js", () => ({
  api: mockApi,
}));

vi.mock("./McpPanel.js", () => ({
  McpSection: () => <div data-testid="mcp-section">MCP Section</div>,
}));

interface CodexTokenDetails {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningOutputTokens: number;
  modelContextWindow: number;
}

interface CodexRateLimits {
  primary: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
  secondary: { usedPercent: number; windowDurationMins: number; resetsAt: number } | null;
}

interface MockStoreState {
  sessionTasks: Map<string, { id: string; status: string; subject: string }[]>;
  sessionTaskHistory: Map<string, { title: string; triggerMessageId: string }[]>;
  requestScrollToTurn: ReturnType<typeof vi.fn>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  sessions: Map<
    string,
    {
      backend_type?: string;
      cwd?: string;
      git_branch?: string;
      codex_token_details?: CodexTokenDetails;
      claude_token_details?: Omit<CodexTokenDetails, "reasoningOutputTokens">;
      codex_rate_limits?: CodexRateLimits;
      context_used_percent?: number;
      claimedQuestId?: string;
      claimedQuestTitle?: string;
      claimedQuestStatus?: string;
    }
  >;
  sdkSessions: {
    sessionId: string;
    isOrchestrator?: boolean;
    backendType?: string;
    cwd?: string;
    gitBranch?: string;
    codexTokenDetails?: CodexTokenDetails;
    claudeTokenDetails?: Omit<CodexTokenDetails, "reasoningOutputTokens">;
    sessionNum?: number | null;
    state?: "starting" | "connected" | "running" | "exited";
    createdAt?: number;
    cliConnected?: boolean;
    repoRoot?: string;
    herdedBy?: string;
    permissionMode?: string;
    name?: string;
  }[];
  taskPanelOpen: boolean;
  setTaskPanelOpen: ReturnType<typeof vi.fn>;
  prStatus: Map<string, { available: boolean; pr?: unknown } | null>;
  quests: Array<any>;
  sessionBoards: Map<string, Array<any>>;
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  cliConnected: Map<string, boolean>;
  askPermission: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  openQuestOverlay: ReturnType<typeof vi.fn>;
  setSdkSessions: ReturnType<typeof vi.fn>;
}

let mockState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionTasks: new Map(),
    sessionTaskHistory: new Map(),
    requestScrollToTurn: vi.fn(),
    sessionStatus: new Map([["s1", "idle"]]),
    sessions: new Map([["s1", { backend_type: "codex" }]]),
    sdkSessions: [],
    taskPanelOpen: true,
    setTaskPanelOpen: vi.fn(),
    prStatus: new Map(),
    quests: [],
    sessionBoards: new Map(),
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    pendingPermissions: new Map(),
    cliConnected: new Map(),
    askPermission: new Map(),
    cliDisconnectReason: new Map(),
    openQuestOverlay: vi.fn(),
    setSdkSessions: vi.fn(),
    ...overrides,
  };
}

vi.mock("../store.js", () => {
  const useStore = (selector: (s: MockStoreState) => unknown) => selector(mockState);
  useStore.getState = () => mockState;
  return {
    useStore,
    countUserPermissions: () => 0,
  };
});

import { TaskPanel, CodexRateLimitsSection, CodexTokenDetailsSection, ClaudeMdCollapsible } from "./TaskPanel.js";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockApi.getClaudeMdFiles.mockResolvedValue({ cwd: "/repo", files: [] });
  mockApi.getAutoApprovalConfigForPath.mockResolvedValue({ config: null });
  resetStore();
});

describe("TaskPanel", () => {
  it("renders nothing when closed", () => {
    resetStore({ taskPanelOpen: false });
    const { container } = render(<TaskPanel sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("shows task sections for Codex sessions when tasks exist", () => {
    // Regression coverage: Codex sessions should display the same task/todo UI
    // as Claude sessions whenever the store has extracted tasks.
    resetStore({
      sessionTasks: new Map([
        [
          "s1",
          [
            { id: "t1", status: "in_progress", subject: "Implement adapter fix" },
            { id: "t2", status: "pending", subject: "Add regression tests" },
          ],
        ],
      ]),
      sessions: new Map([["s1", { backend_type: "codex" }]]),
    });

    render(<TaskPanel sessionId="s1" />);
    expect(screen.getByText("Current To-Dos")).toBeInTheDocument();
    expect(screen.getByText("Implement adapter fix")).toBeInTheDocument();
    expect(screen.getByText("Add regression tests")).toBeInTheDocument();
  });

  it("lets a leader confirm a Codex permission profile change for a herded worker", async () => {
    // This covers the leader-side worker control: selecting a new profile must
    // pause for restart confirmation before the server relaunch path is called.
    resetStore({
      sessions: new Map([["s1", { backend_type: "codex" }]]),
      sdkSessions: [
        {
          sessionId: "s1",
          sessionNum: 1,
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          backendType: "codex",
          isOrchestrator: true,
        },
        {
          sessionId: "worker-1",
          sessionNum: 2,
          state: "connected",
          cwd: "/repo",
          createdAt: 2,
          backendType: "codex",
          herdedBy: "s1",
          permissionMode: "codex-default",
          name: "Worker One",
        },
      ],
    });

    render(<TaskPanel sessionId="s1" />);

    fireEvent.change(screen.getByLabelText("Codex permissions for Worker One"), {
      target: { value: "auto-review" },
    });

    expect(screen.getByText("Restart worker with Auto-review?")).toBeInTheDocument();
    expect(mockApi.setSessionPermissionMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Restart"));

    await waitFor(() =>
      expect(mockApi.setSessionPermissionMode).toHaveBeenCalledWith("worker-1", "codex-auto-review", {
        leaderSessionId: "s1",
      }),
    );
  });

  it("keeps a single scroll container for long MCP content even without tasks", () => {
    // Regression coverage: when no task list is present, the panel itself
    // must still provide vertical scrolling for long MCP content.
    const { container } = render(<TaskPanel sessionId="s1" />);

    expect(screen.getByTestId("mcp-section")).toBeInTheDocument();
    expect(screen.getByTestId("task-panel-content")).toHaveClass("overflow-y-auto");
    expect(container.querySelectorAll(".overflow-y-auto")).toHaveLength(1);
  });

  it("renders the selected session claimed quest with verification, feedback, and owner details", () => {
    // The right panel should make current quest facts visible so leader prose
    // can focus on decisions and reasoning instead of restating this state.
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            claimedQuestId: "q-42",
            claimedQuestTitle: "Fallback claimed title",
            claimedQuestStatus: "done",
          },
        ],
        ["worker-1", { backend_type: "codex" }],
      ]),
      sdkSessions: [
        {
          sessionId: "worker-1",
          sessionNum: 7,
          state: "running",
          cwd: "/repo",
          createdAt: 1,
          backendType: "codex",
        },
      ],
      quests: [
        {
          id: "q-42-v3",
          questId: "q-42",
          version: 3,
          title: "Verify right panel quest status",
          status: "done",
          description: "Show the accepted quest status facts.",
          createdAt: 1,
          sessionId: "worker-1",
          claimedAt: 2,
          verificationInboxUnread: true,
          verificationItems: [
            { text: "Quest card is visible", checked: true },
            { text: "Detail panel opens", checked: false },
          ],
          feedback: [
            { author: "human", text: "Please check the wait state.", ts: 3, addressed: false },
            { author: "human", text: "Earlier note handled.", ts: 4, addressed: true },
          ],
          commitShas: ["abc1234", "def5678"],
        },
      ],
    });

    render(<TaskPanel sessionId="s1" />);

    expect(screen.getByText("Selected session quest")).toBeInTheDocument();
    expect(screen.getByText("q-42")).toBeInTheDocument();
    expect(screen.getByText("Verify right panel quest status")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.getByText("unread")).toBeInTheDocument();
    expect(screen.getByText("1 open")).toBeInTheDocument();
    expect(screen.getByText("1 done")).toBeInTheDocument();
    expect(screen.getByText("Commits")).toBeInTheDocument();
    expect(screen.getByText("1 unaddressed human feedback")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#7" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open details" }));

    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-42");
  });

  it("renders a leader board attention row with wait state and compact Journey context", () => {
    resetStore({
      sessions: new Map([["leader", { backend_type: "codex" }]]),
      sdkSessions: [
        { sessionId: "leader", isOrchestrator: true, state: "running", cwd: "/repo", createdAt: 1 },
        { sessionId: "worker-2", sessionNum: 12, state: "running", cwd: "/repo", createdAt: 1 },
      ],
      quests: [
        {
          id: "q-77-v1",
          questId: "q-77",
          version: 1,
          title: "Port accepted quest status",
          status: "in_progress",
          description: "Port the accepted changes.",
          createdAt: 1,
          sessionId: "worker-2",
          claimedAt: 2,
        },
      ],
      sessionBoards: new Map([
        [
          "leader",
          [
            {
              questId: "q-77",
              title: "Port accepted quest status",
              worker: "worker-2",
              workerNum: 12,
              status: "PORTING",
              waitForInput: ["n-4"],
              updatedAt: 10,
              journey: {
                phaseIds: ["alignment", "implement", "code-review", "port"],
                mode: "active",
                currentPhaseId: "port",
                activePhaseIndex: 3,
              },
            },
          ],
        ],
      ]),
    });

    render(<TaskPanel sessionId="leader" />);

    expect(screen.getByText("Board attention row")).toBeInTheDocument();
    expect(screen.getByText("Port accepted quest status")).toBeInTheDocument();
    expect(screen.getByText("Waiting for input: n-4")).toBeInTheDocument();
    expect(screen.getByTestId("quest-journey-compact-summary")).toHaveAttribute("data-journey-mode", "active");
    expect(screen.getByText("Port")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#12" })).toBeInTheDocument();
  });

  it("shows Auto-Approval Rules in CLAUDE.md section when config exists", async () => {
    mockApi.getClaudeMdFiles.mockResolvedValue({
      cwd: "/repo",
      files: [],
    });
    mockApi.getAutoApprovalConfigForPath.mockResolvedValue({
      config: {
        slug: "repo",
        projectPath: "/repo",
        label: "Repo defaults",
        criteria: "Allow harmless commands",
        enabled: true,
      },
    });
    localStorage.setItem("cc-collapse-claudemd", "0");

    render(<ClaudeMdCollapsible cwd="/repo" repoRoot="/repo" />);

    await waitFor(() => expect(mockApi.getAutoApprovalConfigForPath).toHaveBeenCalledWith("/repo", "/repo"), {
      timeout: 5000,
    });

    const autoApprovalButton = await screen.findByRole("button", { name: "Auto-Approval Rules" }, { timeout: 5000 });
    fireEvent.click(autoApprovalButton);
    await screen.findByText("Read-only", {}, { timeout: 5000 });
  });

  it("does not start herd diagnostics polling when the task panel is closed", () => {
    resetStore({
      taskPanelOpen: false,
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
    });

    render(<TaskPanel sessionId="s1" />);

    expect(mockApi.getHerdDiagnostics).not.toHaveBeenCalled();
  });

  it("does not poll herd diagnostics while the section is collapsed", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("cc-collapse-herd-diag", "1");
      resetStore({
        sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      });

      render(<TaskPanel sessionId="s1" />);
      await vi.advanceTimersByTimeAsync(15_000);

      expect(mockApi.getHerdDiagnostics).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the herd diagnostics header visible when first mounted collapsed", () => {
    localStorage.setItem("cc-collapse-herd-diag", "1");
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
    });

    render(<TaskPanel sessionId="s1" />);

    // Regression coverage for q-365: persisted collapsed state must not hide
    // the entire section before diagnostics data has ever loaded.
    expect(screen.getByRole("button", { name: "Herd Diagnostics" })).toBeInTheDocument();
    expect(mockApi.getHerdDiagnostics).not.toHaveBeenCalled();
  });

  it("polls herd diagnostics only when the section is visible", async () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("cc-collapse-herd-diag", "0");
      resetStore({
        sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      });

      render(<TaskPanel sessionId="s1" />);

      await vi.advanceTimersByTimeAsync(0);
      expect(mockApi.getHerdDiagnostics).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(5_000);
      expect(mockApi.getHerdDiagnostics).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CodexRateLimitsSection", () => {
  it("renders nothing when no rate limits data", () => {
    // Session exists but has no codex_rate_limits
    resetStore({ sessions: new Map([["s1", { backend_type: "codex" }]]) });
    const { container } = render(<CodexRateLimitsSection sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when both primary and secondary are null", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            codex_rate_limits: { primary: null, secondary: null },
          },
        ],
      ]),
    });
    const { container } = render(<CodexRateLimitsSection sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders primary rate limit bar with percentage and window label", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            codex_rate_limits: {
              primary: { usedPercent: 62, windowDurationMins: 300, resetsAt: Date.now() + 7_200_000 },
              secondary: null,
            },
          },
        ],
      ]),
    });
    render(<CodexRateLimitsSection sessionId="s1" />);
    // 300 mins = 5h
    expect(screen.getByText("5h Limit")).toBeInTheDocument();
    expect(screen.getByText("62%")).toBeInTheDocument();
  });

  it("renders both primary and secondary limits", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            codex_rate_limits: {
              primary: { usedPercent: 30, windowDurationMins: 300, resetsAt: Date.now() + 3_600_000 },
              secondary: { usedPercent: 10, windowDurationMins: 10080, resetsAt: Date.now() + 86_400_000 },
            },
          },
        ],
      ]),
    });
    render(<CodexRateLimitsSection sessionId="s1" />);
    // 300 mins = 5h, 10080 mins = 7d
    expect(screen.getByText("5h Limit")).toBeInTheDocument();
    expect(screen.getByText("7d Limit")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();
    expect(screen.getByText("10%")).toBeInTheDocument();
  });

  it("formats codex reset countdown correctly when resetsAt is epoch-seconds", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-02-25T00:00:00.000Z"));
      const resetAtSec = Math.floor(Date.now() / 1000) + 7200;
      resetStore({
        sessions: new Map([
          [
            "s1",
            {
              backend_type: "codex",
              codex_rate_limits: {
                primary: { usedPercent: 62, windowDurationMins: 300, resetsAt: resetAtSec },
                secondary: null,
              },
            },
          ],
        ]),
      });
      render(<CodexRateLimitsSection sessionId="s1" />);
      expect(screen.getByText("(2h0m)")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("CodexTokenDetailsSection", () => {
  it("renders nothing when no token details", () => {
    resetStore({ sessions: new Map([["s1", { backend_type: "codex" }]]) });
    const { container } = render(<CodexTokenDetailsSection sessionId="s1" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders input and output token counts", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            context_used_percent: 42,
            codex_token_details: {
              inputTokens: 84_230,
              outputTokens: 12_450,
              cachedInputTokens: 0,
              reasoningOutputTokens: 0,
              modelContextWindow: 200_000,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("84.2k")).toBeInTheDocument();
    expect(screen.getByText("12.4k")).toBeInTheDocument();
  });

  it("renders Claude token details from normalized modelUsage", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "claude",
            context_used_percent: 38,
            claude_token_details: {
              inputTokens: 12_000,
              outputTokens: 3_400,
              cachedInputTokens: 98_000,
              modelContextWindow: 200_000,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    expect(screen.getByText("Tokens")).toBeInTheDocument();
    expect(screen.getByText("12.0k")).toBeInTheDocument();
    expect(screen.getByText("3.4k")).toBeInTheDocument();
    expect(screen.getByText("98.0k")).toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
  });

  it("shows cached and reasoning rows only when non-zero", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            context_used_percent: 55,
            codex_token_details: {
              inputTokens: 100_000,
              outputTokens: 5_000,
              cachedInputTokens: 41_200,
              reasoningOutputTokens: 8_900,
              modelContextWindow: 200_000,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    // Cached and reasoning should be visible
    expect(screen.getByText("Cached")).toBeInTheDocument();
    expect(screen.getByText("41.2k")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("8.9k")).toBeInTheDocument();
  });

  it("hides cached and reasoning rows when zero", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            context_used_percent: 20,
            codex_token_details: {
              inputTokens: 10_000,
              outputTokens: 1_000,
              cachedInputTokens: 0,
              reasoningOutputTokens: 0,
              modelContextWindow: 200_000,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    expect(screen.queryByText("Cached")).not.toBeInTheDocument();
    expect(screen.queryByText("Reasoning")).not.toBeInTheDocument();
  });

  it("uses server-computed context_used_percent, not local calculation", () => {
    // Scenario: inputTokens=289500, outputTokens=2100, contextWindow=258400
    // Naive local calc would give 112%, but server caps at 100
    // This verifies the UI uses the session's context_used_percent (capped at 100)
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            context_used_percent: 100,
            codex_token_details: {
              inputTokens: 289_500,
              outputTokens: 2_100,
              cachedInputTokens: 210_300,
              reasoningOutputTokens: 741,
              modelContextWindow: 258_400,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    // Should show 100%, not 112%
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.queryByText("112%")).not.toBeInTheDocument();
  });

  it("hides context bar when modelContextWindow is 0", () => {
    resetStore({
      sessions: new Map([
        [
          "s1",
          {
            backend_type: "codex",
            context_used_percent: 0,
            codex_token_details: {
              inputTokens: 1_000,
              outputTokens: 500,
              cachedInputTokens: 0,
              reasoningOutputTokens: 0,
              modelContextWindow: 0,
            },
          },
        ],
      ]),
    });
    render(<CodexTokenDetailsSection sessionId="s1" />);
    expect(screen.queryByText("Context")).not.toBeInTheDocument();
  });
});
