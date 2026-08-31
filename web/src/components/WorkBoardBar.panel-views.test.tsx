// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestmasterTask, SessionAttentionRecord, SessionState } from "../types.js";
import type { LeaderWorkboardView } from "../store-types.js";
import {
  installWorkBoardProjectionFixture,
  resetWorkBoardProjectionFixture,
} from "../test-fixtures/work-board-projection-adapter.js";

interface MockStoreState {
  sessionBoards: Map<string, BoardRowData[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  sessionCompletedBoards: Map<string, BoardRowData[]>;
  leaderWorkboardViews: Map<string, LeaderWorkboardView>;
  setLeaderWorkboardView: (sessionId: string, view: LeaderWorkboardView | null) => void;
  sdkSessions: Array<{
    sessionId: string;
    isOrchestrator?: boolean;
    sessionNum?: number;
    state?: string;
    cwd?: string;
    createdAt?: number;
    name?: string;
  }>;
  sessions: Map<string, SessionState>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  sessionTaskHistory: Map<string, unknown[]>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  cliConnected: Map<string, boolean>;
  askPermission: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  quests: QuestmasterTask[];
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  activeTurnRoutes: Map<string, import("../types.js").ActiveTurnRoute | null>;
  syncedProjectionValues: Map<string, unknown>;
  syncedProjectionKeys: Set<string>;
}

let mockState: MockStoreState;
const mockRequestScrollToMessage = vi.fn();
const mockSetExpandAllInTurn = vi.fn();

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    sessionCompletedBoards: new Map(),
    leaderWorkboardViews: new Map(),
    setLeaderWorkboardView: vi.fn((sessionId: string, view: LeaderWorkboardView | null) => {
      if (view) mockState.leaderWorkboardViews.set(sessionId, view);
      else mockState.leaderWorkboardViews.delete(sessionId);
    }),
    sdkSessions: [],
    sessions: new Map(),
    sessionAttention: new Map(),
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    sessionTaskHistory: new Map(),
    pendingPermissions: new Map(),
    cliConnected: new Map(),
    askPermission: new Map(),
    cliDisconnectReason: new Map(),
    quests: [],
    sessionStatus: new Map(),
    activeTurnRoutes: new Map(),
    syncedProjectionValues: new Map(),
    syncedProjectionKeys: new Set(),
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (s: MockStoreState) => unknown) => selector(mockState), {
    getState: () => ({
      ...mockState,
      requestScrollToMessage: mockRequestScrollToMessage,
      setExpandAllInTurn: mockSetExpandAllInTurn,
    }),
  }),
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
}));

// Keep the panel tests focused on view selection and routing rather than BoardTable internals.
vi.mock("./BoardTable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./BoardTable.js")>();
  return {
    ...actual,
    BoardTable: ({
      board,
      mode = "active",
      onSelectQuestThread,
    }: {
      board: BoardRowData[];
      mode?: string;
      rowSessionStatuses?: unknown;
      onSelectQuestThread?: (questId: string) => void;
    }) => (
      <div data-testid="board-table" data-mode={mode}>
        {board.length} rows
        {board.map((row) => (
          <button
            key={row.questId}
            type="button"
            data-testid="board-thread-action"
            data-thread-key={row.questId.toLowerCase()}
            onClick={() => onSelectQuestThread?.(row.questId.toLowerCase())}
          >
            Jump {row.questId}
          </button>
        ))}
      </div>
    ),
  };
});

const { WorkBoardBar: CurrentWorkBoardBar } = await import("./WorkBoardBar.js");

type WorkBoardBarProps = Omit<ComponentProps<typeof CurrentWorkBoardBar>, "attentionRecords"> & {
  attentionRecords?: ReadonlyArray<SessionAttentionRecord>;
};
let projectionFixtureRenderRevision = 0;

function WorkBoardBar(props: WorkBoardBarProps) {
  installWorkBoardProjectionFixture(mockState, props, {
    explicitOpenKeysProvided: Object.hasOwn(props, "openThreadKeys"),
  });
  const {
    attentionRecords: _attentionRecords,
    closedThreadKeys: _closedThreadKeys,
    currentThreadLabel: _currentThreadLabel,
    ...currentProps
  } = props;
  projectionFixtureRenderRevision += 1;
  return (
    <CurrentWorkBoardBar
      {...currentProps}
      currentThreadLabel={`projection-fixture-${projectionFixtureRenderRevision}`}
    />
  );
}

