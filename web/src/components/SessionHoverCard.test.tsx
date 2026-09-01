// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { SessionState } from "../types.js";
import type { SidebarSessionItem as SessionItemType } from "../utils/sidebar-session-item.js";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestmasterTask } from "../types.js";
import {
  SESSION_ATTENTION_PROJECTION,
  type SessionAttentionProjectionValue,
} from "../../shared/session-attention-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import {
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { sessionNavigationProjectionToSessionFields } from "../../shared/session-navigation-projection.js";
import { createSessionNavigationProjectionValue } from "../test-fixtures/session-navigation-projection.js";

if (typeof globalThis.DOMRect === "undefined") {
  globalThis.DOMRect = class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
      this.left = x;
    }

    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    }
  } as typeof DOMRect;
}

const mockStoreState = {
  zoomLevel: 1,
  sessions: new Map<string, SessionState>(),
  cliConnected: new Map<string, boolean>(),
  cliDisconnectReason: new Map<string, "idle_limit" | "broken" | "recovery_suppressed" | null>(),
  sessionStatus: new Map<string, "idle" | "running" | "compacting" | "reverting" | null>(),
  pendingPermissions: new Map<string, Map<string, unknown>>(),
  askPermission: new Map<string, boolean>(),
  diffFileStats: new Map<string, Map<string, { additions: number; deletions: number }>>(),
  sessionPreviews: new Map<string, string>(),
  sdkSessions: [] as Array<{
    sessionId: string;
    sessionNum?: number;
    state?: "idle" | "starting" | "connected" | "running" | "exited";
    backendType?: "claude" | "codex" | "claude-sdk";
    cwd?: string;
    herdedBy?: string;
    archived?: boolean;
    contextUsedPercent?: number;
    numTurns?: number;
    userTurnCount?: number;
    agentTurnCount?: number;
    messageHistoryBytes?: number;
    codexRetainedPayloadBytes?: number;
    modelContextWindow?: number | null;
    contextTokensUsed?: number | null;
    codexTokenDetails?: { modelContextWindow?: number };
    claudeTokenDetails?: { modelContextWindow?: number };
    codexMaxContextLength?: number;
    claudeMaxContextLength?: number;
    isOrchestrator?: boolean;
    notificationUrgency?: "needs-input" | "review" | null;
    activeNotificationCount?: number;
    activeNeedsInputNotificationCount?: number;
    activeReviewNotificationCount?: number;
    mutedNeedsInputNotificationCount?: number;
    notificationStatusVersion?: number;
    notificationStatusUpdatedAt?: number;
    leaderOpenThreadTabs?: {
      version: 1;
      orderedOpenThreadKeys: string[];
      closedThreadTombstones: Array<{ threadKey: string; closedAt: number }>;
      updatedAt: number;
    };
  }>,
  sessionNames: new Map<string, string>(),
  quests: undefined as QuestmasterTask[] | undefined,
  sessionBoards: undefined as Map<string, BoardRowData[]> | undefined,
  currentSessionId: undefined as string | undefined,
  sessionTimers: new Map<string, Array<{ id: string }>>(),
  sessionNotifications: new Map<string, Array<any>>(),
  sessionAttention: new Map<string, "action" | "error" | "review" | null>(),
  syncedProjectionValues: new Map<string, unknown>(),
  syncedProjectionVersions: new Map(),
  syncedProjectionKeys: new Set<string>(),
};

vi.mock("../store.js", () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
}));

import { SessionHoverCard } from "./SessionHoverCard.js";

function makeSession(overrides: Partial<SessionItemType> = {}): SessionItemType {
  return {
    id: "s1",
    model: "gpt-5.4",
    cwd: "/repo",
    gitBranch: "jiayi",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: Date.now(),
    archived: false,
    backendType: "codex",
    repoRoot: "/repo",
    permCount: 0,
    ...overrides,
  };
}

function setSessionNavigationProjection(sessionId: string, value = createSessionNavigationProjectionValue()) {
  const existingIndex = mockStoreState.sdkSessions.findIndex((session) => session.sessionId === sessionId);
  const existing = existingIndex >= 0 ? mockStoreState.sdkSessions[existingIndex] : undefined;
  const session = {
    ...existing,
    ...sessionNavigationProjectionToSessionFields(value),
    sessionId,
  } as (typeof mockStoreState.sdkSessions)[number];
  if (existingIndex >= 0) mockStoreState.sdkSessions[existingIndex] = session;
  else mockStoreState.sdkSessions.push(session);
}

