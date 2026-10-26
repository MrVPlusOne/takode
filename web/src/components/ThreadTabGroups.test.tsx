// @vitest-environment jsdom
/**
 * Phone thread tab groups: how tabs are filed into groups, the chips and their lists, and the
 * rail choosing groups on phones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const navigateToNotification = vi.hoisted(() => vi.fn());
vi.mock("../utils/notification-navigation.js", () => ({ navigateToNotification }));
import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";
import { ThreadTabGroupBar, groupThreadTabs, threadKeyToSelectAfterClosing } from "./ThreadTabGroups.js";
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

  it("lists topics by activity in a Topics group after Main, selected while a topic is on screen", () => {
    // A leader with topics on gets a Topics group right after Main. It lists every topic, most
    // recent activity first; choosing one opens it and closes the list. While a topic conversation
    // is on screen the Topics group is the selected one (not the quest's status group) and that
    // topic is marked. Done lists finished quests only.
    const onOpen = vi.fn();
    const topic = (id: string, name: string, activityAt: number) =>
      ({ id, name, activityAt, questIds: ["q-13"], latestUpdate: `${name} moved.` }) as never;
    const { rerender } = renderBar({
      currentThreadKey: "q-13",
      topicsGroup: { topics: [topic("t1", "Relay", 2), topic("t2", "Briefing", 1)], currentTopicId: null, onOpen },
    });
    const bar = screen.getByTestId("thread-tab-group-bar");
    const items = within(bar).getAllByRole("tab");
    expect(items[1]?.getAttribute("data-group")).toBe("topics");
    expect(items[1]?.getAttribute("data-selected")).toBe("false");
    fireEvent.click(items[1]!);
    const rows = screen.getAllByTestId("topic-tab-row");
    expect(rows.map((row) => row.dataset.topic)).toEqual(["t1", "t2"]);
    fireEvent.click(within(rows[1]!).getByRole("menuitem"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }));
    expect(screen.queryByTestId("topic-tab-list")).toBeNull();

    rerender({
      currentThreadKey: "q-13",
      topicsGroup: { topics: [topic("t1", "Relay", 2), topic("t2", "Briefing", 1)], currentTopicId: "t2", onOpen },
    });
    const topicsItem = within(screen.getByTestId("thread-tab-group-bar")).getAllByRole("tab")[1]!;
    expect(topicsItem?.getAttribute("data-selected")).toBe("true");
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    expect(done?.getAttribute("data-selected")).toBe("false");
    fireEvent.click(topicsItem);
    expect(within(screen.getAllByTestId("topic-tab-row")[1]!).getByRole("menuitem").getAttribute("aria-current")).toBe(
      "true",
    );

    fireEvent.click(screen.getByTestId("thread-tab-group-backdrop"));
    fireEvent.click(done);
    expect(screen.queryByTestId("done-topic-list")).toBeNull();
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
      topicsGroup: { topics: [topic("asked", ["q-13"]), topic("quiet", ["q-14"])], currentTopicId: null, onOpen },
    });
    fireEvent.click(within(screen.getByTestId("thread-tab-group-bar")).getAllByRole("tab")[1]!);
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
  it("marks the group whose tab the leader is writing in", () => {
    renderBar({ activeOutputThreadKey: "q-11" });
    const chips = screen.getAllByTestId("thread-tab-group-chip");
    const withDot = chips.filter((chip) => within(chip).queryByTestId("thread-tab-active-output-spinner"));
    expect(withDot.map((chip) => chip.dataset.group)).toEqual(["needs-input"]);
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