beforeEach(() => {
  resetWorkBoardProjectionFixture();
  resetStore();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  mockRequestScrollToMessage.mockClear();
  mockSetExpandAllInTurn.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("WorkBoardBar panel views", () => {
  const BOARD_DATA: BoardRowData[] = [
    { questId: "q-1", status: "WORKING", title: "Fix bug", updatedAt: 1 },
    { questId: "q-2", status: "QUEUED", title: "Add feature", updatedAt: 2 },
  ];

  it("opens the active workboard from the banner active-count button", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const view = render(<WorkBoardBar sessionId="s1" />);
    fireEvent.click(view.getByTestId("workboard-active-button"));
    view.rerender(<WorkBoardBar sessionId="s1" />);
    const { getByTestId } = view;

    expect(getByTestId("workboard-panel")).toHaveAttribute("data-view", "active");
    expect(getByTestId("board-table")).toBeInTheDocument();
    expect(
      getByTestId("workboard-active-button").compareDocumentPosition(getByTestId("board-table")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      getByTestId("thread-tab-rail").compareDocumentPosition(getByTestId("workboard-main-banner")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      getByTestId("workboard-main-banner").compareDocumentPosition(getByTestId("board-table")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("toggles the active workboard closed on repeated active-button clicks", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const view = render(<WorkBoardBar sessionId="s1" />);
    const button = view.getByTestId("workboard-active-button");
    fireEvent.click(button);
    view.rerender(<WorkBoardBar sessionId="s1" />);
    fireEvent.click(view.getByTestId("workboard-active-button"));
    view.rerender(<WorkBoardBar sessionId="s1" />);
    expect(view.queryByTestId("workboard-panel")).not.toBeInTheDocument();
    expect(view.queryByTestId("board-table")).not.toBeInTheDocument();
  });

  it("closes the selected banner view on Escape", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    mockState.leaderWorkboardViews.set("s1", "active");
    const view = render(<WorkBoardBar sessionId="s1" />);
    expect(view.getByTestId("board-table")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    view.rerender(<WorkBoardBar sessionId="s1" />);
    expect(view.queryByTestId("board-table")).not.toBeInTheDocument();
  });

  it("shows singular 'item' for a single board row", () => {
    const singleRow: BoardRowData[] = [{ questId: "q-1", status: "QUEUED", updatedAt: 1 }];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", singleRow]]),
    });
    const { getByText } = render(<WorkBoardBar sessionId="s1" />);
    expect(getByText("1 item")).toBeInTheDocument();
  });

  it("keeps selected workboard view visible in place while visiting a quest thread", () => {
    resetStore({
      sdkSessions: [
        { sessionId: "s1", isOrchestrator: true },
        { sessionId: "s2", isOrchestrator: true },
      ],
      sessionBoards: new Map([
        ["s1", BOARD_DATA],
        ["s2", BOARD_DATA],
      ]),
    });
    const { getByTestId, queryByTestId, rerender } = render(<WorkBoardBar sessionId="s1" />);

    fireEvent.click(getByTestId("workboard-active-button"));
    rerender(<WorkBoardBar sessionId="s1" />);
    expect(getByTestId("board-table")).toBeInTheDocument();

    rerender(<WorkBoardBar sessionId="s2" />);
    expect(queryByTestId("board-table")).not.toBeInTheDocument();

    rerender(<WorkBoardBar sessionId="s1" currentThreadKey="q-1" />);
    expect(queryByTestId("workboard-main-banner")).not.toBeInTheDocument();
    expect(getByTestId("workboard-panel")).toHaveAttribute("data-view", "active");
    expect(getByTestId("board-table")).toBeInTheDocument();

    rerender(<WorkBoardBar sessionId="s1" />);
    expect(getByTestId("workboard-panel")).toHaveAttribute("data-view", "active");
    expect(getByTestId("board-table")).toBeInTheDocument();
  });

  it("does not close the selected view on outside click", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    mockState.leaderWorkboardViews.set("s1", "active");
    const { getByTestId } = render(<WorkBoardBar sessionId="s1" />);
    expect(getByTestId("board-table")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(getByTestId("board-table")).toBeInTheDocument();
  });

  it("offers Main and All Threads projection in the persistent banner", () => {
    const onSelectThread = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getByTestId } = render(<WorkBoardBar sessionId="s1" onSelectThread={onSelectThread} />);
    expect(getByTestId("workboard-projection-toggle")).toBeInTheDocument();
    expect(getByTestId("workboard-projection-main")).toHaveAttribute("aria-pressed", "true");
    expect(getByTestId("workboard-projection-all")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(getByTestId("workboard-projection-main"));
    fireEvent.click(getByTestId("workboard-projection-all"));
    expect(onSelectThread).toHaveBeenNthCalledWith(1, "main");
    expect(onSelectThread).toHaveBeenNthCalledWith(2, "all");
  });

  it("marks All projection selected in the persistent banner", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getByTestId } = render(<WorkBoardBar sessionId="s1" currentThreadKey="all" onSelectThread={vi.fn()} />);
    expect(getByTestId("workboard-projection-main")).toHaveAttribute("aria-pressed", "false");
    expect(getByTestId("workboard-projection-all")).toHaveAttribute("aria-pressed", "true");
  });

  it("navigates active and completed quest threads without changing QuestLink semantics", () => {
    const onSelectThread = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-3", status: "DONE", title: "Finished", updatedAt: 3, completedAt: 3 }]],
      ]),
    });

    const view = render(<WorkBoardBar sessionId="s1" onSelectThread={onSelectThread} />);
    fireEvent.click(view.getByTestId("workboard-active-button"));
    view.rerender(<WorkBoardBar sessionId="s1" onSelectThread={onSelectThread} />);
    fireEvent.click(view.getAllByTestId("board-thread-action")[0]);

    fireEvent.click(view.getByTestId("workboard-completed-button"));
    view.rerender(<WorkBoardBar sessionId="s1" onSelectThread={onSelectThread} />);
    fireEvent.click(view.getAllByTestId("board-thread-action").find((button) => button.textContent?.includes("q-3"))!);

    expect(onSelectThread).toHaveBeenNthCalledWith(1, "q-1");
    expect(onSelectThread).toHaveBeenNthCalledWith(2, "q-3");
  });

  it("navigates off-board quest threads from thread metadata", () => {
    const onSelectThread = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        onSelectThread={onSelectThread}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Off-board thread", messageCount: 2 }]}
      />,
    );
    const { getByTestId } = view;

    expect(getByTestId("workboard-other-button")).toHaveTextContent("1Other");
    expect(getByTestId("workboard-phase-summary")).toHaveTextContent("1 Work, 1 Queued");
    expect(view.queryByTestId("workboard-off-board-threads")).not.toBeInTheDocument();
    fireEvent.click(getByTestId("workboard-other-button"));
    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        onSelectThread={onSelectThread}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Off-board thread", messageCount: 2 }]}
      />,
    );
    expect(getByTestId("workboard-panel")).toHaveAttribute("data-view", "other");
    expect(getByTestId("workboard-other-threads-content")).toHaveTextContent("Off-board thread");
    fireEvent.click(getByTestId("workboard-other-button"));
    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        onSelectThread={onSelectThread}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Off-board thread", messageCount: 2 }]}
      />,
    );
    expect(view.queryByTestId("workboard-panel")).not.toBeInTheDocument();

    fireEvent.click(getByTestId("workboard-other-button"));
    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        onSelectThread={onSelectThread}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Off-board thread", messageCount: 2 }]}
      />,
    );
    fireEvent.click(getByTestId("workboard-off-board-thread"));
    expect(onSelectThread).toHaveBeenCalledWith("q-99");
  });

  it("opens a separate completed-quests view from the completed button", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-3", status: "DONE", title: "Finished", updatedAt: 3, completedAt: 3 }]],
      ]),
    });

    const view = render(<WorkBoardBar sessionId="s1" onSelectThread={vi.fn()} />);
    fireEvent.click(view.getByTestId("workboard-completed-button"));
    view.rerender(<WorkBoardBar sessionId="s1" onSelectThread={vi.fn()} />);

    expect(view.getByTestId("workboard-panel")).toHaveAttribute("data-view", "completed");
    expect(view.getByTestId("board-table")).toHaveAttribute("data-mode", "completed");

    fireEvent.click(view.getByTestId("workboard-completed-button"));
    view.rerender(<WorkBoardBar sessionId="s1" onSelectThread={vi.fn()} />);
    expect(view.queryByTestId("workboard-panel")).not.toBeInTheDocument();
  });

  it("hides the active work button when there are no active phase counts", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-3", status: "DONE", title: "Finished", updatedAt: 3, completedAt: 3 }]],
      ]),
    });
    const { queryByTestId, getByTestId } = render(<WorkBoardBar sessionId="s1" />);
    expect(queryByTestId("workboard-active-button")).not.toBeInTheDocument();
    expect(getByTestId("workboard-completed-button")).toHaveTextContent("1Completed");
  });

  it("does not render the removed workboard search control", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getByTestId, queryByLabelText, queryByText } = render(
      <WorkBoardBar
        sessionId="s1"
        onSelectThread={vi.fn()}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Archived follow-up thread", messageCount: 2 }]}
      />,
    );

    expect(queryByText("Search threads, board, and history")).not.toBeInTheDocument();
    expect(queryByLabelText("Search threads, board, and history")).not.toBeInTheDocument();
    expect(getByTestId("workboard-main-banner")).toBeInTheDocument();
  });
});