function setSessionAttentionProjection(sessionId: string, value: SessionAttentionProjectionValue) {
  const entryId = syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, sessionId);
  mockStoreState.syncedProjectionKeys.add(entryId);
  mockStoreState.syncedProjectionValues.set(entryId, value);
}

function setLeaderTabsProjection(
  sessionId: string,
  tabs: ReturnType<typeof createLeaderThreadTabsProjectionTab>[],
): void {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, sessionId);
  mockStoreState.syncedProjectionKeys.add(entryId);
  mockStoreState.syncedProjectionValues.set(
    entryId,
    createLeaderThreadTabsProjectionValue({ tabs, mainAttention: {}, threadStatuses: {}, activePhaseSummary: [] }),
  );
}

describe("SessionHoverCard", () => {
  beforeEach(() => {
    mockStoreState.sessions = new Map();
    mockStoreState.cliConnected = new Map();
    mockStoreState.cliDisconnectReason = new Map();
    mockStoreState.sessionStatus = new Map();
    mockStoreState.pendingPermissions = new Map();
    mockStoreState.askPermission = new Map();
    mockStoreState.diffFileStats = new Map();
    mockStoreState.sessionPreviews = new Map();
    mockStoreState.sdkSessions = [];
    mockStoreState.sessionNames = new Map();
    mockStoreState.quests = undefined;
    mockStoreState.sessionBoards = undefined;
    mockStoreState.currentSessionId = undefined;
    mockStoreState.sessionTimers = new Map();
    mockStoreState.sessionNotifications = new Map();
    mockStoreState.sessionAttention = new Map();
    mockStoreState.syncedProjectionValues = new Map();
    mockStoreState.syncedProjectionVersions = new Map();
    mockStoreState.syncedProjectionKeys = new Set();
  });

  it("renders safely when the mocked store omits quests", () => {
    // q-425 follow-up: generic session hovers should not assume the store mock
    // includes a quests collection. Older tests and narrow mocks omit it.
    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Safe Hover"
        sessionPreview="Preview text"
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Safe Hover")).toBeInTheDocument();
    expect(screen.getByText("Preview text")).toBeInTheDocument();
    expect(screen.queryByTestId("session-hover-active-quest")).toBeNull();
  });

  it("renders projected name, preview, status, git, and detail ahead of stale props", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { name: "Projected hover", model: "projected-model" },
        lifecycle: { status: "running", pendingPermissionCount: 0 },
        git: { branch: "projected-branch", ahead: 2 },
        detail: { lastMessagePreview: "Projected preview", userTurnCount: 6, contextUsedPercent: 44 },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ model: "stale-model", gitBranch: "stale-branch", status: "idle" })}
        sessionName="Stale hover"
        sessionPreview="Stale preview"
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Projected hover")).toBeInTheDocument();
    expect(screen.getByText("Projected preview")).toBeInTheDocument();
    expect(screen.getByText("projected-model")).toBeInTheDocument();
    expect(screen.getByText("projected-branch")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("6 turns")).toBeInTheDocument();
    expect(screen.getByText("44% context")).toBeInTheDocument();
    expect(screen.queryByText("Stale preview")).toBeNull();
  });

  it("does not resurrect a cleared projected quest claim from the global quest cache", () => {
    mockStoreState.quests = [
      { questId: "q-42", title: "Stale active quest", status: "in_progress", sessionId: "s1", createdAt: 1 },
    ] as QuestmasterTask[];
    setSessionNavigationProjection("s1");

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Projected no-quest worker"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("session-hover-active-quest")).toBeNull();
    expect(screen.queryByText("Stale active quest")).toBeNull();
  });

  it("uses projected timer count for the selected-session hover status", () => {
    mockStoreState.currentSessionId = "s1";
    mockStoreState.sessionTimers.set("s1", [{ id: "stale-live-timer" }]);
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({ lifecycle: { status: "idle", pendingTimerCount: 0 } }),
    );

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Projected timer"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("idle")).toBeInTheDocument();
    expect(screen.queryByText(/scheduled timer/)).toBeNull();
  });

  it("shows timer status instead of plain idle when an idle session has active timers", () => {
    // Mirrors the screenshot gap: the hover card should agree with the
    // sidebar timer state instead of presenting a timed session as plain idle.
    render(
      <SessionHoverCard
        session={makeSession({ pendingTimerCount: 2 })}
        sessionName="Timed Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByTestId("session-status-timer-icon")).toHaveAttribute("data-count", "2");
    expect(screen.getByText("2 timers")).toBeInTheDocument();
    expect(screen.queryByText("idle")).toBeNull();
  });

  it("keeps running status ahead of hover-card timer state", () => {
    render(
      <SessionHoverCard
        session={makeSession({ status: "running", sdkState: "running", pendingTimerCount: 1 })}
        sessionName="Running Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByTestId("session-status-dot")).toHaveAttribute("data-status", "running");
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.queryByTestId("session-status-timer-icon")).toBeNull();
  });

  it("explains active needs-input status near the top of the hover card", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "action",
      status: { urgency: "needs-input", count: 2 },
    });
    render(
      <SessionHoverCard
        session={makeSession({
          notificationUrgency: "needs-input",
          activeNotificationCount: 2,
          activeNeedsInputNotificationCount: 2,
        })}
        sessionName="Needs Input Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("2 needs-input notifications");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-amber-400");
  });

  it("uses conversations for unread status copy without mixed tab wording", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "review",
      status: { urgency: "review", count: 3 },
    });
    render(
      <SessionHoverCard
        session={makeSession({
          notificationUrgency: "review",
          activeNotificationCount: 3,
          activeReviewNotificationCount: 3,
        })}
        sessionName="Unread Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("3 unread conversations");
    expect(status).not.toHaveTextContent("tabs/conversations");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-blue-500");
  });

  it("explains muted needs-input status with the existing muted gray dot", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: null,
      status: { urgency: "muted-needs-input", count: 1 },
    });
    render(
      <SessionHoverCard
        session={makeSession({
          notificationUrgency: null,
          activeNotificationCount: 0,
          mutedNeedsInputNotificationCount: 1,
        })}
        sessionName="Muted Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("1 muted needs-input notification");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-cc-muted/45");
  });

  it("does not explain stale amber needs-input after a newer cleared summary", () => {
    // The hover card must follow the same freshness guard as the sidebar row:
    // a versioned clear summary suppresses older cached full-inbox attention.
    mockStoreState.sessionNotifications.set("s1", [
      { id: "n-input", category: "needs-input", summary: "Need answer", timestamp: Date.now(), done: false },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "needs-input", activeNotificationCount: 1 })}
        sessionName="Cleared Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("does not explain stale unread conversations after a newer cleared summary", () => {
    // Selecting/reading a session can clear unread review status before this
    // browser refreshes an older cached full notification inbox. The hover card
    // must follow the fresh cleared summary, not the stale blue count.
    mockStoreState.sessionNotifications.set("s1", [
      { id: "n-review", category: "review", summary: "Review", timestamp: Date.now(), done: false },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        notificationUrgency: null,
        activeNotificationCount: 0,
        notificationStatusVersion: 5,
        notificationStatusUpdatedAt: 5000,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "review", activeNotificationCount: 8 })}
        sessionName="Cleared Unread Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByText(/unread conversation/i)).toBeNull();
    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("keeps backend-authored unread conversations visible while the leader session is selected", () => {
    // Selecting a leader session only proves the session shell was viewed. It
    // must not hide a fresh backend summary for an unread target thread; the
    // hover text should be consistent before and after selecting the row.
    mockStoreState.currentSessionId = "s1";
    mockStoreState.sessionNotifications.set("s1", [
      {
        id: "n-review",
        category: "review",
        summary: "q-1 ready for review",
        timestamp: Date.now(),
        done: false,
        threadKey: "q-1",
        questId: "q-1",
      },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 9,
        notificationStatusUpdatedAt: 9000,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-1"],
          closedThreadTombstones: [],
          updatedAt: 9000,
        },
      },
    ];
    setSessionAttentionProjection("s1", {
      attentionReason: "review",
      status: { urgency: "review", count: 1 },
    });

    render(
      <SessionHoverCard
        session={makeSession({ isOrchestrator: true, notificationUrgency: "review", activeNotificationCount: 1 })}
        sessionName="Selected Leader Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("1 unread conversation");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-blue-500");
  });

  it("does not show unread text after the projected leader review is cleared", () => {
    mockStoreState.sessionNotifications.set("s1", [
      {
        id: "n-review",
        category: "review",
        summary: "q-1 ready for review",
        timestamp: Date.now(),
        done: false,
        threadKey: "q-1",
        questId: "q-1",
      },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 10,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-1", closedAt: Date.now() }],
          updatedAt: Date.now(),
        },
      },
    ];

    setSessionAttentionProjection("s1", { attentionReason: null, status: null });
    render(
      <SessionHoverCard
        session={makeSession({ isOrchestrator: true, notificationUrgency: "review", activeNotificationCount: 1 })}
        sessionName="Closed Leader Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByText(/unread conversation/i)).toBeNull();
    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("does not explain stale action attention after notification status is cleared", () => {
    // Raw sessionAttention can outlive the versioned notification summary; the
    // hover card should match the row's effective action-attention suppression.
    mockStoreState.sessionAttention.set("s1", "action");

    render(
      <SessionHoverCard
        session={makeSession({
          notificationUrgency: null,
          activeNotificationCount: 0,
          notificationStatusVersion: 5,
        })}
        sessionName="Cleared Attention Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("uses projected muted attention ahead of a stale leader review summary", () => {
    // Closed leader review tabs are filtered before deriving the sidebar marker.
    // The hover explanation must therefore describe the visible muted marker,
    // not the raw unresolved review notification.
    mockStoreState.sessionNotifications.set("s1", [
      {
        id: "n-review",
        category: "review",
        summary: "q-1 ready for review",
        timestamp: Date.now(),
        done: false,
        threadKey: "q-1",
        questId: "q-1",
      },
      {
        id: "n-muted",
        category: "needs-input",
        summary: "Deferred answer",
        timestamp: Date.now(),
        done: false,
        muted: true,
        threadKey: "q-2",
        questId: "q-2",
      },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        isOrchestrator: true,
        notificationUrgency: "review",
        activeNotificationCount: 1,
        notificationStatusVersion: 7,
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: [],
          closedThreadTombstones: [{ threadKey: "q-1", closedAt: Date.now() }],
          updatedAt: Date.now(),
        },
      },
    ];

    setSessionAttentionProjection("s1", {
      attentionReason: null,
      status: { urgency: "muted-needs-input", count: 1 },
    });
    render(
      <SessionHoverCard
        session={makeSession({ isOrchestrator: true })}
        sessionName="Leader Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("1 muted needs-input notification");
    expect(status).not.toHaveTextContent("unread conversation");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-cc-muted/45");
  });

  it("uses the projected repeated-review count instead of legacy inbox and summary counts", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "review",
      status: { urgency: "review", count: 7 },
    });
    mockStoreState.sessionNotifications.set("s1", [
      { id: "legacy-input", category: "needs-input", summary: "Stale input", timestamp: 1, done: false },
    ]);
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        activeNeedsInputNotificationCount: 1,
        notificationStatusVersion: 3,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "needs-input", activeNotificationCount: 1 })}
        sessionName="Projected Review Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("7 unread conversations");
    expect(status).not.toHaveTextContent("needs-input");
    expect(within(status).getByTestId("session-hover-attention-status-dot")).toHaveClass("bg-blue-500");
  });

  it("uses projected needs-input urgency and count ahead of legacy review", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "action",
      status: { urgency: "needs-input", count: 2 },
    });
    mockStoreState.sessionAttention.set("s1", "review");

    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "review", activeNotificationCount: 9 })}
        sessionName="Projected Input Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const status = screen.getByTestId("session-hover-attention-status");
    expect(status).toHaveTextContent("2 needs-input notifications");
    expect(status).not.toHaveTextContent("unread conversation");
  });

  it("uses projected muted-only status and projected clear without legacy resurrection", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: null,
      status: { urgency: "muted-needs-input", count: 4 },
    });
    mockStoreState.sessionNotifications.set("s1", [
      { id: "legacy-review", category: "review", summary: "Stale review", timestamp: 1, done: false },
    ]);

    const view = render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "review", activeNotificationCount: 1 })}
        sessionName="Projected Muted Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByTestId("session-hover-attention-status")).toHaveTextContent("4 muted needs-input notifications");
    view.unmount();

    setSessionAttentionProjection("s1", { attentionReason: null, status: null });
    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "review", activeNotificationCount: 1 })}
        sessionName="Projected Clear Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("does not show active attention for an archived session with stale projected or legacy state", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "review",
      status: { urgency: "review", count: 7 },
    });
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        archived: true,
        notificationUrgency: "review",
        activeNotificationCount: 7,
        activeReviewNotificationCount: 7,
        notificationStatusVersion: 4,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession({
          archived: true,
          notificationUrgency: "review",
          activeNotificationCount: 7,
          activeReviewNotificationCount: 7,
        })}
        sessionName="Archived Attention Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("keeps permission precedence over a projected attention status", () => {
    setSessionAttentionProjection("s1", {
      attentionReason: "action",
      status: { urgency: "needs-input", count: 2 },
    });

    render(
      <SessionHoverCard
        session={makeSession({ permCount: 1 })}
        sessionName="Permission Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByTestId("session-status-dot")).toHaveAttribute("data-status", "permission");
    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("preserves projected error semantics without inventing hover urgency", () => {
    setSessionAttentionProjection("s1", { attentionReason: "error", status: null });
    mockStoreState.sessionNotifications.set("s1", [
      { id: "legacy-input", category: "needs-input", summary: "Stale input", timestamp: 1, done: false },
    ]);

    render(
      <SessionHoverCard
        session={makeSession({ notificationUrgency: "needs-input", activeNotificationCount: 1 })}
        sessionName="Error Hover"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.queryByTestId("session-hover-attention-status")).toBeNull();
  });

  it("keeps projected Codex leader hover context on the backend model window", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        topology: { isOrchestrator: true },
        detail: {
          contextUsedPercent: 6,
          contextTokensUsed: 57_000,
          modelContextWindow: 950_000,
          effectiveContextWindow: 260_000,
        },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ isOrchestrator: true })}
        sessionName="Leader context"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("6% context")).toBeInTheDocument();
    expect(screen.getByText(/950 K tokens/)).toBeInTheDocument();
    expect(screen.queryByText(/260 K tokens/)).toBeNull();
  });

  it("shows the max context window rounded to whole K tokens", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        detail: {
          userTurnCount: 1,
          contextUsedPercent: 73,
          modelContextWindow: 258_400,
          messageHistoryBytes: 1_572_864,
          codexRetainedPayloadBytes: 2_621_440,
        },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Explain Codex Session Steering"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("73% context")).toBeInTheDocument();
    expect(screen.getByText("1.5 MB replay")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB retained")).toBeInTheDocument();
    expect(screen.getByText("258 K tokens")).toBeInTheDocument();

    const contextRow = screen.getByTestId("session-context-stats");
    const payloadRow = screen.getByTestId("session-payload-stats");
    expect(within(contextRow).getByText("73% context")).toBeInTheDocument();
    expect(within(contextRow).getByText("258 K tokens")).toBeInTheDocument();
    expect(within(contextRow).queryByText("1.5 MB replay")).toBeNull();
    expect(within(payloadRow).getByText("1 turn")).toBeInTheDocument();
    expect(within(payloadRow).getByText("1.5 MB replay")).toBeInTheDocument();
    expect(within(payloadRow).getByText("2.5 MB retained")).toBeInTheDocument();
    expect(within(payloadRow).queryByText("73% context")).toBeNull();
    expect(within(payloadRow).queryByText("258 K tokens")).toBeNull();
  });

  it("uses current session-row metadata when no live projection is present", () => {
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        state: "connected",
        cwd: "/repo",
        backendType: "codex",
        contextUsedPercent: 73,
        modelContextWindow: 258_400,
        messageHistoryBytes: 972_800,
        codexRetainedPayloadBytes: 1_228_800,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Explain Codex Session Steering"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("73% context")).toBeInTheDocument();
    expect(screen.getByText("950 KB replay")).toBeInTheDocument();
    expect(screen.getByText("1.2 MB retained")).toBeInTheDocument();
    expect(screen.getByText("258 K tokens")).toBeInTheDocument();
  });

  it("shows effective Codex context primary and configured usable target secondarily", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { model: "gpt-5.5" },
        detail: {
          userTurnCount: 1,
          contextUsedPercent: 7,
          modelContextWindow: 258_400,
          codexMaxContextLength: 600_000,
          messageHistoryBytes: 1_572_864,
          codexRetainedPayloadBytes: 2_621_440,
        },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ backendType: "codex", model: "gpt-5.5" })}
        sessionName="Bold Cedar"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("7% context")).toBeInTheDocument();
    expect(screen.getByText("258 K tokens")).toHaveAttribute(
      "title",
      "Backend reported usable context window. Configured usable target is 600 K tokens.",
    );
    const configuredContext = screen.getByTitle(
      "Configured usable capacity target. Runtime /status updates after relaunch or backend evidence.",
    );
    expect(configuredContext).toHaveTextContent("600 K tokens");
    expect(configuredContext).toHaveTextContent("target");

    const contextRow = screen.getByTestId("session-context-stats");
    const payloadRow = screen.getByTestId("session-payload-stats");
    expect(within(contextRow).getByText("7% context")).toBeInTheDocument();
    expect(within(contextRow).getByText("258 K tokens")).toBeInTheDocument();
    expect(within(contextRow).getByText("600 K tokens")).toBeInTheDocument();
    expect(within(contextRow).getByText("target")).toBeInTheDocument();
    expect(within(contextRow).queryByText("1.5 MB replay")).toBeNull();
    expect(within(payloadRow).getByText("1 turn")).toBeInTheDocument();
    expect(within(payloadRow).getByText("1.5 MB replay")).toBeInTheDocument();
    expect(within(payloadRow).getByText("2.5 MB retained")).toBeInTheDocument();
    expect(within(payloadRow).queryByText("7% context")).toBeNull();
    expect(within(payloadRow).queryByText("600 K tokens")).toBeNull();
    expect(within(payloadRow).queryByText("target")).toBeNull();
  });

  it("honors a projected Codex max-context clear over stale launcher metadata", () => {
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        state: "connected",
        cwd: "/repo",
        backendType: "codex",
        codexMaxContextLength: 600_000,
        modelContextWindow: 258_400,
      },
    ];
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { model: "gpt-5.5" },
        detail: { contextUsedPercent: 7, modelContextWindow: 258_400, codexMaxContextLength: null },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ backendType: "codex", model: "gpt-5.5" })}
        sessionName="Bold Cedar"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("258 K tokens")).toBeInTheDocument();
    expect(screen.queryByText("600 K tokens")).toBeNull();
  });

  it("uses the backend-owned user turn count for the visible turns label", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({ detail: { userTurnCount: 12, agentTurnCount: 9 } }),
    );

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Backend Turn Count"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("12 turns")).toBeInTheDocument();
    expect(screen.queryByText("1 turn")).toBeNull();
  });

  it("uses current session-row turns without consulting selected-session state", () => {
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        state: "connected",
        cwd: "/repo",
        backendType: "codex",
        userTurnCount: 12,
        agentTurnCount: 9,
        numTurns: 1,
      },
    ];

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Backend Turn Count"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("12 turns")).toBeInTheDocument();
    expect(screen.queryByText("1 turn")).toBeNull();
  });

  it("uses projected payload metrics ahead of stale launcher-row metadata", () => {
    mockStoreState.sdkSessions = [
      {
        sessionId: "s1",
        state: "connected",
        cwd: "/repo",
        backendType: "codex",
        messageHistoryBytes: 972_800,
        codexRetainedPayloadBytes: 1_228_800,
        modelContextWindow: 258_400,
      },
    ];
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        detail: {
          userTurnCount: 1,
          contextUsedPercent: 73,
          modelContextWindow: 258_400,
          messageHistoryBytes: 1_572_864,
          codexRetainedPayloadBytes: 2_621_440,
        },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Explain Codex Session Steering"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("1.5 MB replay")).toBeInTheDocument();
    expect(screen.getByText("2.5 MB retained")).toBeInTheDocument();
    expect(screen.queryByText("950 KB replay")).toBeNull();
  });

  it("keeps non-Codex sessions on history wording and hides retained payload", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { backendType: "claude-sdk", model: "claude-sonnet-4-5-20250929" },
        detail: { userTurnCount: 2, contextUsedPercent: 41, modelContextWindow: 200_000, messageHistoryBytes: 972_800 },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ backendType: "claude-sdk", model: "claude-sonnet-4-5-20250929" })}
        sessionName="Explain Claude Session Metrics"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("950 KB history")).toBeInTheDocument();
    expect(screen.queryByText(/retained/)).toBeNull();
  });

  it("uses projected backend identity for header copy and stat labeling", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { backendType: "codex", model: "gpt-5.4" },
        detail: {
          userTurnCount: 1,
          contextUsedPercent: 73,
          modelContextWindow: 258_400,
          messageHistoryBytes: 1_572_864,
          codexRetainedPayloadBytes: 2_621_440,
        },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ backendType: "claude-sdk" })}
        sessionName="Projected Backend Test"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Codex")).toBeInTheDocument();
    expect(screen.getByText("1.5 MB replay")).toBeInTheDocument();
  });

  it("shows Claude SDK context stats with turns but no cost", () => {
    setSessionNavigationProjection(
      "s1",
      createSessionNavigationProjectionValue({
        identity: { backendType: "claude-sdk", model: "claude-sonnet-4-5-20250929" },
        detail: { userTurnCount: 7, contextUsedPercent: 41, modelContextWindow: 200_000 },
      }),
    );

    render(
      <SessionHoverCard
        session={makeSession({ backendType: "claude-sdk", model: "claude-sonnet-4-5-20250929" })}
        sessionName="Explain Claude Session Metrics"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("41% context")).toBeInTheDocument();
    expect(screen.getByText("200 K tokens")).toBeInTheDocument();
    expect(screen.getByText("7 turns")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).toBeNull();
  });

  it("shows worktree and base repo paths separately with concise path tails", () => {
    render(
      <SessionHoverCard
        session={makeSession({
          cwd: "/Users/test/.companion/worktrees/companion/jiayi-wt-3116",
          repoRoot: "/Users/test/Code/companion",
          isWorktree: true,
        })}
        sessionName="Fix hover card path layout"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Worktree")).toBeInTheDocument();
    expect(screen.getByText("Base repo")).toBeInTheDocument();
    expect(screen.getByTestId("session-hover-path-worktree-tail")).toHaveTextContent("jiayi-wt-3116");
    expect(screen.getByTestId("session-hover-path-repo-tail")).toHaveTextContent("companion");
  });

  it("shows pending archived worktree cleanup status", () => {
    // Protects hover-card diagnostics for the async archive path: pending work
    // should read as intentional background cleanup, not a missing worktree state.
    render(
      <SessionHoverCard
        session={makeSession({
          archived: true,
          isWorktree: true,
          worktreeExists: true,
          worktreeCleanupStatus: "pending",
        })}
        sessionName="Archived worker"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Worktree cleanup in progress")).toBeInTheDocument();
  });

  it("shows failed archived worktree cleanup status", () => {
    // Protects the post-archive debugging path so users can see the cleanup
    // error directly from the hover card when background deletion fails.
    render(
      <SessionHoverCard
        session={makeSession({
          archived: true,
          isWorktree: true,
          worktreeExists: true,
          worktreeCleanupStatus: "failed",
          worktreeCleanupError: "git worktree remove failed",
        })}
        sessionName="Archived worker"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("git worktree remove failed")).toBeInTheDocument();
  });

  it("shows projected active quests for leaders instead of herding chips or task history", () => {
    mockStoreState.sdkSessions = [
      {
        sessionId: "worker-1",
        sessionNum: 21,
        state: "idle",
        backendType: "codex",
        cwd: "/repo/worktree-1",
        herdedBy: "s1",
      },
      {
        sessionId: "worker-2",
        sessionNum: 22,
        state: "running",
        backendType: "claude",
        cwd: "/repo/worktree-2",
        herdedBy: "s1",
      },
    ];
    mockStoreState.sessionNames = new Map([
      ["worker-1", "Fix notification links"],
      ["worker-2", "Improve hover chips"],
    ]);
    mockStoreState.quests = [
      {
        questId: "q-200",
        title: "Fallback alignment title from Questmaster",
        status: "refined",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        description: "",
      } as QuestmasterTask,
    ];
    mockStoreState.sessionBoards = new Map([
      [
        "s1",
        [
          {
            questId: "q-200",
            status: "PLANNING",
            updatedAt: Date.now(),
            journey: { mode: "active", phaseIds: ["alignment", "work", "memory"], currentPhaseId: "alignment" },
          },
          {
            questId: "q-100",
            title: "Implement the leader hover active quest list with a title long enough to truncate",
            status: "WORKING",
            updatedAt: Date.now() - 60_000,
            journey: { mode: "active", phaseIds: ["alignment", "work", "memory"], currentPhaseId: "work" },
          },
        ],
      ],
    ]);

    setLeaderTabsProjection("s1", [
      createLeaderThreadTabsProjectionTab("q-100", {
        title: "Implement the leader hover active quest list with a title long enough to truncate",
        boardStatus: "WORKING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 3,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
      createLeaderThreadTabsProjectionTab("q-200", {
        title: null,
        boardStatus: "PLANNING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "alignment",
          activePhaseIndex: 0,
          phaseCount: 3,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
    ]);

    try {
      render(
        <SessionHoverCard
          session={makeSession({ isOrchestrator: true })}
          sessionName="Leader Session"
          sessionPreview="Latest leader coordination update"
          taskHistory={[
            {
              title: "Legacy leader task that should not render",
              action: "name",
              timestamp: Date.now(),
              triggerMessageId: "msg-legacy-leader-task",
            },
          ]}
          cliSessionId="cli-1"
          anchorRect={new DOMRect(120, 80, 200, 40)}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
        />,
      );

      expect(screen.getByTestId("session-hover-card")).toHaveStyle({ width: "425px" });
      expect(screen.queryByText("Herding")).toBeNull();
      expect(screen.queryByRole("button", { name: "#21" })).toBeNull();
      expect(screen.queryByRole("button", { name: "#22" })).toBeNull();
      expect(screen.queryByText("Tasks")).toBeNull();
      expect(screen.queryByText("Legacy leader task that should not render")).toBeNull();

      const section = screen.getByTestId("session-hover-active-quests");
      expect(within(section).getByText("Active quests")).toBeInTheDocument();
      const rows = within(section).getAllByTestId("session-hover-active-quest-row");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveAttribute("data-quest-id", "q-100");
      expect(rows[0]).toHaveAttribute("data-phase-color", "work");
      expect(rows[0]).toHaveAttribute("data-title-color", "normal");
      const workPhase = within(rows[0]).getByTestId("session-hover-active-quest-phase");
      expect(workPhase).toHaveTextContent("Work");
      expect(workPhase).toHaveAttribute("style", "color: var(--color-cc-phase-work, #166534);");
      const implementTitle = within(rows[0]).getByText(
        "Implement the leader hover active quest list with a title long enough to truncate",
      );
      expect(implementTitle).toHaveClass("truncate", "text-cc-fg");
      expect(implementTitle).not.toHaveAttribute("style");
      expect(rows[1]).toHaveAttribute("data-quest-id", "q-200");
      expect(rows[1]).toHaveAttribute("data-phase-color", "alignment");
      expect(within(rows[1]).getByText("Alignment")).toHaveAttribute(
        "style",
        "color: var(--color-cc-phase-alignment, #0369a1);",
      );
      expect(rows[1]).toHaveAttribute("data-title-color", "normal");
      const fallbackTitle = within(rows[1]).getByText("Fallback alignment title from Questmaster");
      expect(fallbackTitle).toHaveClass("text-cc-fg");
      expect(fallbackTitle).not.toHaveAttribute("style");
      expect(screen.getByText("Last message")).toBeInTheDocument();
      expect(screen.getByText("Latest leader coordination update")).toBeInTheDocument();
    } finally {
      mockStoreState.sdkSessions = [];
      mockStoreState.sessionNames = new Map();
      mockStoreState.quests = undefined;
      mockStoreState.sessionBoards = undefined;
    }
  });

  it("shows synchronized leader active quests with or without loaded board detail", () => {
    mockStoreState.quests = [
      {
        questId: "q-snapshot",
        title: "Snapshot-provided active quest",
        status: "in_progress",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        description: "",
      } as QuestmasterTask,
    ];
    mockStoreState.sessionBoards = new Map([
      [
        "torchflow-leader",
        [
          {
            questId: "q-live",
            title: "Torchflow live active quest",
            status: "IMPLEMENTING",
            createdAt: 1,
            updatedAt: 3,
            journey: { mode: "active", phaseIds: ["alignment", "implement"], currentPhaseId: "implement" },
          },
        ],
      ],
    ]);

    setLeaderTabsProjection("torchflow-leader", [
      createLeaderThreadTabsProjectionTab("q-live", {
        title: "Torchflow live active quest",
        boardStatus: "IMPLEMENTING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work"],
          currentPhaseId: "work",
          activePhaseIndex: 1,
          phaseCount: 2,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
    ]);

    const live = render(
      <SessionHoverCard
        session={makeSession({ id: "torchflow-leader", isOrchestrator: true })}
        sessionName="Torchflow Leader"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-1"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    expect(screen.getByText("Torchflow live active quest")).toBeInTheDocument();
    live.unmount();

    mockStoreState.sessionBoards = new Map();
    setLeaderTabsProjection("other-leader", [
      createLeaderThreadTabsProjectionTab("q-snapshot", {
        title: null,
        boardStatus: "PLANNING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work"],
          currentPhaseId: "alignment",
          activePhaseIndex: 0,
          phaseCount: 2,
          durationSummary: null,
        },
        active: true,
        canClose: false,
      }),
    ]);
    render(
      <SessionHoverCard
        session={makeSession({ id: "other-leader", isOrchestrator: true })}
        sessionName="Other Leader"
        sessionPreview={undefined}
        taskHistory={undefined}
        cliSessionId="cli-2"
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={() => {}}
      />,
    );

    const section = screen.getByTestId("session-hover-active-quests");
    expect(within(section).getByText("Snapshot-provided active quest")).toBeInTheDocument();
    expect(within(section).getByText("Alignment")).toBeInTheDocument();
  });
});
