// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, within, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import type { BoardRowData } from "./BoardTable.js";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";
import type { QuestJourneyPhaseId } from "../../shared/quest-journey.js";
import type { QuestmasterTask, SessionAttentionRecord, SessionState } from "../types.js";
import type { LeaderWorkboardView } from "../store-types.js";
import { getQuestPhaseColorValue, getQuestPhaseThreadTabTitleColorValue } from "../utils/quest-phase-theme.js";
import {
  installWorkBoardProjectionFixture,
  resetWorkBoardProjectionFixture,
  type WorkBoardProjectionPropsFixture,
} from "../test-fixtures/work-board-projection-adapter.js";

// ─── WorkBoardBar component tests ─────────────────────────────────────────────

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
}));

// Mock BoardTable to avoid needing full store for QuestLink/WorkerLink.
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

import { listedThreadTabs } from "../test-fixtures/thread-tab-rows.js";

// Must import after mocks are set up
const { WorkBoardBar: CurrentWorkBoardBar } = await import("./WorkBoardBar.js");

type WorkBoardBarProps = ComponentProps<typeof CurrentWorkBoardBar> &
  Pick<WorkBoardProjectionPropsFixture, "attentionRecords" | "closedThreadKeys">;

function WorkBoardBar(props: WorkBoardBarProps) {
  installWorkBoardProjectionFixture(mockState, props, {
    explicitOpenKeysProvided: Object.hasOwn(props, "openThreadKeys"),
  });
  const { attentionRecords: _attentionRecords, closedThreadKeys: _closedThreadKeys, ...currentProps } = props;
  return <CurrentWorkBoardBar {...currentProps} threadRows={[...(currentProps.threadRows ?? [])]} />;
}

function attentionRecord(overrides: Partial<SessionAttentionRecord> = {}): SessionAttentionRecord {
  return {
    id: "attention:q-1",
    leaderSessionId: "s1",
    type: "needs_input",
    source: { kind: "notification", id: "n-1", questId: "q-1" },
    questId: "q-1",
    threadKey: "q-1",
    title: "q-1 needs input",
    summary: "Answer the implementation question.",
    actionLabel: "Answer",
    priority: "needs_input",
    state: "unresolved",
    createdAt: 100,
    updatedAt: 100,
    route: { threadKey: "q-1", questId: "q-1" },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: "attention:q-1",
    ...overrides,
  };
}

function getPhaseColor(status: string): string | undefined {
  const phase = getQuestJourneyPhaseForState(status);
  return phase ? getQuestPhaseColorValue(phase.color) : undefined;
}

