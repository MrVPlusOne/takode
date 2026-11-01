// @vitest-environment jsdom
/**
 * A leader's Home, where its Main conversation was: its threads in one list (questions on top, then
 * by when the user last dealt with them), links to the leader log and the topics, over a message
 * box whose first message starts a new thread with the leader, which then opens in the main view.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const startThread = vi.hoisted(() => vi.fn());
const homeLines = vi.hoisted(() => vi.fn());
const topicList = vi.hoisted(() => vi.fn());
vi.mock("../api/topics.js", () => ({
  topicApi: {
    startThread,
    homeLines,
    list: topicList,
    questMap: vi.fn(() => new Promise(() => {})),
    threads: vi.fn(() => new Promise(() => {})),
  },
}));
type NewThread = { start: (text: string) => Promise<string | null>; started: (threadKey: string) => void };
const composer = vi.hoisted(() => ({ props: null as null | { newThread: NewThread; threadKey: string } }));
vi.mock("./Composer.js", () => ({
  Composer: (props: { newThread: NewThread; threadKey: string }) => {
    composer.props = props;
    return <div data-testid="composer" />;
  },
}));
vi.mock("./side-column/thread-names.js", () => ({ threadNameFromMessage: (text: string) => `named: ${text}` }));
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../utils/routing.js", () => ({ navigateToSessionThread }));
const activityPreview = vi.hoisted(() => vi.fn());
vi.mock("../api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api.js")>();
  return { ...actual, api: { ...actual.api, getSessionActivityPreview: activityPreview } };
});
const EMPTY_TABS_VALUE = {
  currentQuestStateVersion: 1 as const,
  tabState: null,
  tabs: [],
  mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0, changedAt: 0 },
  threadStatuses: {},
  activePhaseSummary: [],
};
import { resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { scopedSetItem } from "../utils/scoped-storage.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { useTopicPanel } from "../utils/topic-panel.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../store.js";
import { LeaderHomePage } from "./LeaderHomePage.js";
import { SideHome } from "./side-column/SideHome.js";
import { useLeaderThreadMembers, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

function member(threadKey: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    title: `Thread ${threadKey}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 1,
    ...overrides,
  };
}

beforeEach(() => {
  homeLines.mockResolvedValue({ lines: {} });
  topicList.mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
  localStorage.clear();
  resetLeaderTopicsForTest();
  cleanup();
  useLeaderThreadMembers.setState({ byLeader: {} });
  useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
  startThread.mockReset();
  navigateToSessionThread.mockReset();
});

describe("LeaderHomePage", () => {
  it("lists each thread once, questions on top, then by when the user last dealt with it", () => {
    // Jiayi (Nov 1): Home's groups overlapped (an unread quest under Unread and Idle). It is now
    // one list like the sessions panel's Threads view: unread doesn't move a row, and the user's
    // own dealings (from the leader's tab projection) set the order.
    useStore.getState().applySyncedProjectionSnapshot({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "l1",
      generation: "home",
      revision: 1,
      value: { ...EMPTY_TABS_VALUE, userInteractionAt: { "q-2": 50, "q-4": 10 } },
    });
    useLeaderThreadMembers.setState({
      byLeader: {
        l1: [
          member("q-4", { questId: "q-4", title: "Fix the relay", needsInput: true, running: false }),
          member("topic:aaaa0001", { title: "Quick question", blueNudge: true, userStartedAt: 30, running: false }),
          member("q-2", { questId: "q-2", title: "Old work", completed: true }),
          member("q-9", { questId: "q-9", title: "Never touched", completed: true, updatedAt: 99 }),
        ],
      },
    });
    render(<LeaderHomePage leaderId="l1" />);
    const rows = () => screen.getAllByTestId("home-thread-row").map((row) => row.dataset.threadKey);
    expect(rows()).toEqual(["q-4", "q-2", "topic:aaaa0001", "q-9"]);
    expect(screen.getByTestId("home-pinned-end")).toBeTruthy();
    fireEvent.click(screen.getAllByTestId("home-thread-row")[0]!);
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "q-4");
    // Filters narrow the same list; a filter with nothing in it is left out.
    fireEvent.click(screen.getByText("New"));
    expect(rows()).toEqual(["topic:aaaa0001"]);
    expect(screen.queryAllByTestId("home-filter").map((chip) => chip.dataset.filter)).toEqual([
      "all",
      "needs-input",
      "new",
    ]);
  });

  it("shows the question asked, a running quest's worker at work, and a finished quest's commits", async () => {
    // Home has room the sessions panel lacks: what the thread asks, what its worker is doing now.
    activityPreview.mockResolvedValue({
      lines: [{ historyIndex: 3, kind: "tool", toolName: "Bash", text: "Run the relay tests", timestamp: 1 }],
      lastActivityAt: 1,
    });
    useStore.setState({
      sessionNotifications: new Map([
        [
          "l1",
          [
            {
              id: "n-1",
              category: "needs-input",
              summary: "Which grading?",
              timestamp: 1,
              messageId: null,
              threadKey: "q-4",
              done: false,
            },
          ],
        ],
      ]),
      sessionBoardRowStatuses: new Map([
        ["l1", { "q-3": { worker: { sessionId: "w-3", sessionNum: 33, status: "running" } } }],
      ]),
    } as never);
    useStore.getState().upsertQuestTitlePreview({ questId: "q-2", title: "Relay", version: 1, commitShas: ["a", "b"] });
    useLeaderThreadMembers.setState({
      byLeader: {
        l1: [
          member("q-4", { questId: "q-4", needsInput: true }),
          member("q-3", { questId: "q-3", stateLabel: "Work", running: true }),
          member("q-2", { questId: "q-2", stateLabel: "Done", completed: true }),
        ],
      },
    });
    render(<LeaderHomePage leaderId="l1" />);
    const status = (key: string) =>
      within(screen.getAllByTestId("home-thread-row").find((row) => row.dataset.threadKey === key)!).getByTestId(
        "home-row-status",
      ).textContent;
    expect(status("q-4")).toBe("Asks: Which grading?");
    expect(status("q-2")).toBe("Done · 2 commits");
    await waitFor(() => expect(status("q-3")).toContain("Bash: Run the relay tests"));
    expect(status("q-3")).toContain("#33");
    expect(activityPreview).toHaveBeenCalledWith("w-3");
    useStore.setState({ sessionNotifications: new Map(), sessionBoardRowStatuses: new Map() } as never);
  });

  it("says so when the leader has no threads yet, and links to the leader log and the topics", () => {
    render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getByTestId("leader-home-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("leader-home-log"));
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "all");
    // Topics are browsed beside: the side column opens on their list.
    fireEvent.click(screen.getByTestId("leader-home-topics"));
    expect(useTopicPanel.getState().open).toBe(true);
  });

  it("starts a new thread from its message box and opens it in the main view", async () => {
    startThread.mockResolvedValue({
      thread: { id: "b1", key: "topic:bbbb0001", name: "named", leaderId: "l1", createdAt: 1, activityAt: 1 },
    });
    render(<LeaderHomePage leaderId="l1" />);
    await expect(composer.props!.newThread.start("Is the eval stalled?")).resolves.toBe("topic:bbbb0001");
    // From Home, so it started from no quest or topic.
    expect(startThread).toHaveBeenCalledWith("l1", "named: Is the eval stalled?", undefined, "Is the eval stalled?");
    composer.props!.newThread.started("topic:bbbb0001");
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "topic:bbbb0001");
  });

  it("shows each thread's line of news and what changed since the user last looked", async () => {
    // Jiayi: Home had room for more than the sessions panel's list. Each row carries its newest
    // update (the Scribe's line, or a stand-in), and one line sums up what changed since last time.
    scopedSetItem("cc-home-seen:l1", "100");
    homeLines.mockResolvedValue({
      lines: { "q-4": { text: "Waiting on your pick of the grading.", at: 5, source: "scribe" } },
    });
    useLeaderThreadMembers.setState({
      byLeader: {
        l1: [
          member("q-4", { questId: "q-4", needsInput: true, groupChangedAt: 200 }),
          member("q-2", { questId: "q-2", completed: true, groupChangedAt: 300 }),
          member("q-3", { questId: "q-3", completed: true, groupChangedAt: 50 }),
        ],
      },
    });
    render(<LeaderHomePage leaderId="l1" />);
    await waitFor(() =>
      expect(screen.getAllByTestId("home-row-line")[0]!.textContent).toBe("Waiting on your pick of the grading."),
    );
    expect(homeLines).toHaveBeenCalledWith("l1", ["q-2", "q-3", "q-4"]);
    expect(screen.getByTestId("home-since-last-looked").textContent).toContain("1 question · 1 finished");
  });

  it("lists the threads in order or by topic, remembering the choice", async () => {
    topicList.mockResolvedValue({
      topics: [{ id: "t1", name: "Relay", questIds: ["q-2"], activityAt: 1, summary: "The phone reaches it again." }],
    });
    useLeaderThreadMembers.setState({
      byLeader: {
        l1: [
          member("q-2", { questId: "q-2", completed: true, groupChangedAt: 2 }),
          member("q-3", { questId: "q-3", completed: true, groupChangedAt: 3 }),
        ],
      },
    });
    const view = render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getAllByTestId("home-thread-row")).toHaveLength(2);
    fireEvent.click(screen.getByTestId("home-view-topic"));
    const topics = await screen.findAllByTestId("idle-topic");
    await waitFor(() => expect(screen.getAllByTestId("idle-topic")[0]!.textContent).toContain("Relay"));
    expect(screen.getByTestId("idle-topic-summary").textContent).toBe("The phone reaches it again.");
    expect(topics.at(-1)!.textContent).toContain("No topic");
    view.unmount();
    render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getByTestId("idle-by-topic")).toBeTruthy();
  });
});

describe("SideHome", () => {
  it("lists another leader's threads from its projection, and opens them in the main view", () => {
    // Jiayi (Nov 1): a Home in the side column switches the main view between a leader's threads.
    // That leader's status row isn't on screen, so the side Home reads its threads itself.
    const attention = { needsInput: false, mutedNeedsInput: false, reviewUnread: true, updatedAt: 5, changedAt: 5 };
    useStore.getState().applySyncedProjectionSnapshot({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "l2",
      generation: "side-home",
      revision: 1,
      value: {
        ...EMPTY_TABS_VALUE,
        tabState: { version: 1 },
        tabs: [
          {
            threadKey: "q-7",
            questId: "q-7",
            title: "Relay outage",
            boardStatus: null,
            journey: null,
            sourceLeaderSessionId: "l2",
            sourceRowCreatedAt: null,
            workerSessionId: null,
            workerSessionNum: null,
            ownership: null,
            active: true,
            queued: false,
            proposed: false,
            neverStartedScheduled: false,
            completed: false,
            canClose: false,
            attention,
            updatedAt: 5,
            groupChangedAt: 5,
          },
        ],
      } as never,
    });
    render(<SideHome leaderId="l2" />);
    const row = screen.getByTestId("home-thread-row");
    expect(row.textContent).toContain("Relay outage");
    // No message box under it: the column has its own New thread.
    expect(screen.queryByTestId("composer")).toBeNull();
    fireEvent.click(row);
    expect(navigateToSessionThread).toHaveBeenCalledWith("l2", "q-7");
  });
});
