// @vitest-environment jsdom
/**
 * Attention, color and closing behavior of leader thread tabs listed under their status
 * groups: group counts and bells, the order inside groups, title colors for finished and
 * waiting quests, canonical titles, and lists that stay open across closes.
 */
import { rememberTopicList } from "../utils/leader-topics.js";
import { showTopBarSession, topBarHelpersRef } from "../utils/top-bar-slots.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { topicApi } from "../api/topics.js";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Activity, type ComponentProps } from "react";
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
  sessionNotifications: Map<string, import("../types.js").SessionNotification[]>;
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
    sessionNotifications: new Map(),
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

/** Opens the place picker and returns its quest rows (the tests file no topics). */
function pickerRows(): HTMLElement[] {
  const first = listedThreadTab(OPEN_KEYS[0]!) ?? listedThreadTab("q-4");
  return first ? within(screen.getByTestId("place-crumb-list")).getAllByTestId("thread-tab-list-row") : [];
}

function row(rows: HTMLElement[], threadKey: string): HTMLElement {
  return rows.find((candidate) => candidate.getAttribute("data-thread-key") === threadKey)!;
}

describe("WorkBoardBar quest rows in the place picker", () => {
  beforeEach(() => {
    resetWorkBoardProjectionFixture();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("navigates a leader with topics on by breadcrumb, with Working on in the top bar only for the conversation on screen", () => {
    // No tab row: the place picker starts Main's strip, and Working on (the Board button merged in)
    // sits in the top bar. Recently viewed conversations stay mounted, hidden in a React Activity, as
    // in KeptConversationViews; switching leader A -> B -> A once left A's hidden copy in the top bar
    // beside the one on screen. Their own leader IDs: the topics cache is module state that outlives
    // a test.
    const width = window.innerWidth;
    window.innerWidth = 1280;
    const [leaderA, leaderB] = ["topbar-leader-a", "topbar-leader-b"];
    resetStore({
      sdkSessions: [
        { sessionId: leaderA, isOrchestrator: true },
        { sessionId: leaderB, isOrchestrator: true },
      ],
      sessionBoards: new Map([[leaderA, [{ questId: "q-3", title: "Quest 3", status: "WORKING", updatedAt: 3 }]]]),
    });
    for (const leader of [leaderA, leaderB]) {
      rememberTopicList(leader, [{ id: "t1", name: "Relay", activityAt: 1, questIds: ["q-1"] } as never]);
    }
    const helpers = document.createElement("div");
    document.body.append(helpers);
    topBarHelpersRef(helpers);
    const visible = (place: HTMLElement, testId: string) =>
      within(place)
        .queryAllByTestId(testId)
        .filter((element) => !element.closest('[style*="display: none"]'));
    const kept = (shown: string, keptIds: string[]) => (
      <>
        {keptIds.map((leader) => (
          <Activity key={leader} mode={leader === shown ? "visible" : "hidden"}>
            <WorkBoardBar sessionId={leader} currentThreadKey="main" openThreadKeys={[]} threadRows={[]} />
          </Activity>
        ))}
      </>
    );
    const show = (leader: string) => {
      (mockState as MockStoreState & { currentSessionId?: string }).currentSessionId = leader;
      act(() => showTopBarSession(leader));
    };
    try {
      show(leaderA);
      const view = render(kept(leaderA, [leaderA]));
      expect(visible(document.body, "place-crumb-button")).toHaveLength(1);
      expect(screen.getByTestId("workboard-main-banner")).toContainElement(screen.getByTestId("place-crumb-button"));
      // Working on carries the Board button's icon, one dot per quest at work on the board.
      expect(within(helpers).getAllByTestId("workboard-dot")).toHaveLength(1);

      show(leaderB);
      view.rerender(kept(leaderB, [leaderA, leaderB]));
      expect(visible(document.body, "place-crumb-button")).toHaveLength(1);
      expect(visible(helpers, "workboard-dot")).toHaveLength(0);

      show(leaderA);
      view.rerender(kept(leaderA, [leaderA, leaderB]));
      expect(visible(document.body, "place-crumb-button")).toHaveLength(1);
      expect(visible(helpers, "thread-tab-group-working-on")).toHaveLength(1);
      expect(visible(helpers, "workboard-dot")).toHaveLength(1);
      view.unmount();
    } finally {
      window.innerWidth = width;
      topBarHelpersRef(null);
      helpers.remove();
    }
  });

  it("puts a topic's page in the side column on Shift-click in the place picker", async () => {
    // A plain click goes to the topic; Shift-click keeps the conversation on screen and opens the
    // topic's page beside it.
    const leader = "side-topic-leader";
    resetStore({ sdkSessions: [{ sessionId: leader, isOrchestrator: true }] });
    const relay = { id: "t1", name: "Relay", activityAt: 1, questIds: ["q-1"] } as never;
    rememberTopicList(leader, [relay]);
    const list = vi.spyOn(topicApi, "list").mockResolvedValue({ topics: [relay] } as never);
    const hashBefore = window.location.hash;
    try {
      render(<WorkBoardBar sessionId={leader} currentThreadKey="main" openThreadKeys={[]} threadRows={[]} />);
      fireEvent.click(screen.getByTestId("place-crumb-button"));
      const row = (await screen.findAllByTestId("topic-tab-row")).find(
        (candidate) => candidate.dataset.topic === "t1",
      )!;
      fireEvent.click(within(row).getByRole("menuitem"), { shiftKey: true });
      expect(useSideColumnStore.getState().columns[leader]!.items).toEqual([
        expect.objectContaining({ kind: "topic", topicId: "t1" }),
      ]);
      expect(window.location.hash).toBe(hashBefore);
    } finally {
      list.mockRestore();
      useSideColumnStore.setState({ columns: {} });
      localStorage.clear();
    }
  });

  it("opens a topic with unread answers like any place, not at its first unread answer", async () => {
    // Opening a topic follows the opening rule (where it was left if recent, else at the latest
    // with the unread counted above); only Next and links land on a specific message.
    const leader = "unread-topic-leader";
    resetStore({
      sdkSessions: [{ sessionId: leader, isOrchestrator: true }],
      sessionNotifications: new Map([
        [
          leader,
          [
            {
              id: "n-answer",
              category: "review",
              unreadReason: "answer",
              messageId: "m-answer",
              threadKey: "q-1",
              timestamp: 10,
              done: false,
            },
          ],
        ],
      ]),
    });
    const relay = { id: "t1", name: "Relay", activityAt: 1, questIds: ["q-1"] } as never;
    rememberTopicList(leader, [relay]);
    const list = vi.spyOn(topicApi, "list").mockResolvedValue({ topics: [relay] } as never);
    const onSelectThread = vi.fn();
    try {
      render(
        <WorkBoardBar
          sessionId={leader}
          currentThreadKey="main"
          openThreadKeys={[]}
          threadRows={[]}
          onSelectThread={onSelectThread}
        />,
      );
      fireEvent.click(screen.getByTestId("place-crumb-button"));
      const row = (await screen.findAllByTestId("topic-tab-row")).find(
        (candidate) => candidate.dataset.topic === "t1",
      )!;
      fireEvent.click(within(row).getByRole("menuitem"));
      expect(window.location.hash).not.toContain("/msg/");
      // The topic's conversation, a place of its own.
      expect(onSelectThread).toHaveBeenCalledWith("topic:t1");
    } finally {
      list.mockRestore();
      localStorage.clear();
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

    const rows = pickerRows();
    expect(onSelectThread).not.toHaveBeenCalled();

    expect(row(rows, "q-4")).toHaveAttribute("data-blue-notification", "true");
    expect(within(row(rows, "q-4")).getByTestId("thread-tab-bell")).toHaveAttribute("data-kind", "review");

    fireEvent.click(within(row(rows, "q-4")).getByTestId("thread-tab-list-row-select"));
    expect(onSelectThread).toHaveBeenCalledWith("q-4");
  });

  it("marks a Thread Ready unread result with a blue bell", () => {
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="main"
        openThreadKeys={["q-4"]}
        threadRows={THREAD_ROWS}
        attentionRecords={[readyResultAttentionRecord("q-4")]}
      />,
    );

    const q4 = row(pickerRows(), "q-4");
    expect(q4).toHaveAttribute("data-blue-notification", "true");
    expect(q4).toHaveAttribute("data-needs-input", "false");
    expect(within(q4).getByTestId("thread-tab-bell")).toHaveClass("text-cc-info");
  });

  it("keeps an open prompt ahead of an unread result for the bell", () => {
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

    // q-4 has both: one bell, in the attention color.
    const q4 = row(pickerRows(), "q-4");
    expect(q4).toHaveAttribute("data-needs-input", "true");
    expect(q4).toHaveAttribute("data-blue-notification", "true");
    expect(within(q4).getAllByTestId("thread-tab-bell")).toHaveLength(1);
    expect(within(q4).getByTestId("thread-tab-bell")).toHaveClass("text-cc-attention");
  });

  it("still marks another tab's unread result", () => {
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
    expect(row(pickerRows(), "q-1")).toHaveAttribute("data-blue-notification", "true");
  });

  it("uses the done gray for finished quests", () => {
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

    const meta = within(row(pickerRows(), "q-4")).getByTestId("thread-tab-list-row-meta");
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

    const q4 = row(pickerRows(), "q-4");
    expect(q4).toHaveAttribute("data-needs-input", "false");
    expect(q4).toHaveAttribute("data-blue-notification", "false");
    const meta = within(q4).getByTestId("thread-tab-list-row-meta");
    expect(meta).toHaveAttribute("data-title-color", "var(--color-cc-fg)");
  });

  it("keeps an unfinished off-board quest unmuted and closable", () => {
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
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

    const q1 = row(pickerRows(), "q-1");
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
});