function getPhaseThreadTabTitleColor(status: string): string | undefined {
  const phase = getQuestJourneyPhaseForState(status);
  return phase ? getQuestPhaseThreadTabTitleColorValue(phase.color) : undefined;
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

describe("WorkBoardBar", () => {
  const BOARD_DATA: BoardRowData[] = [
    { questId: "q-1", status: "WORKING", title: "Fix bug", updatedAt: 1 },
    { questId: "q-2", status: "QUEUED", title: "Add feature", updatedAt: 2 },
  ];

  it("returns null for non-orchestrator sessions", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: false }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const { container } = render(<WorkBoardBar sessionId="s1" />);
    expect(container.innerHTML).toBe("");
  });

  it("keeps the primary workboard navigator visible when board is empty", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
    });
    const { getByText, getByTestId, queryByTestId } = render(<WorkBoardBar sessionId="s1" />);
    expect(getByText("Empty")).toBeInTheDocument();
    expect(getByTestId("workboard-main-banner")).toBeInTheDocument();
    expect(getByTestId("workboard-empty-summary")).toHaveTextContent("Empty");
    expect(queryByTestId("workboard-active-button")).not.toBeInTheDocument();
    expect(queryByTestId("workboard-completed-button")).not.toBeInTheDocument();
    expect(queryByTestId("workboard-other-button")).not.toBeInTheDocument();
    expect(getByTestId("thread-tab-rail")).toHaveAttribute("data-open-tab-count", "1");
    // Only Main and search remain when no quest tab is open.
    expect(getByTestId("thread-tab-group-main")).toHaveAttribute("aria-label", "Main Thread");
    expect(getByTestId("thread-tab-group-main")).toHaveTextContent("Main");
    expect(queryByTestId("thread-tab-group-chip")).toBeNull();
  });

  it("keeps the primary workboard navigator visible when no board data exists for session", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map(),
    });
    const { getByText } = render(<WorkBoardBar sessionId="s1" />);
    expect(getByText("Empty")).toBeInTheDocument();
  });

  it("renders the compact Main-thread Work Board banner for orchestrators with board data", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const { getByText, getByTestId, queryByTestId, queryByText } = render(<WorkBoardBar sessionId="s1" />);
    expect(getByTestId("workboard-main-banner")).toBeInTheDocument();
    expect(queryByTestId("workboard-current-thread")).not.toBeInTheDocument();
    expect(getByTestId("workboard-active-button")).toBeInTheDocument();
    expect(
      getByTestId("workboard-active-button").compareDocumentPosition(getByTestId("workboard-phase-summary")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Each status segment renders separately with its color class
    expect(getByText("1 Work")).toBeInTheDocument();
    expect(getByText("1 Queued")).toBeInTheDocument();
    // The strip no longer ends with an "N items" count; the phase words say it all.
    expect(queryByText(/^\d+ items?$/)).toBeNull();
    expect(
      getByTestId("thread-tab-rail").compareDocumentPosition(getByTestId("workboard-main-banner")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("hides the Work Board banner and table on quest threads while keeping the tab rail", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getByTestId, queryByTestId } = render(<WorkBoardBar sessionId="s1" currentThreadKey="q-1" />);

    expect(getByTestId("thread-tab-rail")).toBeInTheDocument();
    expect(queryByTestId("workboard-main-banner")).not.toBeInTheDocument();
    expect(queryByTestId("workboard-active-button")).not.toBeInTheDocument();
    expect(queryByTestId("board-table")).not.toBeInTheDocument();
    expect(queryByTestId("workboard-return-main")).not.toBeInTheDocument();
  });

  it("does not show BoardTable until an explicit banner view is selected", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const { queryByTestId } = render(<WorkBoardBar sessionId="s1" />);
    expect(queryByTestId("board-table")).not.toBeInTheDocument();
  });

  it("renders active thread chips from board rows and active blockers", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-3", status: "DONE", title: "Finished work", updatedAt: 3, completedAt: 3 }]],
      ]),
    });
    const { getAllByTestId, getByTestId, queryByText } = render(
      <WorkBoardBar
        sessionId="s1"
        attentionRecords={[
          attentionRecord({ id: "needs-input", state: "unresolved", dedupeKey: "needs-input", title: "Answer q-1" }),
          attentionRecord({
            id: "review",
            type: "review_ready",
            priority: "review",
            actionLabel: "Review",
            route: { threadKey: "q-4", questId: "q-4" },
            threadKey: "q-4",
            questId: "q-4",
            dedupeKey: "review",
            title: "q-4 ready for review",
          }),
          attentionRecord({
            id: "reopened",
            type: "quest_reopened_or_rework",
            priority: "milestone",
            actionLabel: "Open",
            state: "reopened",
            route: { threadKey: "q-5", questId: "q-5" },
            threadKey: "q-5",
            questId: "q-5",
            dedupeKey: "reopened",
            title: "q-5 rework requested",
            updatedAt: 300,
          }),
        ]}
      />,
    );

    const tabs = listedThreadTabs();
    expect(queryByText("Active")).not.toBeInTheDocument();
    // Listed by status group (Needs you, In progress, New results), keeping the tab order inside a group.
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1", "q-5", "q-2", "q-4"]);
    expect(tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-1")).toHaveAttribute(
      "data-needs-input",
      "true",
    );
    expect(tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-2")).toHaveAttribute(
      "data-needs-input",
      "false",
    );
    expect(tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-4")).toHaveAttribute(
      "data-blue-notification",
      "true",
    );
    expect(queryByText("q-4 ready for review")).toBeInTheDocument();
    expect(queryByText("Finished work")).not.toBeInTheDocument();
  });

  it("selects attention tabs without replaying notification route targets", () => {
    const onSelectThread = vi.fn();
    vi.useFakeTimers();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
    });

    try {
      const view = render(
        <WorkBoardBar
          sessionId="s1"
          currentThreadKey="main"
          onSelectThread={onSelectThread}
          openThreadKeys={["q-977"]}
          attentionRecords={[
            attentionRecord({
              id: "needs-input-q977",
              route: { threadKey: "q-977", questId: "q-977", messageId: "herd-turn-end" },
              threadKey: "q-977",
              questId: "q-977",
              title: "q-977 needs input",
              dedupeKey: "needs-input-q977",
            }),
          ]}
        />,
      );

      const tab = listedThreadTabs().find((node) => node.getAttribute("data-thread-key") === "q-977");
      expect(tab).toBeTruthy();
      fireEvent.click(within(tab!).getByTestId("thread-tab-list-row-select"));
      vi.runOnlyPendingTimers();

      expect(onSelectThread).toHaveBeenCalledWith("q-977");
      expect(mockRequestScrollToMessage).not.toHaveBeenCalled();
      expect(mockSetExpandAllInTurn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("renders open and board-active threads on one continuous tab track", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getAllByTestId, queryByText } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1"]}
        attentionRecords={[attentionRecord({ id: "needs-input", state: "unresolved", dedupeKey: "needs-input" })]}
      />,
    );

    const tabs = listedThreadTabs();
    expect(tabs).toHaveLength(2);
    expect(tabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2"]);
    expect(tabs[0]).toHaveAttribute("data-needs-input", "true");
    expect(tabs[0]).toHaveAttribute("data-closable", "false");
    expect(tabs[1]).toHaveAttribute("data-closable", "true");
    expect(queryByText("Active")).not.toBeInTheDocument();
  });

  it("keeps a newly surfaced quest tab after Main before and after server-open reconciliation", () => {
    // A fresh board row can reach the tab rail before the selected/open-tab
    // state catches up. Its initial placement should already match the later
    // first-position server-open reconciliation, avoiding a visible jump.
    const boardRows: BoardRowData[] = [];
    const nextBoardRows: BoardRowData[] = [
      { questId: "q-new", status: "WORKING", title: "Newly surfaced quest", updatedAt: 10 },
    ];
    const threadRows = [
      { threadKey: "q-new", questId: "q-new", title: "Newly surfaced quest", messageCount: 1 },
      { threadKey: "q-open-a", questId: "q-open-a", title: "Existing open thread A", messageCount: 2 },
      { threadKey: "q-open-b", questId: "q-open-b", title: "Existing open thread B", messageCount: 3 },
      { threadKey: "q-open-c", questId: "q-open-c", title: "Existing open thread C", messageCount: 4 },
    ];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", boardRows]]),
    });

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-open-a"
        openThreadKeys={["q-open-a", "q-open-b", "q-open-c"]}
        threadRows={threadRows}
      />,
    );

    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-open-a",
      "q-open-b",
      "q-open-c",
    ]);

    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", nextBoardRows]]),
    });
    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-open-a"
        openThreadKeys={["q-open-a", "q-open-b", "q-open-c"]}
        threadRows={threadRows}
      />,
    );

    const initialOrder = listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"));
    expect(initialOrder).toEqual(["q-new", "q-open-a", "q-open-b", "q-open-c"]);

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-new"
        openThreadKeys={["q-new", "q-open-a", "q-open-b", "q-open-c"]}
        threadRows={threadRows}
      />,
    );

    const reconciledOrder = listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"));
    expect(reconciledOrder).toEqual(["q-new", "q-open-a", "q-open-b", "q-open-c"]);
  });

  it("keeps stale auto-surfaced board tabs behind server-open tabs when only updatedAt changes", () => {
    const initialRows: BoardRowData[] = [
      { questId: "q-open-a", status: "WORKING", title: "Existing open thread A", updatedAt: 50 },
      { questId: "q-open-b", status: "REVIEWING", title: "Existing open thread B", updatedAt: 40 },
      { questId: "q-old", status: "QUEUED", title: "Older auto-surfaced quest", updatedAt: 10 },
    ];
    const updatedRows: BoardRowData[] = [
      { questId: "q-open-a", status: "WORKING", title: "Existing open thread A", updatedAt: 50 },
      { questId: "q-open-b", status: "REVIEWING", title: "Existing open thread B", updatedAt: 40 },
      { questId: "q-old", status: "WORKING", title: "Older auto-surfaced quest", updatedAt: 99 },
    ];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", initialRows]]),
    });

    const view = render(
      <WorkBoardBar sessionId="s1" currentThreadKey="q-open-a" openThreadKeys={["q-open-a", "q-open-b"]} />,
    );

    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-open-a",
      "q-open-b",
      "q-old",
    ]);

    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", updatedRows]]),
    });
    view.rerender(
      <WorkBoardBar sessionId="s1" currentThreadKey="q-open-a" openThreadKeys={["q-open-a", "q-open-b"]} />,
    );

    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-open-a",
      "q-open-b",
      "q-old",
    ]);
  });

  it("hands off an off-board attention-tab close and removes it only after projected authority updates", () => {
    const onCloseThreadTab = vi.fn();
    const onSelectThread = vi.fn();
    const reworkAttention = attentionRecord({
      id: "reopened",
      type: "quest_reopened_or_rework",
      priority: "milestone",
      actionLabel: "Open",
      state: "reopened",
      route: { threadKey: "q-5", questId: "q-5" },
      threadKey: "q-5",
      questId: "q-5",
      dedupeKey: "reopened",
      title: "q-5 rework requested",
      updatedAt: 300,
    });
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        onCloseThreadTab={onCloseThreadTab}
        onSelectThread={onSelectThread}
        attentionRecords={[reworkAttention]}
      />,
    );

    const tabs = listedThreadTabs();
    const offBoardTab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-5")!;
    const expectedNextThread = tabs[tabs.indexOf(offBoardTab) + 1]?.getAttribute("data-thread-key") ?? "main";
    const boardActiveTab = tabs.find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(offBoardTab).toHaveAttribute("data-closable", "true");
    expect(boardActiveTab).toHaveAttribute("data-closable", "false");
    expect(within(boardActiveTab).queryByTestId("thread-tab-list-row-close")).not.toBeInTheDocument();

    fireEvent.click(view.getByLabelText("Close q-5"));

    expect(onCloseThreadTab).toHaveBeenCalledWith("q-5", expectedNextThread);
    expect(onSelectThread).not.toHaveBeenCalled();
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toContain("q-5");

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey={expectedNextThread}
        onCloseThreadTab={onCloseThreadTab}
        onSelectThread={onSelectThread}
        closedThreadKeys={["q-5"]}
        attentionRecords={[reworkAttention]}
      />,
    );

    expect(view.queryByText("q-5 rework requested")).not.toBeInTheDocument();
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual(
      expect.arrayContaining(["q-1", "q-2"]),
    );
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).not.toContain("q-5");
  });

  it("uses canonical quest titles for open tabs and keeps closed attention tabs from reappearing", () => {
    const onCloseThreadTab = vi.fn();
    const staleReworkRecord = attentionRecord({
      id: "reopened-q-1066",
      type: "quest_reopened_or_rework",
      priority: "milestone",
      actionLabel: "Open",
      state: "reopened",
      route: { threadKey: "q-1066", questId: "q-1066" },
      threadKey: "q-1066",
      questId: "q-1066",
      dedupeKey: "reopened-q-1066",
      title: "q-1066: rework requested",
      updatedAt: 300,
    });
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
      quests: [
        {
          id: "q-1066-v1",
          questId: "q-1066",
          version: 1,
          title: "Keep Codex tool-router errors from stranding sessions",
          status: "done",
          description: "Router failures should not strand sessions.",
          createdAt: 1,
          completedAt: 2,
          verificationItems: [],
        },
      ],
    });

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1066", "q-1119"]}
        onCloseThreadTab={onCloseThreadTab}
        attentionRecords={[staleReworkRecord]}
        threadRows={[{ threadKey: "q-1119", questId: "q-1119", title: "Recovery follow-up", messageCount: 1 }]}
      />,
    );

    const q1066Tab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1066")!;
    expect(q1066Tab).toHaveTextContent("q-1066");
    expect(q1066Tab).toHaveTextContent("Keep Codex tool-router errors from stranding sessions");
    expect(q1066Tab).not.toHaveTextContent("rework requested");

    fireEvent.click(view.getByLabelText("Close q-1066"));
    // q-1066 is the only finished tab and q-1119 is still in progress, so closing it
    // leaves Done empty and returns to Main rather than jumping into other work.
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-1066", "main");

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1119"]}
        onCloseThreadTab={onCloseThreadTab}
        attentionRecords={[staleReworkRecord]}
        threadRows={[{ threadKey: "q-1119", questId: "q-1119", title: "Recovery follow-up", messageCount: 1 }]}
      />,
    );

    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1119"]);
    expect(view.queryByText("q-1066: rework requested")).not.toBeInTheDocument();
  });

  it("suppresses remotely closed auto attention tabs while attention remains active", async () => {
    const staleReworkRecord = attentionRecord({
      id: "remote-reopened-q-1066",
      type: "quest_reopened_or_rework",
      priority: "milestone",
      actionLabel: "Open",
      state: "reopened",
      route: { threadKey: "q-1066", questId: "q-1066" },
      threadKey: "q-1066",
      questId: "q-1066",
      dedupeKey: "remote-reopened-q-1066",
      title: "q-1066: rework requested",
      updatedAt: 300,
    });
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
      quests: [
        {
          id: "q-1066-v1",
          questId: "q-1066",
          version: 1,
          title: "Keep Codex tool-router errors from stranding sessions",
          status: "done",
          description: "Router failures should not strand sessions.",
          createdAt: 1,
          completedAt: 2,
          verificationItems: [],
        },
      ],
    });

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1066", "q-1119"]}
        attentionRecords={[staleReworkRecord]}
        threadRows={[{ threadKey: "q-1119", questId: "q-1119", title: "Recovery follow-up", messageCount: 1 }]}
      />,
    );

    // q-1066 is finished in Questmaster, so it lists under Done after the in-progress q-1119.
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1119", "q-1066"]);

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-1119"]}
        closedThreadKeys={["q-1066"]}
        attentionRecords={[staleReworkRecord]}
        threadRows={[{ threadKey: "q-1119", questId: "q-1119", title: "Recovery follow-up", messageCount: 1 }]}
      />,
    );

    await waitFor(() => {
      expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1119"]);
    });
    expect(view.queryByText("q-1066: rework requested")).not.toBeInTheDocument();
  });

  it("colors listed board-active tabs by phase, with the phase named on the meta line", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    render(<WorkBoardBar sessionId="s1" />);

    const implementingTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(implementingTab).toHaveTextContent("Fix bug");
    const implementingMeta = within(implementingTab).getByTestId("thread-tab-list-row-meta");
    expect(implementingMeta).toHaveAttribute("data-title-color", getPhaseThreadTabTitleColor("WORKING"));
    expect(implementingMeta).toHaveTextContent("q-1 · Work");

    // A queued tab reads in the normal foreground, not the done gray.
    const queuedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!;
    const queuedMeta = within(queuedTab).getByTestId("thread-tab-list-row-meta");
    expect(queuedMeta).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(queuedMeta).toHaveTextContent("q-2 · Queued");
  });

  it("keeps selected Main joined to its strip while marking the thread being written in", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "main" }]]),
    });

    const { getByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="main"
        attentionRecords={[
          attentionRecord({
            id: "main-needs-input",
            threadKey: "main",
            questId: undefined,
            route: { threadKey: "main" },
            title: "Main needs input",
            dedupeKey: "main-needs-input",
          }),
          attentionRecord({
            id: "main-review",
            type: "review_ready",
            source: { kind: "notification", id: "n-main-review", questId: undefined },
            threadKey: "main",
            questId: undefined,
            route: { threadKey: "main" },
            title: "Main review",
            priority: "review",
            dedupeKey: "main-review",
          }),
        ]}
      />,
    );

    // Main is the selected tab, joined to the Main strip by its card color, and marks the
    // thread the leader is writing in. A prompt outranks the unread result on its bell.
    const mainTab = getByTestId("thread-tab-group-main");
    expect(mainTab).toHaveAttribute("aria-selected", "true");
    expect(mainTab).toHaveAttribute("data-active-output", "true");
    expect(mainTab).toHaveClass("border-cc-primary/45", "bg-cc-card", "text-cc-fg");
    expect(within(mainTab).getByTestId("thread-tab-active-output-spinner")).toBeInTheDocument();
    expect(within(mainTab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
  });

  it("does not render an active output marker on selected Main without explicit active output in Main", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map(),
    });

    const { getByTestId } = render(<WorkBoardBar sessionId="s1" currentThreadKey="main" />);

    const mainTab = getByTestId("thread-tab-group-main");
    expect(mainTab).toHaveAttribute("aria-selected", "true");
    expect(mainTab).toHaveAttribute("data-active-output", "false");
    expect(within(mainTab).queryByTestId("thread-tab-active-output-spinner")).not.toBeInTheDocument();
  });

  it("composes selected and active-output states when they are on different tabs", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "q-1", questId: "q-1" }]]),
    });

    const { getAllByTestId } = render(
      <WorkBoardBar sessionId="s1" currentThreadKey="q-2" openThreadKeys={["q-1", "q-2"]} />,
    );

    // The leader writes in q-1 while the user reads q-2: both are in progress, so that
    // group is the selected tab and carries the writing marker.
    const progress = getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "in-progress")!;
    expect(progress).toHaveAttribute("data-selected", "true");
    expect(progress).toHaveAttribute("data-active-output", "true");

    const activeTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(activeTab).toHaveAttribute("data-selected", "false");
    expect(activeTab).toHaveAttribute("data-active-output", "true");
    expect(within(activeTab).getByTestId("thread-tab-active-output-spinner")).toBeInTheDocument();
    expect(within(activeTab).getByTestId("thread-tab-list-row-meta")).toHaveAttribute(
      "data-title-color",
      getPhaseThreadTabTitleColor("WORKING"),
    );

    const selectedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!;
    expect(selectedTab).toHaveAttribute("data-selected", "true");
    expect(selectedTab).toHaveAttribute("data-active-output", "false");
    expect(within(selectedTab).queryByTestId("thread-tab-active-output-spinner")).not.toBeInTheDocument();
  });

  it("colors explicitly opened quest tabs by phase on their listed meta line", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-1", "q-2"]} />);

    const implementingTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    const implementingMeta = within(implementingTab).getByTestId("thread-tab-list-row-meta");
    expect(implementingMeta).toHaveAttribute("data-title-color", getPhaseThreadTabTitleColor("WORKING"));
    expect(implementingTab).toHaveTextContent("Fix bug");

    const queuedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!;
    const queuedMeta = within(queuedTab).getByTestId("thread-tab-list-row-meta");
    expect(queuedMeta).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
    expect(queuedMeta).not.toHaveAttribute("data-title-color", "var(--color-cc-muted)");
  });

  it("uses done gray for completed board-backed tabs instead of their final phase color", () => {
    const completed: BoardRowData[] = [
      {
        questId: "q-3",
        status: "MEMORY",
        title: "Finished work",
        journey: {
          presetId: "v2-work",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "memory",
        },
        updatedAt: 3,
        completedAt: 3,
      },
    ];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([["s1", completed]]),
    });

    const { getAllByTestId } = render(<WorkBoardBar sessionId="s1" currentThreadKey="q-3" openThreadKeys={["q-3"]} />);

    const completedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-3")!;
    expect(completedTab).toHaveAttribute("data-selected", "true");
    const completedTitle = within(completedTab).getByTestId("thread-tab-list-row-meta");
    expect(completedTitle).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(completedTitle).not.toHaveStyle({
      color: getPhaseColor("MEMORY"),
    });
  });

  it("uses done gray for completed active-board rows that still carry their final phase", () => {
    const completedActiveRow: BoardRowData = {
      questId: "q-3",
      status: "MEMORY",
      title: "Recently finished work",
      journey: {
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "memory",
      },
      updatedAt: 4,
      completedAt: 4,
    };
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", [completedActiveRow]]]),
    });

    const { getAllByTestId } = render(<WorkBoardBar sessionId="s1" openThreadKeys={["q-3"]} />);

    const completedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-3")!;
    const completedTitle = within(completedTab).getByTestId("thread-tab-list-row-meta");
    expect(completedTitle).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(completedTitle).not.toHaveStyle({
      color: getPhaseColor("MEMORY"),
    });
  });

  it("uses active phase color when an open tab has both active and completed board rows", () => {
    const repeatedActive: BoardRowData = {
      questId: "q-3",
      status: "USER_CHECKPOINTING",
      title: "Repeated Journey",
      journey: {
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "user-checkpoint", "work"],
        currentPhaseId: "user-checkpoint",
        activePhaseIndex: 2,
      },
      waitForInput: ["n-active-checkpoint"],
      updatedAt: 4,
    };
    const repeatedCompleted: BoardRowData = {
      questId: "q-3",
      status: "MEMORY",
      title: "Repeated Journey",
      journey: {
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "memory",
        activePhaseIndex: 3,
      },
      updatedAt: 3,
      completedAt: 3,
    };
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", [...BOARD_DATA, repeatedActive]]]),
      sessionCompletedBoards: new Map([["s1", [repeatedCompleted]]]),
    });

    const { getAllByTestId } = render(<WorkBoardBar sessionId="s1" currentThreadKey="q-3" openThreadKeys={["q-3"]} />);

    const tab = listedThreadTabs().find((candidate) => candidate.getAttribute("data-thread-key") === "q-3")!;
    expect(tab).toHaveAttribute("data-closable", "false");
    const title = within(tab).getByTestId("thread-tab-list-row-meta");
    expect(title).toHaveAttribute("data-title-color", getPhaseThreadTabTitleColor("USER_CHECKPOINTING"));
    expect(title).not.toHaveAttribute("data-title-color", "var(--color-cc-muted)");
  });

  it("uses done gray for off-board done thread tabs when only thread metadata is available", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-99"]}
        threadRows={[
          { threadKey: "q-99", questId: "q-99", title: "Archived thread", messageCount: 1, section: "done" },
        ]}
      />,
    );

    const doneTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-99")!;
    expect(within(doneTab).getByTestId("thread-tab-list-row-meta")).toHaveAttribute(
      "data-title-color",
      "var(--color-cc-muted)",
    );
  });

  it("keeps the all-quests board summary as the active phase color legend", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getByTestId } = render(<WorkBoardBar sessionId="s1" />);

    const summary = getByTestId("workboard-phase-summary");
    expect(summary).toHaveTextContent("1 Work");
    expect(summary).toHaveTextContent("1 Queued");
    expect(within(summary).getByText("1 Work")).toHaveStyle({
      color: getPhaseColor("WORKING"),
    });
  });

  it("marks the thread being written in while keeping its needs-input bell and phase color", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "q-1", questId: "q-1" }]]),
    });

    const withBellView = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        attentionRecords={[attentionRecord({ id: "needs-input", state: "unresolved", dedupeKey: "needs-input" })]}
      />,
    );

    const needsInputTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(needsInputTab).toHaveAttribute("data-active-output", "true");
    expect(within(needsInputTab).getByTestId("thread-tab-active-output-spinner")).toBeInTheDocument();
    expect(within(needsInputTab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
    expect(within(needsInputTab).getByTestId("thread-tab-list-row-meta")).toHaveAttribute(
      "data-title-color",
      getPhaseThreadTabTitleColor("WORKING"),
    );

    const inactiveTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!;
    expect(inactiveTab).toHaveAttribute("data-active-output", "false");
    expect(within(inactiveTab).queryByTestId("thread-tab-active-output-spinner")).not.toBeInTheDocument();
    withBellView.unmount();

    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "q-1", questId: "q-1" }]]),
    });

    render(<WorkBoardBar sessionId="s1" currentThreadKey="q-1" openThreadKeys={["q-1"]} />);
    const noBellTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(within(noBellTab).getByTestId("thread-tab-active-output-spinner")).toBeInTheDocument();
    expect(within(noBellTab).queryByTestId("thread-tab-bell")).not.toBeInTheDocument();
  });

  it("prioritizes a needs-input bell when a visible tab has needs-input and review attention", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", [{ ...BOARD_DATA[0]!, waitForInput: ["n-1"] }, BOARD_DATA[1]!]]]),
    });

    const { getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-2"
        openThreadKeys={["q-1", "q-2"]}
        attentionRecords={[
          attentionRecord({
            id: "review-notification",
            type: "review_ready",
            source: { kind: "notification", id: "n-2", questId: "q-1" },
            title: "q-1 ready for review",
            summary: "Review q-1",
            actionLabel: "Review",
            priority: "review",
            dedupeKey: "review-notification",
          }),
        ]}
      />,
    );

    const reviewTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(reviewTab).toHaveAttribute("data-blue-notification", "true");
    expect(reviewTab).toHaveAttribute("data-needs-input", "true");
    // One bell per tab: the prompt's amber outranks the unread result's blue.
    expect(within(reviewTab).getAllByTestId("thread-tab-bell")).toHaveLength(1);
    expect(within(reviewTab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");

    const currentTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!;
    expect(currentTab).toHaveAttribute("data-selected", "true");
  });

  it("renders muted-only needs-input tabs with a gray muted bell", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", [{ ...BOARD_DATA[0]!, waitForInput: ["n-muted"] }]]]),
    });

    const { getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        attentionRecords={[
          attentionRecord({
            id: "notification:n-muted",
            source: { kind: "notification", id: "n-muted", questId: "q-1" },
            state: "muted",
            dedupeKey: "notification:n-muted",
          }),
        ]}
      />,
    );

    const tab = listedThreadTabs().find((candidate) => candidate.getAttribute("data-thread-key") === "q-1")!;
    expect(tab).toHaveAttribute("data-needs-input", "false");
    expect(tab).toHaveAttribute("data-muted-needs-input", "true");
    expect(within(tab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "muted");
    expect(within(tab).getByTestId("thread-tab-bell")).toHaveClass("text-cc-muted");
  });

  it("keeps active needs-input amber ahead of muted needs-input on the same tab", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", [{ ...BOARD_DATA[0]!, waitForInput: ["n-active", "n-muted"] }]]]),
    });

    const { getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        attentionRecords={[
          attentionRecord({
            id: "notification:n-active",
            source: { kind: "notification", id: "n-active", questId: "q-1" },
            state: "unresolved",
            dedupeKey: "notification:n-active",
          }),
          attentionRecord({
            id: "notification:n-muted",
            source: { kind: "notification", id: "n-muted", questId: "q-1" },
            state: "muted",
            dedupeKey: "notification:n-muted",
          }),
        ]}
      />,
    );

    const tab = listedThreadTabs().find((candidate) => candidate.getAttribute("data-thread-key") === "q-1")!;
    expect(tab).toHaveAttribute("data-needs-input", "true");
    expect(tab).toHaveAttribute("data-muted-needs-input", "true");
    expect(within(tab).getAllByTestId("thread-tab-bell")).toHaveLength(1);
    expect(within(tab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
    expect(within(tab).getByTestId("thread-tab-bell")).toHaveClass("text-cc-attention");
  });

  it("embeds Main-owned needs-input state into the pinned Main tab without a duplicate chip", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
    });

    const { getByTestId, queryByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        attentionRecords={[
          attentionRecord({
            id: "main-needs-input",
            threadKey: "main",
            questId: undefined,
            route: { threadKey: "main" },
            title: "Main needs input",
            dedupeKey: "main-needs-input",
          }),
        ]}
      />,
    );

    // Main carries its own bell and is in no group, so no Needs you group appears for it.
    const mainTab = getByTestId("thread-tab-group-main");
    expect(mainTab).toHaveTextContent("Main");
    expect(mainTab).not.toHaveTextContent("Answer");
    expect(within(mainTab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");
    expect(within(mainTab).getByTestId("thread-tab-bell")).toHaveClass("text-cc-attention");
    expect(queryByTestId("thread-chip")).not.toBeInTheDocument();
    expect(queryByTestId("thread-tab-group-chip")).not.toBeInTheDocument();
  });

  it("renders Main needs-input as an attention bell without tinting Main while a quest tab is current", () => {
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });

    const { getAllByTestId, getByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        attentionRecords={[
          attentionRecord({
            id: "main-needs-input",
            threadKey: "main",
            questId: undefined,
            route: { threadKey: "main" },
            title: "Main needs input",
            dedupeKey: "main-needs-input",
          }),
        ]}
      />,
    );

    // Main's bell shows while a quest is current, without making Main the selected tab.
    const mainTab = getByTestId("thread-tab-group-main");
    expect(mainTab).toHaveAttribute("aria-selected", "false");
    expect(mainTab).not.toHaveClass("bg-cc-card");
    expect(mainTab).not.toHaveTextContent("Answer");
    expect(within(mainTab).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "needs-input");

    const currentTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    expect(currentTab).toHaveAttribute("data-selected", "true");
  });

  it("keeps closed inactive history hidden unless the user has opened it as a tab", () => {
    const completed = [{ questId: "q-3", status: "DONE", title: "Finished work", updatedAt: 3, completedAt: 3 }];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([["s1", completed]]),
    });

    const { queryByText, queryByTestId, rerender, getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        threadRows={[{ threadKey: "q-3", questId: "q-3", title: "Finished work", messageCount: 2, section: "done" }]}
      />,
    );

    expect(queryByText("Finished work")).not.toBeInTheDocument();

    rerender(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-3"]}
        threadRows={[{ threadKey: "q-3", questId: "q-3", title: "Finished work", messageCount: 2, section: "done" }]}
      />,
    );

    expect(listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-3")).toHaveTextContent(
      "Finished work",
    );
    expect(queryByTestId("thread-chip")).not.toBeInTheDocument();
  });

  it("keeps Main pinned and only exposes close controls for closable thread tabs", () => {
    const onCloseThreadTab = vi.fn();
    const completed = [{ questId: "q-3", status: "DONE", title: "Finished work", updatedAt: 3, completedAt: 3 }];
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
      sessionCompletedBoards: new Map([["s1", completed]]),
    });

    const { getAllByTestId, getByTestId, getByLabelText, queryByLabelText } = render(
      <WorkBoardBar sessionId="s1" openThreadKeys={["q-1", "q-3"]} onCloseThreadTab={onCloseThreadTab} />,
    );

    expect(getByTestId("thread-tab-group-main")).toHaveTextContent("Main");
    expect(queryByLabelText("Close Main")).not.toBeInTheDocument();
    const activeTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-1")!;
    const completedTab = listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-3")!;
    expect(activeTab).toHaveAttribute("data-closable", "false");
    expect(completedTab).toHaveAttribute("data-closable", "true");
    expect(within(activeTab).queryByTestId("thread-tab-list-row-close")).not.toBeInTheDocument();
    fireEvent.click(getByLabelText("Close q-3"));
    // q-3 is alone in Done; the next tab comes from its own group, so Main opens.
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-3", "main");
  });

  it("uses sibling select and close buttons for listed tabs", () => {
    const onSelectThread = vi.fn();
    const onCloseThreadTab = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
    });

    const { getAllByTestId, getByLabelText } = render(
      <WorkBoardBar
        sessionId="s1"
        openThreadKeys={["q-99"]}
        onSelectThread={onSelectThread}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={[{ threadKey: "q-99", questId: "q-99", title: "Off-board thread", messageCount: 2 }]}
      />,
    );

    const tab = listedThreadTabs().find((candidate) => candidate.getAttribute("data-thread-key") === "q-99")!;
    expect(tab.tagName).toBe("DIV");
    expect(tab.querySelector("button button")).toBeNull();

    fireEvent.click(getByLabelText("Close q-99"));
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-99", "main");
    expect(onSelectThread).not.toHaveBeenCalled();

    fireEvent.click(within(tab).getByTestId("thread-tab-list-row-select"));
    expect(onSelectThread).toHaveBeenCalledWith("q-99");
  });

  it("passes the right-hand visible tab as the active close fallback for persisted tabs", () => {
    const onSelectThread = vi.fn();
    const onCloseThreadTab = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", []]]),
    });

    const { getAllByTestId, getByLabelText } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-middle"
        openThreadKeys={["q-left", "q-middle", "q-right"]}
        onSelectThread={onSelectThread}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={[
          { threadKey: "q-left", questId: "q-left", title: "Left thread", messageCount: 1 },
          { threadKey: "q-middle", questId: "q-middle", title: "Selected thread", messageCount: 2 },
          { threadKey: "q-right", questId: "q-right", title: "Right thread", messageCount: 3 },
        ]}
      />,
    );

    // Preserve the current rendered tab order: the fallback should be the visible neighbor to the right.
    expect(listedThreadTabs().map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-left",
      "q-middle",
      "q-right",
    ]);

    fireEvent.click(getByLabelText("Close q-middle"));

    expect(onCloseThreadTab).toHaveBeenCalledWith("q-middle", "q-right");
    expect(onSelectThread).not.toHaveBeenCalled();
  });

  it("routes unified active tab clicks to the owning thread", () => {
    const onSelectThread = vi.fn();
    resetStore({
      sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
      sessionBoards: new Map([["s1", BOARD_DATA]]),
    });
    const { getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="main"
        onSelectThread={onSelectThread}
        attentionRecords={[attentionRecord({ route: { threadKey: "q-2", questId: "q-2" }, threadKey: "q-2" })]}
      />,
    );

    fireEvent.click(
      within(listedThreadTabs().find((tab) => tab.getAttribute("data-thread-key") === "q-2")!).getByTestId(
        "thread-tab-list-row-select",
      ),
    );
    expect(onSelectThread).toHaveBeenCalledWith("q-2");
  });
});
