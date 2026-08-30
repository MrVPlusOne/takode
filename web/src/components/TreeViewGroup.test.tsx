// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";
import type { TreeViewGroupData } from "../utils/tree-grouping.js";

const mockStoreState = {
  reorderMode: false,
  sessionSortMode: "created" as const,
  expandedHerdNodes: new Set<string>(),
  toggleHerdNodeExpand: vi.fn(),
  questNamedSessions: new Set<string>(),
  sessions: new Map<string, { claimedQuestStatus?: string }>(),
  sessionTaskPreview: new Map<string, { text: string; updatedAt: number }>(),
  sessionPreviewUpdatedAt: new Map<string, number>(),
  sessionAttention: new Map<string, "action" | "error" | "review" | null>(),
  syncedProjectionValues: new Map<string, unknown>(),
  syncedProjectionVersions: new Map(),
  syncedProjectionKeys: new Set<string>(),
  sessionNotifications: new Map<string, Array<unknown>>(),
  sessionTimers: new Map<string, Array<{ id: string }>>(),
  sessionBoards: new Map<string, Array<unknown>>(),
  sessionCompletedBoards: new Map<string, Array<unknown>>(),
  sessionBoardRowStatuses: new Map<string, Record<string, unknown>>(),
  quests: [] as Array<unknown>,
  sdkSessions: [] as Array<{ sessionId: string; leaderActivePhaseSummary?: unknown }>,
  currentSessionId: null as string | null,
};

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState), {
    getState: () => mockStoreState,
  }),
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
}));

vi.mock("../api.js", () => ({
  api: {
    renameTreeGroup: vi.fn(),
    deleteTreeGroup: vi.fn(),
  },
}));

vi.mock("../utils/mobile.js", () => ({
  isTouchDevice: () => false,
}));

const mockNavigateToSession = vi.hoisted(() => vi.fn());

vi.mock("../utils/routing.js", () => ({
  navigateToSession: mockNavigateToSession,
}));

import { TreeViewGroup } from "./TreeViewGroup.js";

function makeSession(id: string, overrides: Partial<SidebarSessionItem> = {}): SidebarSessionItem {
  return {
    id,
    model: id,
    cwd: "/repo",
    gitBranch: "main",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: 1700000000000,
    archived: false,
    backendType: "codex",
    repoRoot: "/repo",
    permCount: 0,
    ...overrides,
  };
}

function renderTreeViewGroup(group: TreeViewGroupData, overrides: Partial<ComponentProps<typeof TreeViewGroup>> = {}) {
  return render(
    <TreeViewGroup
      group={group}
      isGroupCollapsed={false}
      collapsedTreeNodes={new Set()}
      onToggleGroupCollapse={vi.fn()}
      onToggleNodeCollapse={vi.fn()}
      onCreateSession={vi.fn()}
      currentSessionId={null}
      sessionNames={new Map()}
      sessionPreviews={new Map()}
      recentlyRenamed={new Set()}
      onSelect={vi.fn()}
      onStartRename={vi.fn()}
      onArchive={vi.fn()}
      onUnarchive={vi.fn()}
      onDelete={vi.fn()}
      onClearRecentlyRenamed={vi.fn()}
      editingSessionId={null}
      editingName=""
      setEditingName={vi.fn()}
      onConfirmRename={vi.fn()}
      onCancelRename={vi.fn()}
      editInputRef={{ current: null }}
      isFirst
      sessionAttention={mockStoreState.sessionAttention}
      {...overrides}
    />,
  );
}

