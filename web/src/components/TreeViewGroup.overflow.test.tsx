// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps, ReactNode } from "react";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";
import type { TreeViewGroupData } from "../utils/tree-grouping.js";

const mockApi = vi.hoisted(() => ({
  renameTreeGroup: vi.fn(),
  deleteTreeGroup: vi.fn(),
}));

const storeState = vi.hoisted(() => ({
  reorderMode: false,
  sessionSortMode: "created" as const,
  expandedHerdNodes: new Set<string>(),
  toggleHerdNodeExpand: vi.fn(),
}));

vi.mock("../api.js", () => ({ api: mockApi }));
vi.mock("../utils/mobile.js", () => ({ isTouchDevice: () => false }));
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: ({ children }: { children: ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: {},
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));
vi.mock("../store.js", () => ({
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));
vi.mock("./SessionItem.js", () => ({
  SessionItem: ({
    session,
    reviewerSession,
  }: {
    session: SidebarSessionItem;
    reviewerSession?: SidebarSessionItem;
  }) => (
    <div data-testid={`session-row-${session.id}`}>
      {session.model}
      {reviewerSession ? (
        <span data-testid={`session-reviewer-${reviewerSession.id}`}>{reviewerSession.model}</span>
      ) : null}
    </div>
  ),
  StatusCountDots: () => null,
}));

import { TreeViewGroup } from "./TreeViewGroup.js";

function session(id: string, overrides: Partial<SidebarSessionItem> = {}): SidebarSessionItem {
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
    createdAt: 1,
    archived: false,
    backendType: "claude",
    repoRoot: "/repo",
    permCount: 0,
    ...overrides,
  };
}

function group(count: number): TreeViewGroupData {
  return {
    id: "default",
    name: "Default",
    runningCount: 0,
    permCount: 0,
    unreadCount: 0,
    nodes: Array.from({ length: count }, (_, index) => ({
      leader: session(`s-${index + 1}`),
      workers: [],
      reviewers: [],
    })),
  };
}

function groupWithHerdUnit(): TreeViewGroupData {
  return {
    id: "default",
    name: "Default",
    runningCount: 0,
    permCount: 0,
    unreadCount: 0,
    nodes: [
      {
        leader: session("leader-1", { sessionNum: 1, isOrchestrator: true }),
        workers: [
          session("worker-1", { sessionNum: 2, herdedBy: "leader-1" }),
          session("worker-2", { sessionNum: 3, herdedBy: "leader-1" }),
        ],
        reviewers: [session("reviewer-1", { sessionNum: 4, reviewerOf: 1 })],
      },
      {
        leader: session("standalone-2"),
        workers: [],
        reviewers: [],
      },
      {
        leader: session("standalone-3"),
        workers: [],
        reviewers: [],
      },
    ],
  };
}

function groupWithHiddenHerdUnit(): TreeViewGroupData {
  return {
    id: "default",
    name: "Default",
    runningCount: 0,
    permCount: 0,
    unreadCount: 0,
    nodes: [
      {
        leader: session("standalone-1"),
        workers: [],
        reviewers: [],
      },
      {
        leader: session("standalone-2"),
        workers: [],
        reviewers: [],
      },
      {
        leader: session("leader-hidden", { sessionNum: 10, isOrchestrator: true }),
        workers: [session("worker-hidden", { sessionNum: 11, herdedBy: "leader-hidden" })],
        reviewers: [session("reviewer-hidden", { sessionNum: 12, reviewerOf: 10 })],
      },
    ],
  };
}

function renderGroup(props: Partial<ComponentProps<typeof TreeViewGroup>> = {}) {
  const baseProps: ComponentProps<typeof TreeViewGroup> = {
    group: group(12),
    isGroupCollapsed: false,
    collapsedTreeNodes: new Set(),
    onToggleGroupCollapse: vi.fn(),
    onToggleNodeCollapse: vi.fn(),
    onCreateSession: vi.fn(),
    currentSessionId: null,
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    pendingPermissions: new Map(),
    recentlyRenamed: new Set(),
    onSelect: vi.fn(),
    onStartRename: vi.fn(),
    onArchive: vi.fn(),
    onUnarchive: vi.fn(),
    onDelete: vi.fn(),
    onClearRecentlyRenamed: vi.fn(),
    editingSessionId: null,
    editingName: "",
    setEditingName: vi.fn(),
    onConfirmRename: vi.fn(),
    onCancelRename: vi.fn(),
    editInputRef: { current: null },
    isFirst: true,
    visibleSessionLimit: 10,
    overflowExpanded: false,
    onToggleOverflow: vi.fn(),
    onSetVisibleSessionLimit: vi.fn(),
  };
  return render(<TreeViewGroup {...baseProps} {...props} />);
}

