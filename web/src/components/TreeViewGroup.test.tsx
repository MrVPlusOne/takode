// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
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
  sessionNotifications: new Map<string, Array<unknown>>(),
  sessionTimers: new Map<string, Array<{ id: string }>>(),
  currentSessionId: null as string | null,
};

vi.mock("../store.js", () => ({
  useStore: (selector: (state: typeof mockStoreState) => unknown) => selector(mockStoreState),
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

vi.mock("../utils/routing.js", () => ({
  navigateToSession: vi.fn(),
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
      pendingPermissions={new Map()}
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
