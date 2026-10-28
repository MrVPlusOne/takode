// @vitest-environment jsdom
/**
 * Attention, color and closing behavior of leader thread tabs listed under their status
 * groups: group counts and bells, the order inside groups, title colors for finished and
 * waiting quests, canonical titles, and lists that stay open across closes.
 */
import { rememberTopicList } from "../utils/leader-topics.js";
import { topBarHelpersRef, topBarNavRef } from "../utils/top-bar-slots.js";
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestTitlePreview, QuestmasterTask, SessionAttentionRecord, SessionState } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";
import { getQuestPhaseColorValue } from "../utils/quest-phase-theme.js";
import {
  installWorkBoardProjectionFixture,
  resetWorkBoardProjectionFixture,
  type WorkBoardProjectionPropsFixture,
} from "../test-fixtures/work-board-projection-adapter.js";
import { listedThreadTab } from "../test-fixtures/thread-tab-rows.js";

interface MockStoreState {
  sessionBoards: Map<string, BoardRowData[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  sessionCompletedBoards: Map<string, BoardRowData[]>;
  sdkSessions: Array<{ sessionId: string; isOrchestrator?: boolean }>;
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
  questDetails: Map<string, QuestmasterTask>;
  questTitlePreviews: Map<string, QuestTitlePreview | null>;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  activeTurnRoutes: Map<string, import("../types.js").ActiveTurnRoute | null>;
  syncedProjectionValues: Map<string, unknown>;
  syncedProjectionKeys: Set<string>;
}

let mockState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    sessionCompletedBoards: new Map(),
    sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
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
    questDetails: new Map(),
    questTitlePreviews: new Map(),
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
      requestScrollToMessage: vi.fn(),
      setExpandAllInTurn: vi.fn(),
    }),
  }),
}));

vi.mock("./BoardTable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./BoardTable.js")>();
  return {
    ...actual,
    BoardTable: () => <div data-testid="board-table" />,
  };
});

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

function reviewAttentionRecord(threadKey: string): SessionAttentionRecord {
  return {
    id: `review:${threadKey}`,
    leaderSessionId: "s1",
    type: "review_ready",
    source: { kind: "notification", id: `n-${threadKey}`, questId: threadKey },
    questId: threadKey,
    threadKey,
    title: `${threadKey} ready for review`,
    summary: `Review ${threadKey}`,
    actionLabel: "Review",
    priority: "review",
    state: "unresolved",
    createdAt: 100,
    updatedAt: 100,
    route: { threadKey, questId: threadKey },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: `review:${threadKey}`,
  };
}

function readyResultAttentionRecord(threadKey: string): SessionAttentionRecord {
  return {
    ...reviewAttentionRecord(threadKey),
    id: `thread-ready:${threadKey}`,
    title: `${threadKey} ready`,
    summary: `Thread ready: ${threadKey} | quest complete`,
    dedupeKey: `thread-ready:${threadKey}`,
  };
}

function getPhaseColor(status: string): string | undefined {
  const phase = getQuestJourneyPhaseForState(status);
  return phase ? getQuestPhaseColorValue(phase.color) : undefined;
}

function waitingThreadStatus(threadKey: string): LeaderThreadStatus {
  return {
    kind: "waiting",
    label: "Thread Waiting",
    threadKey,
    questId: threadKey,
    summary: "waiting for worker",
    messageId: `${threadKey}-waiting`,
    timestamp: 20,
    updatedAt: 20,
  };
}

const THREAD_ROWS = Array.from({ length: 5 }, (_, index) => {
  const questNumber = index + 1;
  return {
    threadKey: `q-${questNumber}`,
    questId: `q-${questNumber}`,
    title: `Quest ${questNumber} thread`,
    messageCount: questNumber,
  };
});

const OPEN_KEYS = ["q-1", "q-2", "q-3", "q-4", "q-5"];

function groupChip(group: string): HTMLElement {
  return screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === group)!;
}