describe("TreeViewGroup overflow", () => {
  beforeEach(() => {
    storeState.expandedHerdNodes.clear();
    vi.clearAllMocks();
  });

  it("folds groups past the visible limit and exposes a more control", () => {
    // Large groups should keep the sidebar scannable by rendering the configured top slice first.
    const onToggleOverflow = vi.fn();
    renderGroup({ onToggleOverflow });

    expect(screen.getByTestId("session-row-s-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-s-10")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-s-11")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show 2 more sessions in Default" }));

    expect(onToggleOverflow).toHaveBeenCalledWith("default");
  });

  it("renders all sessions once overflow is expanded", () => {
    renderGroup({ overflowExpanded: true });

    expect(screen.getByTestId("session-row-s-12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer sessions in Default" })).toBeInTheDocument();
  });

  it("keeps the active session visible when it is below the folded limit", () => {
    // The current session anchors user orientation, so folded overflow can add it beyond the configured top slice.
    renderGroup({ currentSessionId: "s-12" });

    expect(screen.getByTestId("session-row-s-10")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-s-11")).not.toBeInTheDocument();
    expect(screen.getByTestId("session-row-s-12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 more sessions in Default" })).toBeInTheDocument();
  });

  it("counts a leader with workers and reviewers as one folded overflow unit", () => {
    // The visible limit applies to root nodes, so herd members and reviewer chips do not consume extra slots.
    storeState.expandedHerdNodes.add("leader-1");
    renderGroup({ group: groupWithHerdUnit(), visibleSessionLimit: 2 });

    expect(screen.getByTestId("session-row-leader-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-worker-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-worker-2")).toBeInTheDocument();
    expect(screen.getByTestId("session-reviewer-reviewer-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-standalone-2")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-standalone-3")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 more sessions in Default" })).toBeInTheDocument();
  });

  it("hides a leader with workers and reviewers as one folded overflow unit", () => {
    // A root node past the limit should disappear as a whole unit, including expanded workers and reviewer chips.
    storeState.expandedHerdNodes.add("leader-hidden");
    renderGroup({ group: groupWithHiddenHerdUnit(), visibleSessionLimit: 2 });

    expect(screen.getByTestId("session-row-standalone-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-standalone-2")).toBeInTheDocument();
    expect(screen.queryByTestId("session-row-leader-hidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-row-worker-hidden")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-reviewer-reviewer-hidden")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show 1 more sessions in Default" })).toBeInTheDocument();
  });

  it("keeps a hidden leader unit visible when an active worker is inside it", () => {
    // The active-session exception should find the worker inside the hidden unit and render that whole unit.
    storeState.expandedHerdNodes.add("leader-hidden");
    renderGroup({
      group: groupWithHiddenHerdUnit(),
      visibleSessionLimit: 2,
      currentSessionId: "worker-hidden",
    });

    expect(screen.getByTestId("session-row-standalone-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-standalone-2")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-leader-hidden")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-worker-hidden")).toBeInTheDocument();
    expect(screen.getByTestId("session-reviewer-reviewer-hidden")).toBeInTheDocument();
  });

  it("keeps a hidden leader unit visible when an active reviewer is inside it", () => {
    // Reviewers render as chips on their parent unit, but they should still pull that unit into the folded view.
    renderGroup({
      group: groupWithHiddenHerdUnit(),
      visibleSessionLimit: 2,
      currentSessionId: "reviewer-hidden",
    });

    expect(screen.getByTestId("session-row-standalone-1")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-standalone-2")).toBeInTheDocument();
    expect(screen.getByTestId("session-row-leader-hidden")).toBeInTheDocument();
    expect(screen.getByTestId("session-reviewer-reviewer-hidden")).toBeInTheDocument();
  });

  it("offers visible limit choices from the group context menu", () => {
    const onSetVisibleSessionLimit = vi.fn();
    renderGroup({ onSetVisibleSessionLimit });

    fireEvent.contextMenu(screen.getAllByRole("button", { name: /Default/ })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Show 20" }));

    expect(onSetVisibleSessionLimit).toHaveBeenCalledWith("default", 20);
  });
});
