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
  SessionItem: ({ session }: { session: SidebarSessionItem }) => (
    <div data-testid={`session-row-${session.id}`}>{session.model}</div>
  ),
  StatusCountDots: () => null,
}));

import { TreeViewGroup } from "./TreeViewGroup.js";

function session(id: string): SidebarSessionItem {
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

  it("offers visible limit choices from the group context menu", () => {
    const onSetVisibleSessionLimit = vi.fn();
    renderGroup({ onSetVisibleSessionLimit });

    fireEvent.contextMenu(screen.getAllByRole("button", { name: /Default/ })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Show 20" }));

    expect(onSetVisibleSessionLimit).toHaveBeenCalledWith("default", 20);
  });
});