describe("TreeViewGroup leader herd summary", () => {
  beforeEach(() => {
    mockStoreState.expandedHerdNodes.clear();
    mockStoreState.sessionAttention.clear();
    mockStoreState.syncedProjectionValues.clear();
    mockStoreState.syncedProjectionVersions.clear();
    mockStoreState.syncedProjectionKeys.clear();
    mockStoreState.sessionTimers.clear();
    mockStoreState.sessionBoards.clear();
    mockStoreState.sessionCompletedBoards.clear();
    mockStoreState.sessionBoardRowStatuses.clear();
    mockStoreState.quests = [];
    mockStoreState.currentSessionId = null;
    mockNavigateToSession.mockReset();
  });

  it("includes reviewers in member counts and status dots", () => {
    // Reviewer sessions render as inline chips, so the always-visible summary
    // must still expose their count and live status at the leader group level.
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const worker = makeSession("worker-1", { herdedBy: "leader-1", sessionNum: 11 });
    const reviewer = makeSession("reviewer-1", { reviewerOf: 11, sessionNum: 12, status: "running" });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [worker], reviewers: [reviewer] }],
      runningCount: 1,
      permCount: 0,
      unreadCount: 0,
    };

    renderTreeViewGroup(group);

    const summary = screen.getByTestId("herd-summary-leader-1");
    expect(within(summary).getByText("1 worker, 1 reviewer")).toBeInTheDocument();
    expect(summary).toHaveAttribute("title", "Expand sessions");
    const runningIndicator = Array.from(summary.querySelectorAll(".text-cc-success")).find(
      (el) => el.textContent?.trim() === "1",
    );
    expect(runningIndicator).toBeTruthy();
    expect(runningIndicator?.querySelector(".bg-cc-success.rounded-full")).toBeInTheDocument();
  });

  it("shows timer-backed waiting child sessions without counting them as idle", () => {
    // Waiting in the leader preview means the same timer-backed clock state as
    // child rows: otherwise-idle workers/reviewers with scheduled timers.
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const waitingWorker = makeSession("worker-1", {
      herdedBy: "leader-1",
      sessionNum: 11,
      pendingTimerCount: 1,
    });
    const idleReviewer = makeSession("reviewer-1", { reviewerOf: 11, sessionNum: 12 });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [waitingWorker], reviewers: [idleReviewer] }],
      runningCount: 0,
      permCount: 0,
      unreadCount: 0,
    };

    renderTreeViewGroup(group);

    const summary = screen.getByTestId("herd-summary-leader-1");
    const waitingIndicator = within(summary).getByTestId("status-count-waiting");
    expect(waitingIndicator).toHaveTextContent("1");
    expect(waitingIndicator).toHaveAccessibleName("1 waiting session with scheduled timer");
    expect(within(waitingIndicator).getByTestId("session-status-timer-icon")).toHaveAttribute(
      "data-status",
      "scheduled_timer",
    );

    const idleIndicator = Array.from(summary.querySelectorAll(".text-cc-muted\\/50")).find(
      (el) => el.textContent?.trim() === "1" && el.querySelector(".bg-cc-muted\\/30"),
    );
    expect(idleIndicator).toBeTruthy();
  });

  it("uses row-owned permission and pause authority in the herd summary", () => {
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const permissionWorker = makeSession("permission-worker", { herdedBy: "leader-1", permCount: 2 });
    const pausedTimerWorker = makeSession("paused-worker", {
      herdedBy: "leader-1",
      pendingTimerCount: 1,
      paused: true,
    });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [permissionWorker, pausedTimerWorker], reviewers: [] }],
      runningCount: 0,
      permCount: 2,
      unreadCount: 0,
    };

    renderTreeViewGroup(group);

    const summary = screen.getByTestId("herd-summary-leader-1");
    expect(within(summary).getByTestId("status-count-permission")).toHaveTextContent("1");
    expect(within(summary).queryByTestId("status-count-waiting")).toBeNull();
  });

  it("keeps projected timer count authoritative for the selected child", () => {
    mockStoreState.currentSessionId = "worker-1";
    mockStoreState.sessionTimers.set("worker-1", [{ id: "stale-live-timer" }]);
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const worker = makeSession("worker-1", {
      herdedBy: "leader-1",
      sessionNum: 11,
      navigationProjectionOwned: true,
      pendingTimerCount: 0,
    });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [worker], reviewers: [] }],
      runningCount: 0,
      permCount: 0,
      unreadCount: 0,
    };

    renderTreeViewGroup(group, { currentSessionId: "worker-1" });

    expect(within(screen.getByTestId("herd-summary-leader-1")).queryByTestId("status-count-waiting")).toBeNull();
  });

  it("uses live timer state for the selected child session in the herd summary", () => {
    // Match SessionItem behavior: the active row uses the live timer store
    // instead of potentially stale polled snapshot timer counts.
    mockStoreState.currentSessionId = "worker-1";
    mockStoreState.sessionTimers.set("worker-1", [{ id: "timer-1" }]);
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const worker = makeSession("worker-1", { herdedBy: "leader-1", sessionNum: 11 });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [worker], reviewers: [] }],
      runningCount: 0,
      permCount: 0,
      unreadCount: 0,
    };

    renderTreeViewGroup(group, { currentSessionId: "worker-1" });

    const summary = screen.getByTestId("herd-summary-leader-1");
    expect(within(summary).getByTestId("status-count-waiting")).toHaveTextContent("1");
    expect(summary.querySelector(".bg-cc-muted\\/30")).toBeNull();
  });

  it("renders compact reviewer session chips inside quest worker rows", () => {
    // Worker rows with quest context still need an explicit reviewer-session
    // target, otherwise the leader sidebar has no route into the reviewer.
    mockStoreState.expandedHerdNodes.add("leader-1");
    mockStoreState.quests = [
      {
        questId: "q-42",
        title: "Restore reviewer chips",
        status: "in_progress",
        sessionId: "worker-1",
        createdAt: 1,
      },
    ];
    mockStoreState.sessionBoards.set("leader-1", [
      { questId: "q-42", title: "Restore reviewer chips", worker: "worker-1", workerNum: 11, updatedAt: 2 },
    ]);
    const leader = makeSession("leader-1", { isOrchestrator: true, sessionNum: 10 });
    const worker = makeSession("worker-1", { herdedBy: "leader-1", sessionNum: 11, isWorktree: true });
    const reviewer = makeSession("reviewer-1", { reviewerOf: 11, sessionNum: 12, status: "idle" });
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader, workers: [worker], reviewers: [reviewer] }],
      runningCount: 0,
      permCount: 0,
      unreadCount: 0,
    };

    const { container } = renderTreeViewGroup(group);

    const workerRow = container.querySelector('[data-session-id="worker-1"]');
    expect(workerRow).toBeTruthy();
    const badge = within(workerRow as HTMLElement).getByTestId("session-reviewer-badge");
    expect(badge).toHaveTextContent("reviewer");
    expect(badge).toHaveAccessibleName("Reviewer #12, click to open");
    expect(badge).toHaveClass("max-w-[3.75rem]", "gap-px", "overflow-hidden", "px-1");
    expect(badge).not.toHaveTextContent("Reviewer of");
    expect(within(workerRow as HTMLElement).getByText("wt")).toBeInTheDocument();

    fireEvent.click(badge);

    expect(mockNavigateToSession).toHaveBeenCalledWith("reviewer-1");
  });

  it("keeps create available on collapsed Session Spaces without toggling collapse", () => {
    // The per-space create button is the primary creation path after the
    // global sidebar button is removed, so it must stay independent from the
    // collapse target even when the Session Space is collapsed.
    const onCreateSession = vi.fn();
    const onToggleGroupCollapse = vi.fn();
    const group: TreeViewGroupData = {
      id: "team-alpha",
      name: "Takode",
      nodes: [{ leader: makeSession("leader-1"), workers: [], reviewers: [] }],
      runningCount: 0,
      permCount: 0,
      unreadCount: 0,
    };

    renderTreeViewGroup(group, {
      isGroupCollapsed: true,
      onCreateSession,
      onToggleGroupCollapse,
    });

    const createButton = screen.getByLabelText("Create session in Takode Session Space");
    expect(createButton).toHaveTextContent("+New");
    expect(createButton).toHaveClass("h-6", "bg-cc-primary", "hover:bg-cc-primary-hover", "text-white");
    expect(createButton.className).not.toContain("border");
    expect(createButton.className).not.toContain("bg-cc-primary/10");

    createButton.click();

    expect(onCreateSession).toHaveBeenCalledWith("team-alpha");
    expect(onToggleGroupCollapse).not.toHaveBeenCalled();
  });
});