/** Opens a group's list (a right-click also opens a group of one) and returns its rows. */
function openGroup(group: string): HTMLElement[] {
  fireEvent.contextMenu(groupChip(group));
  return within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
}

function row(rows: HTMLElement[], threadKey: string): HTMLElement {
  return rows.find((candidate) => candidate.getAttribute("data-thread-key") === threadKey)!;
}

describe("WorkBoardBar tab groups", () => {
  beforeEach(() => {
    resetWorkBoardProjectionFixture();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("files every open tab under its group and selects a tab from a group's list", () => {
    // q-3 waits for input and the leader is writing in q-4, so Needs you holds q-3 and
    // the in-progress group carries the writing marker.
    const onSelectThread = vi.fn();
    resetStore({
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "q-4", questId: "q-4" }]]),
      sessionBoards: new Map([
        ["s1", [{ questId: "q-3", title: "Quest 3 thread", status: "WAITING", updatedAt: 3, waitForInput: ["user"] }]],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={OPEN_KEYS}
        onSelectThread={onSelectThread}
        threadRows={THREAD_ROWS}
      />,
    );

    expect(groupChip("needs-input")).toHaveAttribute("data-count", "1");
    expect(groupChip("in-progress")).toHaveAttribute("data-count", "4");
    expect(groupChip("in-progress")).toHaveAttribute("data-active-output", "true");

    fireEvent.click(groupChip("in-progress"));
    const rows = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
    expect(rows.map((candidate) => candidate.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2", "q-4", "q-5"]);
    expect(row(rows, "q-4")).toHaveAttribute("data-active-output", "true");

    fireEvent.click(within(row(rows, "q-4")).getByTestId("thread-tab-list-row-select"));
    expect(onSelectThread).toHaveBeenCalledWith("q-4");
    expect(screen.queryByTestId("thread-tab-group-list")).not.toBeInTheDocument();
  });

  it("draws a desktop leader's tabs in the top bar with topics on, only for the conversation on screen", () => {
    // Its own leader ID: the topics cache is module state that outlives a test.
    const width = window.innerWidth;
    window.innerWidth = 1280;
    const leader = "topbar-leader";
    resetStore({
      sdkSessions: [{ sessionId: leader, isOrchestrator: true }],
      sessionBoards: new Map([[leader, [{ questId: "q-3", title: "Quest 3", status: "WORKING", updatedAt: 3 }]]]),
    });
    rememberTopicList(leader, [{ id: "t1", name: "Relay", activityAt: 1, questIds: ["q-1"] } as never]);
    const nav = document.createElement("div");
    const helpers = document.createElement("div");
    document.body.append(nav, helpers);
    topBarNavRef(nav);
    topBarHelpersRef(helpers);
    try {
      // A kept conversation, mounted but not on screen, leaves the top bar alone.
      (mockState as MockStoreState & { currentSessionId?: string }).currentSessionId = "another-session";
      const view = render(
        <WorkBoardBar sessionId={leader} currentThreadKey="q-5" openThreadKeys={OPEN_KEYS} threadRows={THREAD_ROWS} />,
      );
      expect(screen.queryByTestId("thread-tab-group-bar")).toBeNull();

      (mockState as MockStoreState & { currentSessionId?: string }).currentSessionId = leader;
      view.rerender(
        <WorkBoardBar sessionId={leader} currentThreadKey="q-5" openThreadKeys={OPEN_KEYS} threadRows={THREAD_ROWS} />,
      );
      expect(within(nav).getByTestId("thread-tab-group-main")).toBeInTheDocument();
      // Working on carries the Board button's icon, one dot per quest at work on the board.
      expect(within(helpers).getAllByTestId("workboard-dot")).toHaveLength(1);
      // No tab row of its own under the top bar.
      expect(view.container.querySelector('[data-testid="thread-tab-group-bar"]')).toBeNull();
      view.unmount();
    } finally {
      window.innerWidth = width;
      topBarNavRef(null);
      topBarHelpersRef(null);
      nav.remove();
      helpers.remove();
    }
  });

  it("counts unread results without treating an opened list as reading them", () => {
    const onSelectThread = vi.fn();

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={OPEN_KEYS}
        onSelectThread={onSelectThread}
        threadRows={THREAD_ROWS}
        attentionRecords={[reviewAttentionRecord("q-4")]}
      />,
    );

    const results = groupChip("new-results");
    expect(results).toHaveAttribute("data-count", "1");
    expect(results).toHaveClass("text-cc-muted");
    const rows = openGroup("new-results");
    expect(onSelectThread).not.toHaveBeenCalled();

    expect(row(rows, "q-4")).toHaveAttribute("data-blue-notification", "true");
    expect(within(row(rows, "q-4")).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "review");

    fireEvent.click(within(row(rows, "q-4")).getByTestId("thread-tab-list-row-select"));
    expect(onSelectThread).toHaveBeenCalledWith("q-4");
  });

  it("files a Thread Ready unread result under New results with a blue bell", () => {
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="main"
        openThreadKeys={["q-4"]}
        threadRows={THREAD_ROWS}
        attentionRecords={[readyResultAttentionRecord("q-4")]}
      />,
    );

    const q4 = row(openGroup("new-results"), "q-4");
    expect(q4).toHaveAttribute("data-blue-notification", "true");
    expect(q4).toHaveAttribute("data-needs-input", "false");
    expect(within(q4).getByTestId("thread-tab-bell")).toHaveClass("text-cc-info");
  });

  it("keeps an open prompt ahead of an unread result for both the group and the bell", () => {
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-4", title: "Quest 4 thread", status: "WAITING", updatedAt: 4, waitForInput: ["user"] }]],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={OPEN_KEYS}
        threadRows={THREAD_ROWS}
        attentionRecords={[readyResultAttentionRecord("q-4"), reviewAttentionRecord("q-4")]}
      />,
    );

    // q-4 has both, so it waits under Needs you and no New results group appears.
    expect(groupChip("needs-input")).toHaveAttribute("data-count", "1");
    expect(screen.getAllByTestId("thread-tab-group-chip").some((chip) => chip.dataset.group === "new-results")).toBe(
      false,
    );
    const q4 = row(openGroup("needs-input"), "q-4");
    expect(q4).toHaveAttribute("data-needs-input", "true");
    expect(q4).toHaveAttribute("data-blue-notification", "true");
    expect(within(q4).getAllByTestId("thread-tab-bell")).toHaveLength(1);
    expect(within(q4).getByTestId("thread-tab-bell")).toHaveClass("text-cc-attention");
  });

  it("moves the tab on screen from In progress straight to Done when its quest finishes", () => {
    // The server finishes a quest in two steps (completeBoardRow): it moves the board row to
    // the completed board, then posts a "ready for review" result for that quest. The user
    // is watching q-4, so the browser marks that result read as soon as it arrives, one
    // round trip later. Each step below is one server update; the bar must never show the
    // tab on screen under New results in between.
    const onScreenGroups: Array<{ selected: string | undefined; groups: string[] }> = [];
    const snapshot = () =>
      onScreenGroups.push({
        selected: screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.selected === "true")
          ?.dataset.group,
        groups: screen.getAllByTestId("thread-tab-group-chip").map((chip) => chip.dataset.group!),
      });
    const workingRow = { questId: "q-4", title: "Quest 4 thread", status: "IMPLEMENTING", updatedAt: 4 };
    const finishedRow = { ...workingRow, status: "DONE", updatedAt: 200, completedAt: 200 };
    const bar = (attentionRecords: SessionAttentionRecord[]) => (
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-4"
        openThreadKeys={["q-1", "q-4"]}
        threadRows={THREAD_ROWS}
        attentionRecords={attentionRecords}
      />
    );
    const result = { ...reviewAttentionRecord("q-4"), createdAt: 201, updatedAt: 201 };

    resetStore({ sessionBoards: new Map([["s1", [workingRow]]]) });
    const { rerender } = render(bar([]));
    snapshot();

    // The board row finishes and the result arrives unread.
    mockState.sessionBoards = new Map([["s1", []]]);
    mockState.sessionCompletedBoards = new Map([["s1", [finishedRow]]]);
    rerender(bar([result]));
    snapshot();

    // The browser's read lands.
    rerender(bar([{ ...result, state: "resolved", resolvedAt: 260, updatedAt: 260 }]));
    snapshot();

    expect(onScreenGroups).toEqual([
      { selected: "in-progress", groups: ["in-progress"] },
      { selected: "done", groups: ["in-progress", "done"] },
      { selected: "done", groups: ["in-progress", "done"] },
    ]);
  });

  it("still files another tab's unread result under New results", () => {
    // Only the tab on screen counts as read: q-1 finished while the user watched q-4.
    resetStore({
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-1", title: "Quest 1 thread", status: "DONE", updatedAt: 9, completedAt: 9 }]],
      ]),
    });
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-4"
        openThreadKeys={["q-1", "q-4"]}
        threadRows={THREAD_ROWS}
        attentionRecords={[reviewAttentionRecord("q-1")]}
      />,
    );
    expect(row(openGroup("new-results"), "q-1")).toHaveAttribute("data-blue-notification", "true");
  });

  it("uses the done gray for finished quests listed under Done", () => {
    resetStore({
      sessionCompletedBoards: new Map([
        [
          "s1",
          [
            {
              questId: "q-4",
              title: "Finished thread",
              status: "PORTING",
              updatedAt: 4,
              completedAt: 4,
              journey: {
                presetId: "full-code",
                phaseIds: ["alignment", "implement", "code-review", "port"],
                currentPhaseId: "port",
              },
            },
          ],
        ],
      ]),
    });

    render(<WorkBoardBar sessionId="s1" currentThreadKey="q-5" openThreadKeys={OPEN_KEYS} threadRows={THREAD_ROWS} />);

    const meta = within(row(openGroup("done"), "q-4")).getByTestId("thread-tab-list-row-meta");
    expect(meta).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(meta).not.toHaveStyle({ color: getPhaseColor("PORTING") });
  });

  it("uses the normal foreground for a finished quest with an authoritative Thread Waiting", () => {
    // Work continues in that thread, so its title does not read as done, and the waiting
    // status is not an attention signal of its own.
    resetStore({
      sessions: new Map([
        ["s1", { leaderThreadStatuses: { "q-4": waitingThreadStatus("q-4") } } as unknown as SessionState],
      ]),
      sessionCompletedBoards: new Map([
        ["s1", [{ questId: "q-4", title: "Waiting thread", status: "DONE", updatedAt: 4, completedAt: 4 }]],
      ]),
    });

    render(<WorkBoardBar sessionId="s1" currentThreadKey="q-5" openThreadKeys={OPEN_KEYS} threadRows={THREAD_ROWS} />);

    const groups = screen.getAllByTestId("thread-tab-group-chip").map((chip) => chip.dataset.group);
    expect(groups).not.toContain("needs-input");
    expect(groups).not.toContain("new-results");
    const meta = within(row(openGroup("done"), "q-4")).getByTestId("thread-tab-list-row-meta");
    expect(meta).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
  });

  it("keeps an unfinished off-board quest unmuted and closable", () => {
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        onCloseThreadTab={vi.fn()}
        threadRows={[
          {
            threadKey: "q-1",
            questId: "q-1",
            title: "Unfinished off-board thread",
            status: "in_progress",
            messageCount: 2,
            section: "done",
          },
        ]}
      />,
    );

    const q1 = row(openGroup("in-progress"), "q-1");
    expect(q1).toHaveAttribute("data-closable", "true");
    expect(within(q1).getByTestId("thread-tab-list-row-meta")).toHaveAttribute("data-title-color", "");
  });

  it("lets a finished quest's status beat a stale active board phase on the selected tab", () => {
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-1259", title: "Completed but stale active row", status: "PORTING", updatedAt: 10 }]],
      ]),
      quests: [
        {
          id: "q-1259",
          questId: "q-1259",
          version: 1,
          title: "Completed but stale active row",
          description: "",
          status: "done",
          tags: [],
          createdAt: 1,
          updatedAt: 10,
          statusChangedAt: 10,
          completedAt: 10,
          verificationItems: [],
        },
      ],
    });

    render(<WorkBoardBar sessionId="s1" currentThreadKey="q-1259" openThreadKeys={["q-1259"]} threadRows={[]} />);

    const tab = listedThreadTab("q-1259")!;
    expect(tab).toHaveAttribute("data-selected", "true");
    const meta = within(tab).getByTestId("thread-tab-list-row-meta");
    expect(meta).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(meta).not.toHaveStyle({ color: getPhaseColor("PORTING") });
  });

  it("shows a hydrated canonical title for a retained removed-board tab", () => {
    // A server-owned open key keeps its tab after its cancelled quest disappears from
    // both board collections and the paged quest list.
    resetStore({
      questDetails: new Map([
        [
          "q-1932",
          {
            id: "q-1932-v2",
            questId: "q-1932",
            version: 2,
            title: "Old cached title",
            description: "Stale detail body",
            status: "done",
            createdAt: 1,
            updatedAt: 20,
            completedAt: 20,
            verificationItems: [],
          } as QuestmasterTask,
        ],
      ]),
      questTitlePreviews: new Map([
        ["q-1932", { questId: "q-1932", title: "Resolve VSCode QA Stack Conflicts", version: 3, updatedAt: 30 }],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-1932"]}
        threadRows={THREAD_ROWS}
      />,
    );

    const retained = listedThreadTab("q-1932");
    expect(retained).toBeDefined();
    expect(retained).toHaveTextContent("Resolve VSCode QA Stack Conflicts");
    expect(retained).not.toHaveTextContent("Old cached title");
  });

  it("keeps a group's list open after closing a tab from it", () => {
    // The close fallback still follows the full ordered tab list.
    const onCloseThreadTab = vi.fn();
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={OPEN_KEYS}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={THREAD_ROWS}
      />,
    );

    const rows = openGroup("in-progress");
    fireEvent.click(within(row(rows, "q-4")).getByLabelText("Close q-4"));

    expect(onCloseThreadTab).toHaveBeenCalledWith("q-4", "q-5");
    expect(screen.getByTestId("thread-tab-group-list")).toBeInTheDocument();
  });

  it("keeps a group's list open across several closes", () => {
    const onCloseThreadTab = vi.fn();
    const view = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={OPEN_KEYS}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={THREAD_ROWS}
      />,
    );

    fireEvent.click(within(row(openGroup("in-progress"), "q-4")).getByLabelText("Close q-4"));
    expect(screen.getByTestId("thread-tab-group-list")).toBeInTheDocument();

    // Simulate the server-owned tab state after the first close while the list stays open.
    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-5"]}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={THREAD_ROWS}
      />,
    );

    const remaining = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
    expect(remaining.map((candidate) => candidate.getAttribute("data-thread-key"))).toEqual([
      "q-1",
      "q-2",
      "q-3",
      "q-5",
    ]);
    fireEvent.click(within(row(remaining, "q-3")).getByLabelText("Close q-3"));

    expect(onCloseThreadTab).toHaveBeenNthCalledWith(1, "q-4", "q-5");
    expect(onCloseThreadTab).toHaveBeenNthCalledWith(2, "q-3", "q-5");
    expect(screen.getByTestId("thread-tab-group-list")).toBeInTheDocument();
  });
});
