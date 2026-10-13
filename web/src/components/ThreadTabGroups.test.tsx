// @vitest-environment jsdom
/**
 * Phone thread tab groups: how tabs are filed into groups, the chips and their lists,
 * the switcher sheet's search and closing, and the rail choosing groups on phones.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThreadTabGroupBar, groupThreadTabs, threadKeyToSelectAfterClosing } from "./ThreadTabGroups.js";
import { ThreadTabRail, type PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

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
  render(
    <ThreadTabGroupBar
      main={MAIN}
      tabs={TABS}
      currentThreadKey="q-10"
      activeOutputThreadKey={null}
      onSelect={onSelect}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSelect, onClose };
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
  it("shows Main, one item per non-empty group and search, marking the current tab's group", () => {
    renderBar({ tabs: TABS.filter((item) => !item.needsInput) });
    // The quest strip names the current quest, so the bar repeats no title: it only
    // marks the group that holds it (q-10 is in progress).
    expect(screen.queryByText("Fix the relay proxy")).toBeNull();
    expect(screen.getByTestId("thread-tab-group-main").dataset.selected).toBe("false");
    expect(screen.getByTestId("thread-tab-group-search")).toBeTruthy();
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

  it("keeps Main out of the groups, with its bell on its own tab and in Find", () => {
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
    // Find still reaches Main's prompt: Main stays pinned first, bell included.
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    const firstRow = within(screen.getByTestId("thread-tab-switcher")).getAllByTestId("thread-tab-list-row")[0]!;
    expect(firstRow.dataset.threadKey).toBe("main");
    expect(within(firstRow).getByTestId("thread-tab-bell").dataset.kind).toBe("needs-input");
  });

  it("opens a larger group's first tab and its list in one tap", () => {
    // Done lists q-13, q-14, q-15; a tap switches to q-13 at once and leaves the list open
    // to pick another, consistent with a group of one switching on tap.
    const { onSelect } = renderBar();
    const done = () => screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done());
    expect(onSelect).toHaveBeenCalledWith("q-13");
    expect(screen.getByTestId("thread-tab-group-list").dataset.group).toBe("done");
  });

  it("only toggles the list when the tab on screen is already in that group", () => {
    // On q-14, a Done tab, tapping Done must not move the user to the group's first tab.
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    const done = screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === "done")!;
    fireEvent.click(done);
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fireEvent.click(done);
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

  it("finds tabs by quest number in the switcher and closes them", () => {
    const { onClose } = renderBar();
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    const sheet = screen.getByTestId("thread-tab-switcher");
    expect(sheet.textContent).toContain("7 tabs");
    fireEvent.change(within(sheet).getByTestId("thread-tab-switcher-search"), { target: { value: "q-13" } });
    const rows = within(sheet).getAllByTestId("thread-tab-list-row");
    expect(rows.map((row) => row.dataset.threadKey)).toEqual(["q-13"]);
    fireEvent.click(within(rows[0]!).getByTestId("thread-tab-list-row-close"));
    expect(onClose).toHaveBeenCalledWith("q-13");
  });

  it("asks once before closing every finished tab that can close", () => {
    const { onClose } = renderBar();
    fireEvent.click(screen.getByTestId("thread-tab-group-search"));
    const closeAll = screen.getByTestId("thread-tab-switcher-close-all");
    fireEvent.click(closeAll);
    expect(onClose).not.toHaveBeenCalled();
    expect(closeAll.textContent).toBe("Close 2 tabs?");
    fireEvent.click(closeAll);
    // q-12 is finished but unread, and q-15 cannot close, so neither is closed.
    expect(onClose.mock.calls.map(([key]) => key)).toEqual(["q-13", "q-14"]);
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
