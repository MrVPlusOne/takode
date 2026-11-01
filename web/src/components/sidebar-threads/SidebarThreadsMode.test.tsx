// @vitest-environment jsdom
/**
 * The sessions panel's Threads view: every leader's threads (quest threads from each leader's synced
 * tab projection, its other threads, the leader log while Main waits) in one list, the one the user
 * last dealt with first, questions kept on top; each row with its leader's picture, news line and
 * counts; then the leaders and the other sessions. Jiayi (Nov 1): the panel is for finding the
 * thread just used, like a chat app; the bell and each leader's Home are for what needs attention.
 */
import { cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const queue = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock("../../hooks/useNextAttention.js", () => ({ useNextAttention: () => ({ queue: queue.items }) }));
vi.mock("../library/topic-questions.js", () => ({ questOf: (entry: { questId?: string }) => entry.questId ?? null }));
// Home's news lines (`GET /topics/home-lines`), per leader: q-1 has the Scribe's line, q-4 none.
const homeLines = vi.hoisted(() =>
  vi.fn(async (leader: string, _quests: readonly string[]) => ({
    lines:
      leader === "takode" ? { "q-1": { text: "Waiting on your pick of the layout", at: 1, source: "scribe" } } : {},
  })),
);
vi.mock("../../api/topics.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/topics.js")>();
  return { ...actual, topicApi: { ...actual.topicApi, homeLines } };
});
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../../utils/routing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/routing.js")>()),
  navigateToSessionThread,
}));
import type { LeaderThreadTabsProjectionTab } from "../../../shared/leader-thread-tabs-projection.js";
import { useStore } from "../../store.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../../../shared/leader-thread-tabs-projection.js";
import {
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "../../test-fixtures/leader-thread-tabs-projection.js";
import {
  SidebarThreadsMode,
  ThreadsModeNewButton,
  threadRows,
  useThreadsModeData,
  type LeaderThreadsInput,
} from "./SidebarThreadsMode.js";

afterEach(() => {
  cleanup();
  queue.items = [];
  navigateToSessionThread.mockReset();
});

function node(id: string, name: string): RecentSessionNode {
  return {
    leader: { id, name, isOrchestrator: true, sessionNum: 7, createdAt: 0 },
    workers: [],
    spaceId: "s",
    spaceName: "Takode",
    recentAt: 0,
  } as unknown as RecentSessionNode;
}

function tab(questId: string, overrides: Partial<LeaderThreadTabsProjectionTab> = {}): LeaderThreadTabsProjectionTab {
  return {
    threadKey: questId,
    questId,
    title: `Quest ${questId}`,
    journey: { currentPhaseId: "work" },
    completed: false,
    updatedAt: 1,
    groupChangedAt: 1,
    ...overrides,
  } as unknown as LeaderThreadTabsProjectionTab;
}

const TAKODE = node("takode", "DevBox takode");
const MSI = node("msi", "Daily Leader");
const LEADERS: LeaderThreadsInput[] = [
  {
    node: TAKODE,
    tabs: [
      tab("q-1", { groupChangedAt: 10 }),
      tab("q-2", { completed: true, groupChangedAt: 50 }),
      tab("q-4", { groupChangedAt: 20 }),
    ],
    runningQuestIds: ["q-4"],
    threads: [
      // Just started: the leader is answering in it.
      {
        id: "aa",
        key: "topic:aa",
        name: "Phone can't reach Takode",
        leaderId: "takode",
        createdAt: 90,
        activityAt: 90,
      },
      {
        id: "bb",
        key: "topic:bb",
        name: "Old question",
        leaderId: "takode",
        createdAt: 5,
        activityAt: 5,
        settledAt: 6,
      },
    ],
    writingThreadKey: "topic:aa",
    // When the user last dealt with each thread; q-2 never (the leader filed and finished it).
    userInteractionAt: { "q-1": 10, "q-4": 70, main: 40 },
  },
  {
    node: MSI,
    tabs: [tab("q-3", { completed: true, groupChangedAt: 30 })],
    runningQuestIds: [],
    threads: [],
    userInteractionAt: { "q-3": 60 },
  },
];

describe("threadRows", () => {
  it("lists every leader's threads by when the user last dealt with them, questions on top", () => {
    queue.items = [
      // A worker's question about q-1 counts in q-1.
      { kind: "needs-input", key: "n", sessionId: "worker", entry: { questId: "q-1" }, threadKey: "q-1" },
      { kind: "unread", key: "u", sessionId: "msi", threadKey: "q-3" },
      // Main's answer waits in the leader log.
      { kind: "unread", key: "m", sessionId: "takode", threadKey: "main" },
    ];
    const rows = threadRows(LEADERS, queue.items as never);
    expect(rows.map((row) => [row.threadKey, row.group])).toEqual([
      // A question for the user stays on top, though the user dealt with q-1 longest ago.
      ["q-1", "needs-input"],
      // Then by the user's last dealing: the thread they just started, from its start...
      ["topic:aa", "in-progress"],
      ["q-4", "in-progress"],
      // ...an unread result where it was (unread doesn't move a row; its dot and count say so)...
      ["q-3", "new-results"],
      // ...the leader log at the user's last message in Main...
      ["all", "new-results"],
      ["topic:bb", "idle"],
      // ...and last a thread the user never dealt with.
      ["q-2", "idle"],
    ]);
    const counts = Object.fromEntries(rows.map((row) => [row.threadKey, row.counts]));
    expect(counts["q-1"]).toEqual({ permission: 1, unread: 0, running: 0 });
    expect(counts["q-4"]).toEqual({ permission: 0, unread: 0, running: 1 });
    // The thread the leader is answering in shows as running.
    expect(counts["topic:aa"]).toEqual({ permission: 0, unread: 0, running: 1 });
    // No phase words: a quest has no label (its dot says where it stands); a thread says so.
    expect(rows.find((row) => row.threadKey === "q-4")!.label).toBeUndefined();
    expect(rows.find((row) => row.threadKey === "topic:aa")!.label).toBe("Thread");
  });
});

describe("useThreadsModeData", () => {
  it("leaves cancelled quests out, as each leader's status row and Home do", () => {
    useStore.getState().applySyncedProjectionSnapshot({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "takode",
      generation: "threads-view",
      revision: 1,
      value: createLeaderThreadTabsProjectionValue({
        tabs: [createLeaderThreadTabsProjectionTab("q-7"), createLeaderThreadTabsProjectionTab("q-8")],
      }),
    });
    useStore.getState().upsertQuestTitlePreview({ questId: "q-7", title: "Dropped", version: 2, cancelled: true });
    const { result } = renderHook(() => useThreadsModeData([TAKODE], false));
    expect(result.current.leaders[0]!.tabs.map((item) => item.threadKey)).toEqual(["q-8"]);
    useStore.getState().reset();
  });
});

describe("useThreadsModeData title previews", () => {
  it("loads the title previews it lacks for every leader's quest threads while shown", () => {
    // Other leaders' threads have no view of theirs loading them: their cancelled marks and a
    // reopened quest's round title come from these previews.
    const original = useStore.getState().hydrateQuestTitles;
    const hydrate = vi.fn(async () => {});
    useStore.setState({ hydrateQuestTitles: hydrate });
    useStore.getState().applySyncedProjectionSnapshot({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "takode",
      generation: "threads-view-previews",
      revision: 1,
      value: createLeaderThreadTabsProjectionValue({
        tabs: [createLeaderThreadTabsProjectionTab("q-7"), createLeaderThreadTabsProjectionTab("q-8")],
      }),
    });
    useStore.getState().upsertQuestTitlePreview({ questId: "q-7", title: "Loaded", version: 1 });
    renderHook(() => useThreadsModeData([TAKODE], true));
    expect(hydrate).toHaveBeenCalledWith(["q-8"]);
    useStore.getState().reset();
    useStore.setState({ hydrateQuestTitles: original });
  });
});

describe("threadRows across leaders", () => {
  it("lists a quest in two leaders' tabs once, under the leader whose board holds it", () => {
    const rows = threadRows(
      [
        { node: TAKODE, tabs: [tab("q-7", { ownership: "other-leader" })], runningQuestIds: [], threads: [] },
        { node: MSI, tabs: [tab("q-7", { ownership: "own" })], runningQuestIds: [], threads: [] },
      ],
      [],
    );
    expect(rows.map((row) => [row.threadKey, row.leader.leader.id])).toEqual([["q-7", "msi"]]);
  });
});

describe("SidebarThreadsMode", () => {
  it("lists the threads with their title, news line and counts, then the leaders and other sessions", async () => {
    queue.items = [{ kind: "needs-input", key: "n", sessionId: "takode", entry: { questId: "q-1" }, threadKey: "q-1" }];
    const onOpened = vi.fn();
    render(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={onOpened}
        otherSessions={() => <div data-testid="other-sessions" />}
      />,
    );
    const rows = within(screen.getByTestId("threads-mode-threads")).getAllByTestId("threads-mode-row");
    expect(rows[0]!.dataset.threadKey).toBe("q-1");
    // Jiayi (Oct 31): the most informative recent update on the second line, and no topic or phase
    // label (the dot's color says where it stands). Jiayi (Nov 1): no quest number before the title,
    // so the title gets the room; hovering the row still shows the number with the whole title.
    expect(within(rows[0]!).queryByTestId("threads-mode-quest")).toBeNull();
    expect(rows[0]!.getAttribute("title")).toBe("q-1 Quest q-1");
    expect(await within(rows[0]!).findByText("Waiting on your pick of the layout")).toBeTruthy();
    expect(homeLines).toHaveBeenCalledWith("takode", expect.arrayContaining(["q-1"]));
    expect(rows[0]!.textContent).not.toContain("Work");
    expect(within(rows[0]!).queryByTestId("threads-mode-topic")).toBeNull();
    expect(within(rows[0]!).getByTestId("status-count-permission").textContent).toBe("1");
    // A quest's dot has its status group's color, never its phase's (Jiayi, Oct 31).
    expect(within(rows[0]!).getByTestId("threads-mode-row-dot").className).toContain("bg-cc-attention");
    fireEvent.click(rows[0]!);
    expect(navigateToSessionThread).toHaveBeenCalledWith("takode", "q-1", false, "takode", {
      preserveMainThreadRoute: true,
    });
    expect(onOpened).toHaveBeenCalled();
    expect(screen.getAllByTestId("threads-mode-leader").map((row) => row.textContent)).toEqual([
      expect.stringContaining("DevBox takode"),
      expect.stringContaining("Daily Leader"),
    ]);
    expect(screen.getByTestId("other-sessions")).toBeTruthy();
  });

  // Jiayi (Nov 1): a reopened quest's generic title says less than its newest round, so its row
  // shows the round first and the quest (number and title) second, which gives way first.
  it("names a reopened quest by its newest round, then the quest", () => {
    useStore
      .getState()
      .upsertQuestTitlePreview({ questId: "q-4", title: "Quest q-4", version: 3, roundTitle: "Side column limit" });
    render(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={() => {}}
        otherSessions={() => null}
      />,
    );
    const row = screen.getAllByTestId("threads-mode-row").find((candidate) => candidate.dataset.threadKey === "q-4")!;
    expect(within(row).getByTestId("quest-round-title").textContent).toBe("Side column limit");
    expect(within(row).getByTestId("quest-round-title-quest").textContent).toBe("q-4 Quest q-4");
    expect(row.getAttribute("title")).toBe("q-4 Quest q-4: Side column limit");
    // A quest never reopened keeps its own title alone.
    const plain = screen.getAllByTestId("threads-mode-row").find((candidate) => candidate.dataset.threadKey === "q-1")!;
    expect(within(plain).queryByTestId("quest-round-title")).toBeNull();
    useStore.getState().reset();
  });

  it("shows the newest Idle threads, the rest behind N older", () => {
    const many: LeaderThreadsInput = {
      node: TAKODE,
      tabs: Array.from({ length: 35 }, (_, index) =>
        tab(`q-${index + 10}`, { completed: true, groupChangedAt: index }),
      ),
      runningQuestIds: [],
      threads: [],
    };
    render(
      <SidebarThreadsMode
        data={{ leaders: [many], others: [] }}
        currentSessionId={null}
        onOpened={() => {}}
        otherSessions={() => null}
      />,
    );
    expect(screen.getAllByTestId("threads-mode-row")).toHaveLength(30);
    expect(screen.getAllByTestId("threads-mode-row")[0]!.dataset.threadKey).toBe("q-44");
    fireEvent.click(screen.getByTestId("threads-mode-more"));
    expect(screen.getAllByTestId("threads-mode-row")).toHaveLength(35);
  });

  it("gives thread rows Takode's own menu on right-click, with the thread's actions", () => {
    // Jiayi (Nov 1): right-clicking a row showed the browser's menu. A thread row now has its
    // actions: open it (also in the side column), its quest and worker, read state, remind, link.
    useStore.setState({
      sessionBoards: new Map([["takode", [{ questId: "q-4", worker: "w-4", workerNum: 44 } as never]]]),
    });
    const onOpened = vi.fn();
    render(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={onOpened}
        otherSessions={() => null}
      />,
    );
    const row = screen.getAllByTestId("threads-mode-row").find((item) => item.dataset.threadKey === "q-4")!;
    const event = fireEvent.contextMenu(row, { clientX: 20, clientY: 30 });
    expect(event).toBe(false); // the browser's own menu is prevented
    for (const label of ["Open", "Open quest", "Open worker #44", "Remind me later", "Copy link"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(navigateToSessionThread).toHaveBeenCalledWith("takode", "q-4");
    expect(onOpened).toHaveBeenCalled();
    useStore.setState({ sessionBoards: new Map() });
  });

  it("gives leader rows the session cards' menu, with rename in the row", () => {
    // The same session menu as the leader's card in the Spaces and Recent views (archive, rename...).
    const onContextMenu = vi.fn();
    const sessionRowProps = {
      onContextMenu,
      editingSessionId: null,
      editingName: "",
      setEditingName: vi.fn(),
      onConfirmRename: vi.fn(),
      onCancelRename: vi.fn(),
    } as never;
    const view = render(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={() => {}}
        otherSessions={() => null}
        sessionRowProps={sessionRowProps}
      />,
    );
    fireEvent.contextMenu(screen.getAllByTestId("threads-mode-leader")[1]!, { clientX: 5, clientY: 6 });
    expect(onContextMenu).toHaveBeenCalledWith(expect.objectContaining({ clientX: 5, clientY: 6 }), "msi");
    view.rerender(
      <SidebarThreadsMode
        data={{ leaders: LEADERS, others: [] }}
        currentSessionId={null}
        onOpened={() => {}}
        otherSessions={() => null}
        sessionRowProps={{ ...(sessionRowProps as object), editingSessionId: "msi", editingName: "Daily" } as never}
      />,
    );
    expect((screen.getByTestId("threads-mode-leader-rename") as HTMLInputElement).value).toBe("Daily");
  });

  it("opens a leader's Home from New, its message box ready for a new thread, and closes the panel", () => {
    // Jiayi (Nov 1): New with a leader landed on the leader's last thread (a bare leader address
    // restores it), not on a new thread. It now names Home outright and asks Home's message box,
    // which starts a new thread, to take focus once it appears.
    const onOpened = vi.fn();
    render(<ThreadsModeNewButton leaders={[TAKODE]} spaces={[]} onCreateSession={() => {}} onOpened={onOpened} />);
    fireEvent.click(screen.getByRole("button", { name: "New thread or session" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /DevBox takode/ }));
    expect(navigateToSessionThread).toHaveBeenCalledWith("takode", "main", false, "takode", {
      preserveMainThreadRoute: true,
    });
    expect(useStore.getState().focusComposerPending).toBe("takode#side:home");
    expect(onOpened).toHaveBeenCalled();
    useStore.setState({ focusComposerPending: null });
  });
});
