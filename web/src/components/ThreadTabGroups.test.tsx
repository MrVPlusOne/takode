// @vitest-environment jsdom
/**
 * Phone thread tab groups: how tabs are filed into groups, the chips and their lists, and the
 * rail choosing groups on phones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const navigateToNotification = vi.hoisted(() => vi.fn());
vi.mock("../utils/notification-navigation.js", () => ({ navigateToNotification }));
import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";
import type { ThreadSummary } from "../../shared/library-topics.js";
import {
  ThreadTabGroupBar,
  countUnreadResults,
  groupThreadTabs,
  threadKeyToSelectAfterClosing,
  topicFirstTabOrder,
} from "./ThreadTabGroups.js";
import { ThreadTabRail, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";

function tab(threadKey: string, overrides: Partial<PrimaryThreadChip> = {}): PrimaryThreadChip {
  return {
    threadKey,
    questId: threadKey,
    title: `Quest ${threadKey}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
    ...overrides,
  };
}

const MAIN = tab("main", { questId: undefined, title: "Main Thread", blueNudge: true });
const TABS = [
  tab("q-10", { title: "Fix the relay proxy" }),
  tab("q-11", { needsInput: true, stateLabel: "User Checkpoint" }),
  tab("q-12", { completed: true, blueNudge: true, canClose: true }),
  tab("q-13", { completed: true, canClose: true }),
  tab("q-14", { completed: true, canClose: true }),
  tab("q-15", { completed: true, mutedNeedsInput: true }),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBar(props: Partial<Parameters<typeof ThreadTabGroupBar>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const bar = (next: typeof props) => (
    <ThreadTabGroupBar
      main={MAIN}
      tabs={TABS}
      currentThreadKey="q-10"
      activeOutputThreadKey={null}
      onSelect={onSelect}
      onClose={onClose}
      {...next}
    />
  );
  const view = render(bar(props));
  return { onSelect, onClose, rerender: (next: typeof props) => view.rerender(bar(next)) };
}

describe("groupThreadTabs", () => {
  it("files tabs by prompt, unread result, finished state, keeping tab order", () => {
    // A prompt outranks an unread result, and a finished tab with an unread result stays
    // under New results until it is read.
    const groups = groupThreadTabs(TABS);
    const keys = (id: keyof typeof groups) => groups[id].map((item) => item.threadKey);
    expect(keys("needs-input")).toEqual(["q-11"]);
    expect(keys("new-results")).toEqual(["q-12"]);
    expect(keys("in-progress")).toEqual(["q-10"]);
    expect(keys("done")).toEqual(["q-13", "q-14", "q-15"]);
  });
});

describe("groupThreadTabs order", () => {
  it("lists the tab that entered a group most recently first, keeping tab order for ties", () => {
    // q-21 was read a moment ago (moving it from New results into Done), so it leads Done
    // although it is last in the leader's tab order; q-22 and q-23 tie and keep their order.
    const done = groupThreadTabs([
      tab("q-22", { completed: true, groupChangedAt: 100 }),
      tab("q-23", { completed: true, groupChangedAt: 100 }),
      tab("q-20", { completed: true, groupChangedAt: 50 }),
      tab("q-21", { completed: true, groupChangedAt: 900 }),
    ]).done;
    expect(done.map((item) => item.threadKey)).toEqual(["q-21", "q-22", "q-23", "q-20"]);
  });
});

describe("threadKeyToSelectAfterClosing", () => {
  // Done lists newest first: q-31 (entered at 300), q-30 (200), q-33 (100). The leader's
  // tab order puts the in-progress q-32 between them, which must never be picked from Done.
  const tabs = [
    tab("q-30", { completed: true, canClose: true, groupChangedAt: 200 }),
    tab("q-32"),
    tab("q-33", { completed: true, canClose: true, groupChangedAt: 100 }),
    tab("q-31", { completed: true, canClose: true, groupChangedAt: 300 }),
  ];

  it("opens the next tab below in the closed tab's group, by the group's order", () => {
    expect(threadKeyToSelectAfterClosing("q-31", tabs, "q-31")).toBe("q-30");
    expect(threadKeyToSelectAfterClosing("q-30", tabs, "q-30")).toBe("q-33");
  });

  it("opens the tab above when the closed tab was last, and Main when the group empties", () => {
    expect(threadKeyToSelectAfterClosing("q-33", tabs, "q-33")).toBe("q-30");
    expect(threadKeyToSelectAfterClosing("q-30", [tab("q-30", { completed: true }), tab("q-32")], "q-30")).toBe("main");
  });

  it("follows the topic-first bar's order with topics on: Working on, then Topics", () => {
    // Working on lists q-40 (newest change first); Topics lists Relay (q-41, q-42) before Voice
    // (q-43), then the quest under no topic (q-44). Closing opens the next tab in that order,
    // the one before when it was last, and Main when none is left.
    const topicTabs = [
      tab("q-41", { completed: true, canClose: true, groupChangedAt: 300 }),
      tab("q-43", { completed: true, canClose: true, groupChangedAt: 900 }),
      tab("q-40", { groupChangedAt: 100 }),
      tab("q-44", { completed: true, canClose: true, groupChangedAt: 50 }),
      tab("q-42", { completed: true, canClose: true, groupChangedAt: 200 }),
    ];
    const topics = [
      { id: "relay", questIds: ["q-41", "q-42"] },
      { id: "voice", questIds: ["q-43"] },
    ] as never[];
    const order = topicFirstTabOrder(topicTabs, topics, { "q-41": "relay", "q-42": "relay", "q-43": "voice" }, "main");
    expect(order).toEqual(["q-40", "q-41", "q-42", "q-43", "q-44"]);
    expect(threadKeyToSelectAfterClosing("q-41", topicTabs, "q-41", order)).toBe("q-42");
    expect(threadKeyToSelectAfterClosing("q-44", topicTabs, "q-44", order)).toBe("q-43");
    expect(threadKeyToSelectAfterClosing("q-44", [tab("q-44")], "q-44", ["q-44"])).toBe("main");
  });

  it("files the tab on screen the way the bar shows it", () => {
    // q-34 has an unread result, but it is on screen, so the bar shows it under Done.
    const withResult = [...tabs, tab("q-34", { completed: true, blueNudge: true, groupChangedAt: 400 })];
    expect(threadKeyToSelectAfterClosing("q-34", withResult, "q-34")).toBe("q-31");
  });
});

describe("ThreadTabGroupBar", () => {
  it("shows Main and one item per non-empty group, marking the current tab's group", () => {
    renderBar({ tabs: TABS.filter((item) => !item.needsInput) });
    // The quest strip names the current quest, so the bar repeats no title: it only
    // marks the group that holds it (q-10 is in progress).
    expect(screen.queryByText("Fix the relay proxy")).toBeNull();
    expect(screen.getByTestId("thread-tab-group-main").dataset.selected).toBe("false");
    // Finding a tab or a message is Search everything's job; the bar has no Find.
    expect(screen.queryByTestId("thread-tab-group-search")).toBeNull();
    const chips = screen.getAllByTestId("thread-tab-group-chip");
    // No prompt is waiting, so the Needs you chip is hidden rather than showing 0. The
    // groups read left to right as stages of the work: ongoing, then unread results, then done.
    expect(chips.map((chip) => [chip.dataset.group, chip.dataset.count])).toEqual([
      ["in-progress", "1"],
      ["new-results", "1"],
      ["done", "3"],
    ]);
    expect(chips.map((chip) => chip.dataset.selected)).toEqual(["true", "false", "false"]);
  });

  it("opens a group's list and switches tabs from it", () => {
    const { onSelect } = renderBar();
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done);
    const list = screen.getByTestId("thread-tab-group-list");
    expect(
      within(list)
        .getAllByTestId("thread-tab-list-row")
        .map((row) => row.dataset.threadKey),
    ).toEqual(["q-13", "q-14", "q-15"]);
    fireEvent.click(within(list).getAllByTestId("thread-tab-list-row-select")[1]!);
    expect(onSelect).toHaveBeenLastCalledWith("q-14");
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("keeps Main out of the groups, with its bell on its own tab", () => {
    // Main has a prompt and the only quest prompt is answered, so no Needs you group shows:
    // counting Main there too duplicated it, and tapping that group from Main did nothing.
    renderBar({
      main: tab("main", { questId: undefined, title: "Main Thread", needsInput: true }),
      tabs: TABS.filter((item) => !item.needsInput),
      currentThreadKey: "main",
    });
    expect(screen.getAllByTestId("thread-tab-group-chip").map((chip) => chip.dataset.group)).not.toContain(
      "needs-input",
    );
    expect(within(screen.getByTestId("thread-tab-group-main")).getByTestId("thread-tab-bell").dataset.kind).toBe(
      "needs-input",
    );
  });

  it("opens a larger group's list without switching tabs", () => {
    // Done lists q-13, q-14, q-15. A tap only opens the list; the tab on screen stays put
    // (the feed's Next chip steps through items needing attention). Retired: switching to
    // the group's first tab on the same tap.
    const { onSelect } = renderBar();
    const done = () => screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done());
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("thread-tab-group-list").dataset.group).toBe("done");
  });

  it("treats New results like every other group: its list opens and nothing switches", () => {
    // Retired: a New results tap that opened the newest unread with no list, and the desktop
    // list arrow that existed only because that tap no longer opened the list.
    const unread = [
      tab("q-20", { completed: true, blueNudge: true, groupChangedAt: 100 }),
      tab("q-21", { completed: true, blueNudge: true, groupChangedAt: 300 }),
      tab("q-22", { blueNudge: true, groupChangedAt: 200 }),
    ];
    const { onSelect } = renderBar({ tabs: [...TABS.filter((item) => !item.blueNudge), ...unread] });
    const results = screen
      .getAllByTestId("thread-tab-group-chip")
      .find((chip) => chip.dataset.group === "new-results")!;
    expect(results.getAttribute("aria-haspopup")).toBe("menu");
    expect(screen.queryByTestId("thread-tab-group-list-toggle")).toBeNull();
    fireEvent.click(results);
    expect(onSelect).not.toHaveBeenCalled();
    expect(
      within(screen.getByTestId("thread-tab-group-list"))
        .getAllByTestId("thread-tab-list-row")
        .map((row) => row.dataset.threadKey),
    ).toEqual(["q-21", "q-22", "q-20"]);
  });

  it("opens the list on a first click and the list's first tab on a second mouse click", () => {
    // On q-14, a Done tab, the first click on Done only opens its list: it must not move
    // the user. Clicking Done again with a mouse saves the trip down to the first row.
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.pointerDown(done, { pointerType: "mouse" });
    fireEvent.click(done);
    const list = screen.getByTestId("thread-tab-group-list");
    expect(onSelect).not.toHaveBeenCalled();
    const firstKey = list.querySelector<HTMLElement>("[data-thread-key]")!.dataset.threadKey;
    fireEvent.pointerDown(done, { pointerType: "mouse" });
    fireEvent.click(done);
    expect(onSelect).toHaveBeenCalledWith(firstKey);
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("closes the list on a second finger tap instead of switching tabs", () => {
    // On a phone a second tap on the same spot undoes the first, as everywhere else.
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fingerTap(done);
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fingerTap(done);
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("switches straight to the tab of a group of one, keeping its list a right-click away", () => {
    // Needs you holds only q-11: a tap opens it without a one-row list to tap again.
    const { onSelect } = renderBar();
    const needs = () =>
      screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "needs-input")!;
    fireEvent.click(needs());
    expect(onSelect).toHaveBeenCalledWith("q-11");
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();

    // Right-click (or a long-press on the phone) still shows the list, with the tab's
    // phase even though it needs input, and its row menu and latest result.
    fireEvent.contextMenu(needs(), { clientX: 10, clientY: 10 });
    const list = screen.getByTestId("thread-tab-group-list");
    expect(list.textContent).toContain("q-11 · User Checkpoint");
    fireEvent.click(within(list).getByTestId("thread-tab-list-row-select"));
    expect(onSelect).toHaveBeenLastCalledWith("q-11");
  });

  it("closes a tab from its group's list", () => {
    const { onClose } = renderBar();
    fireEvent.click(screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!);
    const row = within(screen.getByTestId("thread-tab-group-list"))
      .getAllByTestId("thread-tab-list-row")
      .find((item) => item.dataset.threadKey === "q-13")!;
    fireEvent.click(within(row).getByTestId("thread-tab-list-row-close"));
    expect(onClose).toHaveBeenCalledWith("q-13");
  });

  it("asks once before closing every finished tab that can close, from the Done list", () => {
    // "Close all" moved from Find to the Done group's list, where the finished tabs are.
    const { onClose } = renderBar();
    fireEvent.click(screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!);
    const closeAll = within(screen.getByTestId("thread-tab-group-list")).getByTestId("thread-tab-close-all");
    fireEvent.click(closeAll);
    expect(onClose).not.toHaveBeenCalled();
    expect(closeAll.textContent).toBe("Close 2 tabs?");
    fireEvent.click(closeAll);
    // q-12 is finished but unread, and q-15 cannot close, so neither is closed.
    expect(onClose.mock.calls.map(([key]) => key)).toEqual(["q-13", "q-14"]);
  });

  it("is topic-first with topics on: Main, Working on and Topics, and no status groups", () => {
    // Jiayi's pick (B): with topics as the home, the In progress, Needs you, New results and Done
    // groups go away. Working on lists the unfinished quests for quick switching; Topics holds
    // every quest tab, and is the selected tab on a topic conversation and on a quest that isn't
    // in Working on.
    const onOpen = vi.fn();
    const topic = (id: string, name: string, activityAt: number, questIds: string[]) =>
      ({ id, name, activityAt, questIds, latestUpdate: `${name} moved.` }) as never;
    const topics = [topic("t1", "Relay", 2, ["q-10", "q-12"]), topic("t2", "Briefing", 1, ["q-13", "q-14"])];
    const topicOfQuest = { "q-10": "t1", "q-12": "t1", "q-13": "t2", "q-14": "t2" };
    const { rerender, onSelect } = renderBar({
      currentThreadKey: "q-10",
      topicsGroup: { topics, currentTopicId: null, onOpen, topicOfQuest },
    });
    const groups = () =>
      within(screen.getByTestId("thread-tab-group-bar"))
        .getAllByRole("tab")
        .map((item) => item.dataset.group ?? "main");
    expect(groups()).toEqual(["main", "working-on", "topics"]);
    expect(screen.queryAllByTestId("thread-tab-group-chip")).toEqual([]);

    // Working on: the unfinished quests (q-10 in progress, q-11 waiting on a question), selected on one.
    const workingOn = screen.getByTestId("thread-tab-group-working-on");
    expect(workingOn.dataset.selected).toBe("true");
    expect(workingOn.dataset.count).toBe("2");
    fireEvent.click(workingOn);
    const rows = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
    expect(rows.map((row) => row.dataset.threadKey).sort()).toEqual(["q-10", "q-11"]);
    fireEvent.click(
      within(rows.find((row) => row.dataset.threadKey === "q-11")!).getByTestId("thread-tab-list-row-select"),
    );
    expect(onSelect).toHaveBeenCalledWith("q-11");

    // Topics: each topic says what its quests are doing; quests under no topic are listed below.
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    const [relay, briefing] = screen.getAllByTestId("topic-tab-row");
    expect(within(relay!).getByTestId("topic-tab-status").textContent).toContain("1 in progress");
    expect(within(relay!).getByTestId("topic-tab-status").textContent).toContain("1 new");
    expect(within(briefing!).queryByTestId("topic-tab-status")).toBeNull();
    const unsorted = screen.getByTestId("topic-tab-unsorted");
    expect(
      within(unsorted)
        .getAllByTestId("thread-tab-list-row")
        .map((row) => row.dataset.threadKey)
        .sort(),
    ).toEqual(["q-11", "q-15"]);
    fireEvent.click(within(briefing!).getByRole("menuitem"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));

    // A finished quest's tab, and a topic conversation, select Topics.
    rerender({ currentThreadKey: "q-13", topicsGroup: { topics, currentTopicId: null, onOpen, topicOfQuest } });
    expect(screen.getByTestId("thread-tab-group-topics").dataset.selected).toBe("true");
    rerender({ currentThreadKey: "q-10", topicsGroup: { topics, currentTopicId: "t1", onOpen, topicOfQuest } });
    expect(screen.getByTestId("thread-tab-group-topics").dataset.selected).toBe("true");
    expect(screen.getByTestId("thread-tab-group-working-on").dataset.selected).toBe("false");
  });

  it("searches the Topics list from its heading, and Escape or clearing brings every topic back", () => {
    // Jiayi asked for a small search box after "Topics 10": names match first, then the newest
    // update; the quests under no topic narrow by title too. Escape clears a query without
    // closing the list, and closes it once nothing is typed.
    const topic = (id: string, name: string, activityAt: number, questIds: string[], latestUpdate: string) =>
      ({ id, name, activityAt, questIds, latestUpdate }) as never;
    const topics = [
      topic("t1", "Formal verification", 3, ["q-10"], "Lean evals use the relay."),
      topic("t2", "Relay", 2, ["q-12"], "Proxy fixed."),
      topic("t3", "Briefing", 1, ["q-13", "q-14"], "Nothing new."),
    ];
    const topicOfQuest = { "q-10": "t1", "q-12": "t2", "q-13": "t3", "q-14": "t3" };
    renderBar({ topicsGroup: { topics, currentTopicId: null, onOpen: vi.fn(), topicOfQuest } });
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    const listed = () => screen.queryAllByTestId("topic-tab-row").map((row) => row.dataset.topic);
    const unsorted = () => screen.queryAllByTestId("thread-tab-list-row").map((row) => row.dataset.threadKey);
    expect(listed()).toEqual(["t1", "t2", "t3"]);
    const box = screen.getByRole("textbox", { name: "Search topics" });
    expect(screen.getByTestId("topic-search").dataset.wide).toBe("false");
    fireEvent.focus(box);
    expect(screen.getByTestId("topic-search").dataset.wide).toBe("true");

    fireEvent.change(box, { target: { value: "relay" } });
    expect(listed()).toEqual(["t2", "t1"]);
    expect(unsorted()).toEqual([]);
    fireEvent.change(box, { target: { value: "q-11" } });
    expect(listed()).toEqual([]);
    expect(unsorted()).toEqual(["q-11"]);
    fireEvent.change(box, { target: { value: "nowhere" } });
    expect(screen.getByTestId("topic-search-empty").textContent).toContain('"nowhere"');

    fireEvent.keyDown(box, { key: "Escape" });
    expect(listed()).toEqual(["t1", "t2", "t3"]);
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fireEvent.change(box, { target: { value: "brief" } });
    fireEvent.click(screen.getByTestId("topic-search-clear"));
    expect(listed()).toEqual(["t1", "t2", "t3"]);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("keeps an open list above the phone keyboard", () => {
    // iOS lays the keyboard over the page without resizing it, so a list sized to 60% of the
    // screen ran under the keyboard while searching. The list ends above the visual viewport.
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 900,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("visualViewport", viewport);
    try {
      const topics = [{ id: "t1", name: "Relay", activityAt: 1, questIds: ["q-10"] }] as never[];
      renderBar({ topicsGroup: { topics, currentTopicId: null, onOpen: vi.fn(), topicOfQuest: { "q-10": "t1" } } });
      fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
      const list = screen.getByTestId("thread-tab-group-list");
      // jsdom places the list at the top (0), less the 8px gap kept above the keyboard.
      expect(list.style.maxHeight).toBe("min(60dvh, 892px)");
      viewport.height = 500;
      act(() => listeners.get("resize")!());
      expect(list.style.maxHeight).toBe("min(60dvh, 492px)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a topic's open questions in the Topics group, and opens one from there", () => {
    // "Waiting on you" on a topic means only an open question in one of its quests: the user's
    // needs-input notifications, as the question list shows them. The badge opens the newest one
    // where it was asked and closes the list; the row itself still opens the topic.
    const question = {
      id: "n1",
      category: "needs-input" as const,
      summary: "Keep strict grading?",
      timestamp: 5,
      messageId: "m1",
      threadKey: "q-13",
      done: false,
    };
    useStore.setState({
      sdkSessions: [{ sessionId: "leader", name: "Leader", sessionNum: 7 } as SdkSessionInfo],
      sessionNotifications: new Map([["leader", [question]]]),
    });
    const topic = (id: string, questIds: string[]) =>
      ({ id, name: id, activityAt: 1, questIds, latestUpdate: "Moved." }) as never;
    const onOpen = vi.fn();
    renderBar({
      currentThreadKey: "main",
      topicsGroup: {
        topics: [topic("asked", ["q-13"]), topic("quiet", ["q-14"])],
        currentTopicId: null,
        onOpen,
        topicOfQuest: {},
      },
    });
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    const [asked, quiet] = screen.getAllByTestId("topic-tab-row");
    expect(within(quiet!).queryByTestId("topic-questions-badge")).toBeNull();
    const badge = within(asked!).getByTestId("topic-questions-badge");
    expect(badge.textContent).toBe("1 question for you");
    fireEvent.click(badge);
    expect(navigateToNotification).toHaveBeenCalledWith("leader", question, expect.any(Array));
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByTestId("topic-tab-list")).toBeNull();
    useStore.getState().reset();
  });

  it("offers Close all only in the Done list", () => {
    renderBar();
    fireEvent.click(screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!);
    expect(screen.getByTestId("thread-tab-close-all")).toBeTruthy();
    fireEvent.click(screen.getByTestId("thread-tab-group-backdrop"));
    fireEvent.click(
      screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "in-progress")!,
    );
    expect(screen.queryByTestId("thread-tab-close-all")).toBeNull();
  });

  it("marks side quests with the branch icon in group lists, naming where their answer goes", () => {
    // q-13 is a side quest of Main: its answer is given there, so its tab can be skipped.
    renderBar({
      tabs: TABS.map((item) => (item.threadKey === "q-13" ? { ...item, sideQuestOf: "main" } : item)),
    });
    fireEvent.click(screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!);
    const rows = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
    const marked = rows.filter((row) => within(row).queryByTestId("side-quest-icon"));
    expect(marked.map((row) => row.dataset.threadKey)).toEqual(["q-13"]);
    expect(within(marked[0]!).getByRole("img", { name: "Side quest of Main" })).toBeTruthy();
    // The rows keep their order: side quests are marked, not moved.
    expect(rows.map((row) => row.dataset.threadKey)).toEqual(["q-13", "q-14", "q-15"]);
  });

  it("switches to Main in one tap and marks it as current there", () => {
    const { onSelect } = renderBar({ currentThreadKey: "main" });
    const main = screen.getByTestId("thread-tab-group-main");
    expect(main.dataset.selected).toBe("true");
    fireEvent.click(main);
    expect(onSelect).toHaveBeenCalledWith("main");
  });
});

describe("Topics and Working on, and the marks in their lists", () => {
  // One open question used to ring up to four amber bells in the top bar (Oct 28, round 6). Jiayi
  // chose to let the Next chip and the attention count carry questions and unread results: the
  // Topics and Working on items show none, and their lists mark each topic and quest instead.
  // The topic rows count unread results as the attention list does (round 5).
  const topic = (id: string, name: string, questIds: string[]) =>
    ({ id, name, activityAt: 1, questIds, latestUpdate: `${name} moved.` }) as never;
  const topics = [topic("t1", "Relay", ["q-10"]), topic("t2", "Briefing", ["q-13"])];
  const topicOfQuest = { "q-10": "t1", "q-13": "t2" };
  const tabs = [tab("q-10"), tab("q-13", { completed: true }), tab("q-20", { completed: true })];
  function renderTopics(unread: Record<string, { answers: number; finished: number }>, tabOverrides = tabs) {
    renderBar({
      tabs: tabOverrides,
      currentThreadKey: "main",
      topicsGroup: {
        topics,
        currentTopicId: null,
        onOpen: vi.fn(),
        topicOfQuest,
        unreadOf: (threadKeys) => unread[threadKeys.find((key) => unread[key]) ?? ""] ?? { answers: 0, finished: 0 },
      },
    });
  }
  const bellOn = (testId: string) => within(screen.getByTestId(testId)).queryByTestId("thread-tab-bell");

  it("counts unread results as the attention list does: finished quests apart, one request once", () => {
    expect(
      countUnreadResults([
        { id: "n-1", answerTo: ["u1"], unreadReason: "answer" },
        { id: "n-2", answerTo: ["u1"], unreadReason: "report" },
        { id: "n-3", unreadReason: "answer" },
        { id: "n-4", unreadReason: "quest-complete" },
      ]),
    ).toEqual({ answers: 2, finished: 1 });
  });

  it("puts no bell on Topics; the topic's row says what is unread, including its own thread", () => {
    renderTopics({ "q-13": { answers: 0, finished: 1 }, "topic:t1": { answers: 2, finished: 0 } });
    expect(bellOn("thread-tab-group-topics")).toBeNull();
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    const row = (id: string) => screen.getAllByTestId("topic-tab-row").find((element) => element.dataset.topic === id)!;
    expect(within(row("t2")).getByTestId("topic-tab-unread").textContent).toBe("1 finished");
    expect(within(row("t1")).getByTestId("topic-tab-unread").textContent).toBe("2 new");
  });

  it("keeps the bell on a quest under no topic in the Topics list, not on Topics", () => {
    renderTopics({}, [...tabs.slice(0, 2), tab("q-20", { completed: true, blueNudge: true })]);
    expect(bellOn("thread-tab-group-topics")).toBeNull();
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    const unsorted = screen.getByTestId("topic-tab-unsorted");
    expect(within(unsorted).getByTestId("thread-tab-bell").dataset.kind).toBe("review");
  });

  it("puts no bell on Working on; the quest's row in its list has it", () => {
    renderTopics({}, [tab("q-10", { needsInput: true }), ...tabs.slice(1)]);
    expect(bellOn("thread-tab-group-working-on")).toBeNull();
    fireEvent.click(screen.getByTestId("thread-tab-group-working-on"));
    const row = within(screen.getByTestId("thread-tab-group-list"))
      .getAllByTestId("thread-tab-list-row")
      .find((element) => element.dataset.threadKey === "q-10")!;
    expect(within(row).getByTestId("thread-tab-bell").dataset.kind).toBe("needs-input");
  });
});

describe("ThreadTabGroupBar in the top bar", () => {
  // Desktop leaders with topics on (Jiayi's pick, design C with her changes): the bar leaves its
  // own tab row. Main | All, Topics and the Next chip sit after the session name; Working on, merged
  // with the Board button, sits before the attention bell, and the full board is behind a button in
  // the Working on menu.
  const topic = (id: string, name: string, questIds: string[]) =>
    ({ id, name, activityAt: 1, questIds, latestUpdate: `${name} moved.` }) as never;
  afterEach(() => {
    for (const helpers of document.querySelectorAll("[data-top-bar-helpers]")) helpers.remove();
  });
  function renderInTopBar(currentThreadKey = "q-10", boardOpen = false) {
    const helpers = document.createElement("div");
    helpers.dataset.topBarHelpers = "";
    document.body.appendChild(helpers);
    const onToggleBoard = vi.fn();
    const view = renderBar({
      currentThreadKey,
      trailing: <span data-testid="next-chip">Next</span>,
      topicsGroup: {
        topics: [topic("t1", "Relay", ["q-10"])],
        currentTopicId: null,
        onOpen: vi.fn(),
        topicOfQuest: { "q-10": "t1" },
      },
      inTopBar: { helpers, board: { open: boardOpen, dots: [], onToggle: onToggleBoard } },
    });
    return { ...view, helpers, onToggleBoard };
  }

  it("puts Main | All, Topics and then Next in place, and Working on in the helpers", () => {
    const { helpers, onSelect } = renderInTopBar();
    const bar = screen.getByTestId("thread-tab-group-bar");
    expect(within(bar).getByTestId("thread-tab-group-main")).toBeTruthy();
    expect(within(bar).getByTestId("thread-tab-group-topics")).toBeTruthy();
    expect(within(bar).queryByTestId("thread-tab-group-working-on")).toBeNull();
    // No folder tabs: nothing in the bar claims to be the tab on screen.
    expect(within(bar).queryAllByRole("tab")).toEqual([]);
    // The Next chip sits right after Topics (Jiayi, round 6), not at the right end.
    const next = within(bar).getByTestId("next-chip");
    expect(
      within(bar).getByTestId("thread-tab-group-topics").compareDocumentPosition(next) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(helpers).queryByTestId("next-chip")).toBeNull();
    const workingOn = within(helpers).getByTestId("thread-tab-group-working-on");
    // The Board button's monitor icon, with the count of unfinished quests (q-10 and q-11).
    expect(within(workingOn).getByTestId("workboard-dots-icon")).toBeTruthy();
    expect(workingOn.textContent).toContain("Working on 2");

    fireEvent.click(screen.getByTestId("thread-tab-group-all"));
    expect(onSelect).toHaveBeenCalledWith("all");
    fireEvent.click(screen.getByTestId("thread-tab-group-main"));
    expect(onSelect).toHaveBeenCalledWith("main");
  });

  it("marks Main or All only while it is on screen", () => {
    renderInTopBar("main");
    expect(screen.getByTestId("thread-tab-group-main").dataset.selected).toBe("true");
    expect(screen.getByTestId("thread-tab-group-all").dataset.selected).toBe("false");
    cleanup();
    renderInTopBar("q-10");
    expect(screen.getByTestId("thread-tab-group-main").dataset.selected).toBe("false");
  });

  it("opens the work board from the Working on menu, and shows it pressed while the board is open", () => {
    const { helpers, onToggleBoard, onSelect } = renderInTopBar();
    fireEvent.click(within(helpers).getByTestId("thread-tab-group-working-on"));
    const list = within(helpers).getByTestId("thread-tab-group-list");
    expect(list.dataset.group).toBe("working-on");
    fireEvent.click(within(list).getAllByTestId("thread-tab-list-row-select")[0]!);
    expect(onSelect).toHaveBeenCalled();

    fireEvent.click(within(helpers).getByTestId("thread-tab-group-working-on"));
    const board = within(helpers).getByTestId("thread-top-bar-board-button");
    expect(board.textContent).toContain("Full board");
    fireEvent.click(board);
    expect(onToggleBoard).toHaveBeenCalledTimes(1);
    expect(within(helpers).queryByTestId("thread-tab-group-list")).toBeNull();

    cleanup();
    const reopened = renderInTopBar("q-10", true);
    const button = within(reopened.helpers).getByTestId("thread-tab-group-working-on");
    expect(button.className).toContain("border-cc-primary");
    fireEvent.click(button);
    expect(within(reopened.helpers).getByTestId("thread-top-bar-board-button").textContent).toContain("Close board");
  });

  it("opens the Topics list from the Topics button", () => {
    renderInTopBar();
    fireEvent.click(screen.getByTestId("thread-tab-group-topics"));
    expect(screen.getByTestId("thread-tab-group-list").dataset.group).toBe("topics");
    expect(screen.getAllByTestId("topic-tab-row")).toHaveLength(1);
  });
});

describe("ThreadTabGroupBar at the bottom of the screen", () => {
  it("opens group lists upward", () => {
    renderBar({ placement: "bottom" });
    expect(screen.getByTestId("thread-tab-group-bar").dataset.placement).toBe("bottom");
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done);
    // Above the bar rather than below it, where there is no room at the screen's bottom edge.
    expect(screen.getByTestId("thread-tab-group-list").className).toContain("bottom-full");
  });
});

describe("ThreadTabGroupBar active output", () => {
  const spinning = () =>
    within(screen.getByTestId("thread-tab-group-bar"))
      .getAllByRole("tab")
      .filter((item) => item.dataset.activeOutput === "true")
      .map((item) => item.dataset.group ?? "main");

  it("marks the group whose tab the leader is writing in, unless that tab is on screen", () => {
    renderBar({ activeOutputThreadKey: "q-11" });
    expect(spinning()).toEqual(["needs-input"]);
    cleanup();
    renderBar({ activeOutputThreadKey: "q-11", currentThreadKey: "q-11" });
    expect(spinning()).toEqual([]);
  });

  it("spins exactly one topic-first tab, and none for writing on screen", () => {
    // Jiayi saw Working on and Topics both spin for the same writing, often the conversation on
    // screen. Now: none for writing on screen (its quest, its topic's conversation, Main, All),
    // Working on for a quest it lists, Topics only for a quest it doesn't, and Main for Main.
    const topics = [{ id: "t", name: "Relay", activityAt: 1, questIds: ["q-10", "q-13"] }] as never[];
    const topicOfQuest = { "q-10": "t", "q-13": "t" };
    const bar = (activeOutputThreadKey: string, currentThreadKey: string, currentTopicId: string | null = null) => {
      cleanup();
      renderBar({
        activeOutputThreadKey,
        currentThreadKey,
        topicsGroup: { topics, currentTopicId, onOpen: vi.fn(), topicOfQuest },
      });
      return spinning();
    };
    expect(bar("q-10", "main")).toEqual(["working-on"]);
    expect(bar("q-13", "main")).toEqual(["topics"]);
    expect(bar("main", "q-10")).toEqual(["main"]);
    expect(bar("q-10", "q-10")).toEqual([]);
    expect(bar("q-13", "q-10", "t")).toEqual([]);
    expect(bar("main", "main")).toEqual([]);
    expect(bar("q-10", "all")).toEqual([]);
    // Inside an open list, the row being written in keeps its own spinner.
    bar("q-10", "q-10");
    fireEvent.click(screen.getByTestId("thread-tab-group-working-on"));
    const row = within(screen.getByTestId("thread-tab-group-list"))
      .getAllByTestId("thread-tab-list-row")
      .find((item) => item.dataset.threadKey === "q-10")!;
    expect(row.dataset.activeOutput).toBe("true");
  });
});

describe("ThreadTabGroupBar group move animation", () => {
  // jsdom has no Web Animations, so the test supplies animate() and records who played.
  function trackAnimations(reducedMotion = false) {
    const played: string[] = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: function (this: HTMLElement) {
        played.push(this.dataset.group ?? this.tagName);
        return { onfinish: null, oncancel: null } as unknown as Animation;
      },
    });
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    return played;
  }
  afterEach(() => {
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  const props = (tabs: PrimaryThreadChip[], currentThreadKey: string) => ({
    main: MAIN,
    tabs,
    currentThreadKey,
    activeOutputThreadKey: null,
    onSelect: vi.fn(),
  });
  const working = [tab("q-10"), tab("q-13", { completed: true })];
  const finished = [tab("q-10", { completed: true }), tab("q-13", { completed: true })];

  it("plays once when the tab on screen moves to another group", () => {
    const played = trackAnimations();
    const { rerender } = render(<ThreadTabGroupBar {...props(working, "q-10")} />);
    expect(played).toEqual([]);
    rerender(<ThreadTabGroupBar {...props(finished, "q-10")} />);
    expect(played).toEqual(["done"]);
    // Later renders without a move do not replay it.
    rerender(<ThreadTabGroupBar {...props(finished, "q-10")} />);
    expect(played).toEqual(["done"]);
  });

  it("glides a tab opened from New results into the group it moves to once read", () => {
    // q-12 has an unread result; opening it reads it, so it leaves New results for Done
    // in the same render that selects it. That is a move the user should see.
    const played = trackAnimations();
    const unread = [tab("q-10"), tab("q-12", { completed: true, blueNudge: true }), tab("q-13", { completed: true })];
    const { rerender } = render(<ThreadTabGroupBar {...props(unread, "q-10")} />);
    rerender(<ThreadTabGroupBar {...props(unread, "q-12")} />);
    expect(played).toEqual(["done"]);
  });

  it("glides slowly and evenly enough to be noticed", () => {
    // The user found a 260 ms glide, most of it spent in the first frames, too quick to see.
    const durations: unknown[] = [];
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      value: (_keyframes: unknown, options: KeyframeAnimationOptions) => {
        durations.push(options.duration);
        return {} as Animation;
      },
    });
    const { rerender } = render(<ThreadTabGroupBar {...props(working, "q-10")} />);
    rerender(<ThreadTabGroupBar {...props(finished, "q-10")} />);
    expect(durations).toEqual([560]);
  });

  it("stays still when the user opens a tab that stays in its group, or prefers reduced motion", () => {
    const played = trackAnimations();
    const { rerender } = render(<ThreadTabGroupBar {...props(working, "q-10")} />);
    // Opening a tab that stays in its group is a selection change, not a move.
    rerender(<ThreadTabGroupBar {...props(working, "q-13")} />);
    expect(played).toEqual([]);
    cleanup();

    const still = trackAnimations(true);
    const reduced = render(<ThreadTabGroupBar {...props(working, "q-10")} />);
    reduced.rerender(<ThreadTabGroupBar {...props(finished, "q-10")} />);
    expect(still).toEqual([]);
  });
});

describe("ThreadTabRail", () => {
  const defaultWidth = window.innerWidth;
  afterEach(() => {
    window.innerWidth = defaultWidth;
  });

  function renderRail(onCloseThreadTab = vi.fn()) {
    render(
      <ThreadTabRail
        mainState={MAIN}
        tabs={TABS}
        sessionId="rail-session"
        currentThreadKey="q-10"
        onSelectThread={vi.fn()}
        onCloseThreadTab={onCloseThreadTab}
      />,
    );
    return onCloseThreadTab;
  }

  it("shows status groups on phones and desktops alike", () => {
    // The per-tab strip is retired: jsdom's default desktop width gets the groups too.
    renderRail();
    expect(screen.getByTestId("thread-tab-group-bar")).toBeTruthy();
    expect(screen.queryByTestId("thread-tab")).toBeNull();
    cleanup();

    window.innerWidth = 430;
    renderRail();
    expect(screen.getByTestId("thread-tab-group-bar")).toBeTruthy();
  });

  it("offers the tab menu on a listed tab and closes it through the rail", () => {
    const onCloseThreadTab = renderRail();
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done);
    const row = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row")[0]!;
    // Right-click stands in for the phone long-press; both open the same menu.
    fireEvent.contextMenu(row, { clientX: 40, clientY: 40 });
    fireEvent.click(screen.getByText("Close tab"));
    expect(onCloseThreadTab).toHaveBeenCalledWith("q-13");
  });

  it("anchors a group's list under its tab on wide screens", () => {
    // Wide screens size tabs to their labels, so a full-width list would float far from
    // the tab that opened it; the list opens at that tab instead.
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(min-width: 768px)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(120);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
    renderRail();
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done);
    const list = screen.getByTestId("thread-tab-group-list");
    expect(list.style.left).toBe("120px");
    expect(list.style.width).toBe("448px");
  });
});

describe("Threads menu", () => {
  // Threads the user started live in their own menu next to Topics, not in Working on (which keeps
  // only quests in motion). Active holds threads with something for the user (not settled, an
  // unread answer, or the leader writing); Recent holds every read thread, newest first.
  const thread = (handle: string, name: string, overrides: Partial<ThreadSummary> = {}): ThreadSummary => ({
    id: handle,
    key: `topic:${handle}`,
    name,
    leaderId: "leader",
    createdAt: 1,
    activityAt: 1,
    ...overrides,
  });
  const threads = [
    thread("aaaa0001", "Not read yet"),
    thread("aaaa0002", "Read, then answered again", { settledAt: 2 }),
    thread("aaaa0003", "Read and unfiled", { settledAt: 2 }),
    thread("aaaa0004", "Read and filed", { settledAt: 2, topic: { id: "t1", name: "Relay" } }),
  ];
  function renderThreads(currentThreadKey = "main") {
    const onStart = vi.fn();
    const view = renderBar({
      tabs: [tab("q-10")],
      currentThreadKey,
      topicsGroup: { topics: [], currentTopicId: null, onOpen: vi.fn(), topicOfQuest: {} },
      threadsMenu: {
        threads,
        starting: false,
        onStart,
        onOpen: vi.fn(),
        unread: (threadKey) => (threadKey === "topic:aaaa0002" ? 1 : 0),
      },
    });
    return { ...view, onStart };
  }

  it("lists active threads, then every read thread, filed under a topic or not", () => {
    // Jiayi: Recent should list all past threads, never cleared; a filed one says where it lives.
    const { onSelect } = renderThreads();
    // Working on still counts only the quest.
    expect(screen.getByTestId("thread-tab-group-working-on").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("thread-tab-group-threads"));
    const menu = screen.getByTestId("threads-menu");
    expect(menu.textContent).toContain("Active 2");
    expect(menu.textContent).toContain("Recent2");
    const rows = screen.getAllByTestId("threads-menu-row");
    expect(rows.map((row) => row.dataset.threadKey)).toEqual([
      "topic:aaaa0001",
      "topic:aaaa0002",
      "topic:aaaa0003",
      "topic:aaaa0004",
    ]);
    expect(rows[1]!.textContent).toContain("1 new");
    expect(rows[3]!.textContent).toContain("in Relay");
    // The search narrows Active as well as Recent; a topic's name finds the threads filed there.
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "answered" } });
    expect(screen.getAllByTestId("threads-menu-row").map((row) => row.dataset.threadKey)).toEqual(["topic:aaaa0002"]);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "relay" } });
    expect(screen.getAllByTestId("threads-menu-row").map((row) => row.dataset.threadKey)).toEqual(["topic:aaaa0004"]);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "" } });
    fireEvent.click(screen.getAllByTestId("threads-menu-row")[2]!);
    expect(onSelect).toHaveBeenCalledWith("topic:aaaa0003");
  });

  it("marks a thread whose first message never arrived and offers to remove it", () => {
    // A failed first send left a thread in Active forever with nothing in it and no way out.
    // A thread just started (its first message still on the way) is not marked.
    const onRemove = vi.fn();
    renderBar({
      tabs: [tab("q-10")],
      currentThreadKey: "main",
      topicsGroup: { topics: [], currentTopicId: null, onOpen: vi.fn(), topicOfQuest: {} },
      threadsMenu: {
        threads: [
          thread("cccc0001", "Never sent", { empty: true, createdAt: Date.now() - 5 * 60_000 }),
          thread("cccc0002", "Just started", { empty: true, createdAt: Date.now() }),
        ],
        starting: false,
        onStart: vi.fn(),
        onOpen: vi.fn(),
        unread: () => 0,
        onRemove,
      },
    });
    fireEvent.click(screen.getByTestId("thread-tab-group-threads"));
    expect(screen.getAllByTestId("threads-menu-row-unsent")).toHaveLength(1);
    expect(screen.getAllByTestId("threads-menu-remove")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("threads-menu-remove"));
    expect(onRemove).toHaveBeenCalledWith("topic:cccc0001");
  });

  it("draws a long Recent list a page at a time, and searches all of it", () => {
    // Read threads are never dropped, so hundreds can gather: rows come 20 at a time (the next
    // page when the end scrolls into view, or on tap), and the search box finds older ones.
    const many = Array.from({ length: 45 }, (_, index) =>
      thread(`bbbb${String(index).padStart(4, "0")}`, `Old thread ${index}`, {
        settledAt: 2,
        activityAt: 100 - index,
      }),
    );
    renderBar({
      tabs: [tab("q-10")],
      currentThreadKey: "main",
      topicsGroup: { topics: [], currentTopicId: null, onOpen: vi.fn(), topicOfQuest: {} },
      threadsMenu: { threads: many, starting: false, onStart: vi.fn(), onOpen: vi.fn(), unread: () => 0 },
    });
    fireEvent.click(screen.getByTestId("thread-tab-group-threads"));
    expect(screen.getByTestId("threads-menu").textContent).toContain("Recent45");
    expect(screen.getAllByTestId("threads-menu-row")).toHaveLength(20);
    expect(screen.getByTestId("threads-menu-more").textContent).toBe("25 more");
    fireEvent.click(screen.getByTestId("threads-menu-more"));
    expect(screen.getAllByTestId("threads-menu-row")).toHaveLength(40);
    fireEvent.change(screen.getByLabelText("Search threads"), { target: { value: "thread 44" } });
    expect(screen.getAllByTestId("threads-menu-row").map((row) => row.textContent)).toEqual([
      expect.stringContaining("Old thread 44"),
    ]);
    expect(screen.queryByTestId("threads-menu-more")).toBeNull();
  });

  it("keeps a thread with an open question active and marks it, and keeps its question out of Working on", () => {
    // A question asked in a thread (the leader wants the user to pick something) used to show as a
    // Working on row named by the question and the raw thread key, while the thread's own row said
    // nothing.
    renderBar({
      tabs: [tab("q-10"), { ...tab("topic:aaaa0003"), title: "Pick a name", needsInput: true }],
      currentThreadKey: "main",
      topicsGroup: { topics: [], currentTopicId: null, onOpen: vi.fn(), topicOfQuest: {} },
      threadsMenu: {
        threads,
        starting: false,
        onStart: vi.fn(),
        onOpen: vi.fn(),
        unread: () => 0,
        questions: (threadKey) => (threadKey === "topic:aaaa0003" ? 1 : 0),
      },
    });
    expect(screen.getByTestId("thread-tab-group-working-on").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("thread-tab-group-threads"));
    const rows = screen.getAllByTestId("threads-menu-row");
    const asked = rows.find((row) => row.dataset.threadKey === "topic:aaaa0003")!;
    expect(screen.getByTestId("threads-menu").textContent).toContain("Active 2");
    expect(asked.textContent).toContain("question");
  });

  it("selects Threads while a thread is on screen, and New thread closes the list as it starts one", () => {
    const { onStart } = renderThreads("topic:aaaa0003");
    expect(screen.getByTestId("thread-tab-group-threads").dataset.selected).toBe("true");
    expect(screen.getByTestId("thread-tab-group-main").dataset.selected).toBe("false");
    fireEvent.click(screen.getByTestId("thread-tab-group-threads"));
    fireEvent.click(screen.getByTestId("threads-menu-new"));
    expect(onStart).toHaveBeenCalled();
    expect(screen.queryByTestId("threads-menu")).toBeNull();
  });
});
