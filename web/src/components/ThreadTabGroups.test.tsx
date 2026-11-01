// @vitest-environment jsdom
/**
 * A leader's status row and Home lists: how threads (quest threads and the leader's other threads
 * alike) are filed into groups, the row's group tabs and their lists, and Home's sections.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ThreadSummary } from "../../shared/library-topics.js";
import type { SessionNotification } from "../types.js";
import { ThreadGroupBar, groupThreads, plainThreadChip, readOnScreen } from "./ThreadTabGroups.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { GLIDE_MS } from "./thread-tab-group-move.js";

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

const HOME = tab("main", { questId: undefined, title: "Home", blueNudge: true });
const TABS = [
  tab("q-10", { title: "Fix the relay proxy" }),
  tab("q-11", { needsInput: true, stateLabel: "User Checkpoint" }),
  tab("q-12", { completed: true, blueNudge: true }),
  tab("q-13", { completed: true }),
  tab("q-14", { completed: true }),
  tab("q-15", { completed: true, mutedNeedsInput: true }),
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderBar(props: Partial<Parameters<typeof ThreadGroupBar>[0]> = {}) {
  const onSelect = vi.fn();
  const bar = (next: typeof props) => (
    <ThreadGroupBar
      home={HOME}
      threads={TABS}
      currentThreadKey="q-10"
      activeOutputThreadKey={null}
      onSelect={onSelect}
      {...next}
    />
  );
  const view = render(bar(props));
  return { onSelect, rerender: (next: typeof props) => view.rerender(bar(next)) };
}

const groupTab = (group: string) =>
  screen.getAllByTestId("thread-tab-group-chip").find((chip) => chip.dataset.group === group)!;

describe("groupThreads", () => {
  it("files threads by what needs the user, and separately by whether work goes on in them", () => {
    // Jiayi (Oct 31): two questions, so the groups may overlap. Needs you and Unread hold what
    // needs the user (a question outranks an unread result); In progress and Idle split every
    // thread by whether work goes on and never overlap each other, so In progress always shows
    // everything running. q-11 (a question, still running) is under Needs you and In progress;
    // q-12 (finished, unread) under Unread and Idle.
    const groups = groupThreads(TABS);
    const keys = (id: keyof typeof groups) => groups[id].map((item) => item.threadKey);
    expect(keys("needs-input")).toEqual(["q-11"]);
    expect(keys("new-results")).toEqual(["q-12"]);
    expect(keys("in-progress")).toEqual(["q-10", "q-11"]);
    expect(keys("idle")).toEqual(["q-12", "q-13", "q-14", "q-15"]);
  });

  it("keeps an unread running quest under Unread and In progress, and never in both In progress and Idle", () => {
    // The report: 3 of 6 Unread rows were quests in Work, missing from In progress.
    const threads = [
      tab("q-40", { running: true, blueNudge: true }),
      tab("q-41", { running: true, needsInput: true, blueNudge: true }),
      tab("q-42", { running: false }),
    ];
    const groups = groupThreads(threads);
    const keys = (id: keyof typeof groups) => groups[id].map((item) => item.threadKey);
    expect(keys("needs-input")).toEqual(["q-41"]);
    expect(keys("new-results")).toEqual(["q-40"]);
    expect(keys("in-progress")).toEqual(["q-40", "q-41"]);
    expect(keys("idle")).toEqual(["q-42"]);
    // Counts are memberships, so they can add up to more than the threads.
    expect(Object.values(groups).flat()).toHaveLength(5);
  });

  it("lists the leader log and other sessions' questions under their attention group only", () => {
    // They are not threads with work of their own, so they are never In progress or Idle.
    const groups = groupThreads([
      tab("all", { questId: undefined, blueNudge: true, attentionOnly: true }),
      tab("q-43", { needsInput: true, attentionOnly: true }),
    ]);
    expect(groups["new-results"].map((item) => item.threadKey)).toEqual(["all"]);
    expect(groups["needs-input"].map((item) => item.threadKey)).toEqual(["q-43"]);
    expect([...groups["in-progress"], ...groups.idle]).toEqual([]);
  });

  it("puts only threads with work going on under In progress; idle ones go to Idle", () => {
    // Jiayi: idle threads listed under In progress weren't making progress. A thread is In progress
    // only while its quest runs or the leader writes in it (`running`), finished or not.
    const groups = groupThreads([
      tab("q-30", { running: true }),
      tab("q-31", { running: false }),
      tab("topic:aa", { questId: undefined, running: false }),
      tab("topic:bb", { questId: undefined, running: true }),
    ]);
    expect(groups["in-progress"].map((item) => item.threadKey)).toEqual(["q-30", "topic:bb"]);
    expect(groups.idle.map((item) => item.threadKey)).toEqual(["q-31", "topic:aa"]);
  });

  it("lists the thread that entered a group most recently first, keeping order for ties", () => {
    // q-21 was read a moment ago (moving it from Unread into Idle), so it leads Idle.
    const idle = groupThreads([
      tab("q-22", { completed: true, groupChangedAt: 100 }),
      tab("q-23", { completed: true, groupChangedAt: 100 }),
      tab("q-20", { completed: true, groupChangedAt: 50 }),
      tab("q-21", { completed: true, groupChangedAt: 900 }),
    ]).idle;
    expect(idle.map((item) => item.threadKey)).toEqual(["q-21", "q-22", "q-23", "q-20"]);
  });
});

describe("readOnScreen", () => {
  // The browser marks a result in the open thread read before the server confirms it, so the row
  // must not file the thread on screen under New results in the meantime.
  it("clears the unread result of the thread on screen only", () => {
    const unread = tab("q-34", { blueNudge: true });
    expect(readOnScreen(unread, "q-34").blueNudge).toBe(false);
    expect(readOnScreen(unread, "q-35").blueNudge).toBe(true);
  });
});

describe("plainThreadChip", () => {
  const thread: ThreadSummary = {
    id: "0a1b2c3d",
    key: "topic:0a1b2c3d",
    name: "Phone can't reach Takode",
    leaderId: "leader",
    createdAt: 1,
    activityAt: 5,
  };
  const note = (category: "needs-input" | "review", done = false) =>
    ({ id: `n-${category}`, category, summary: "", timestamp: 1, threadKey: thread.key, done }) as SessionNotification;

  it("files a leader's other thread by its open question or unread answer, and as running only while written in", () => {
    // Threads are members of the groups like quest threads: what waits on the user decides.
    expect(plainThreadChip(thread, [note("needs-input")]).needsInput).toBe(true);
    expect(plainThreadChip(thread, [note("review")]).blueNudge).toBe(true);
    expect(plainThreadChip(thread, [note("review", true)]).blueNudge).toBe(false);
    expect(plainThreadChip(thread, []).completed).toBe(false);
    expect(plainThreadChip({ ...thread, settledAt: 9 }, []).completed).toBe(true);
    // A settled thread with a new answer is still a new result.
    expect(plainThreadChip({ ...thread, settledAt: 9 }, [note("review")]).completed).toBe(false);
    expect(plainThreadChip(thread, []).running).toBe(false);
    expect(plainThreadChip(thread, [], true).running).toBe(true);
  });

  it("names its topic as a tag in the list's meta line", () => {
    expect(plainThreadChip(thread, []).stateLabel).toBe("Thread");
    expect(plainThreadChip({ ...thread, topic: { id: "t", name: "Remote access" } }, []).stateLabel).toBe(
      "Thread · Remote access",
    );
  });
});

describe("ThreadGroupBar", () => {
  it("shows Home and one tab per non-empty group, marking the group of the thread on screen", () => {
    renderBar({ threads: TABS.filter((item) => !item.needsInput) });
    // The strip names the thread on screen, so the row repeats no title.
    expect(screen.queryByText("Fix the relay proxy")).toBeNull();
    expect(screen.getByTestId("thread-group-home").dataset.selected).toBe("false");
    const chips = screen.getAllByTestId("thread-tab-group-chip");
    // No question waits, so Needs you is hidden rather than showing 0. The urgent groups sit on the
    // right, nearest the thumb and the bell (Jiayi, Nov 1).
    expect(chips.map((chip) => [chip.dataset.group, chip.dataset.count])).toEqual([
      ["idle", "4"],
      ["in-progress", "1"],
      ["new-results", "1"],
    ]);
    expect(chips.map((chip) => chip.dataset.selected)).toEqual(["false", "true", "false"]);
  });

  it("colors every thread's status mark by its group alone, never by its phase", () => {
    // Jiayi (Oct 31): status colors are the four groups' only. A quest in Memory (a purple phase)
    // or a finished one marks its row with its group's color; the In progress tab shows that
    // group's green rather than its threads' phase colors.
    renderBar({
      threads: [
        tab("q-20", { accentColor: "#8b5cf6", stateLabel: "Memory", running: true }),
        tab("q-21", { completed: true, accentColor: "#8b5cf6" }),
        tab("q-22", { needsInput: true, accentColor: "#8b5cf6" }),
      ],
    });
    const dot = within(groupTab("in-progress")).getByTestId("thread-tab-group-dot");
    expect(dot.className).toContain("bg-cc-success");
    expect(dot.getAttribute("style")).toBeNull();
    fireEvent.contextMenu(groupTab("idle"), { clientX: 10, clientY: 10 });
    const mark = within(screen.getByTestId("thread-tab-list-row")).getByTestId("thread-tab-list-row-status");
    expect(mark.dataset.group).toBe("idle");
    expect(mark.className).toContain("bg-cc-muted/60");
    expect(mark.getAttribute("style")).toBeNull();
  });

  it("marks a thread that needs the user with its amber or blue dot in In progress too", () => {
    // In the activity groups a thread keeps the colour of what it needs from the user.
    renderBar({ threads: [tab("q-50", { running: true, blueNudge: true }), tab("q-51", { running: true })] });
    fireEvent.contextMenu(groupTab("in-progress"), { clientX: 10, clientY: 10 });
    const marks = within(screen.getByTestId("thread-tab-group-list"))
      .getAllByTestId("thread-tab-list-row-status")
      .map((mark) => mark.dataset.group);
    expect(marks).toEqual(["new-results", "in-progress"]);
  });

  it("opens a larger group's list without switching, and switches from the list", () => {
    const { onSelect } = renderBar();
    fireEvent.click(groupTab("idle"));
    expect(onSelect).not.toHaveBeenCalled();
    const list = screen.getByTestId("thread-tab-group-list");
    expect(
      within(list)
        .getAllByTestId("thread-tab-list-row")
        .map((row) => row.dataset.threadKey),
    ).toEqual(["q-12", "q-13", "q-14", "q-15"]);
    fireEvent.click(within(list).getAllByTestId("thread-tab-list-row-select")[2]!);
    expect(onSelect).toHaveBeenLastCalledWith("q-14");
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("switches straight to the thread of a group of one, keeping its list a right-click away", () => {
    const { onSelect } = renderBar();
    fireEvent.click(groupTab("needs-input"));
    expect(onSelect).toHaveBeenCalledWith("q-11");
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
    // Right-click (or a long-press on the phone) still shows the list.
    fireEvent.contextMenu(groupTab("needs-input"), { clientX: 10, clientY: 10 });
    expect(screen.getByTestId("thread-tab-group-list").textContent).toContain("q-11 · User Checkpoint");
  });

  it("opens a question another session asks through the member's own opener", () => {
    // A worker's question about one of the leader's quests is a Needs you member: it opens the
    // question (in the asking session), not a thread of the leader.
    const onOpen = vi.fn();
    const { onSelect } = renderBar({
      threads: [...TABS.filter((item) => !item.needsInput), tab("q-9", { needsInput: true, onOpen })],
    });
    fireEvent.click(groupTab("needs-input"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes an open list on a second click or tap, opening nothing", () => {
    // Jiayi (Nov 1): a second mouse click used to open the group's first thread and mark it read,
    // where they meant to close the list. Now mouse and finger alike close it; the Next button
    // cycles through what needs attention.
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    fireEvent.pointerDown(groupTab("idle"), { pointerType: "mouse" });
    fireEvent.click(groupTab("idle"));
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fireEvent.pointerDown(groupTab("idle"), { pointerType: "mouse" });
    fireEvent.click(groupTab("idle"));
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
    fingerTap(groupTab("idle"));
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fingerTap(groupTab("idle"));
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps an open list above the phone keyboard", () => {
    // iOS lays the keyboard over the page without resizing it; the list ends above the visual viewport.
    const listeners = new Map<string, () => void>();
    const viewport = {
      height: 900,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("visualViewport", viewport);
    try {
      renderBar();
      fireEvent.click(groupTab("idle"));
      const list = screen.getByTestId("thread-tab-group-list");
      expect(list.style.maxHeight).toBe("min(60dvh, 892px)");
      viewport.height = 500;
      act(() => listeners.get("resize")!());
      expect(list.style.maxHeight).toBe("min(60dvh, 492px)");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("marks side quests with the branch icon in group lists", () => {
    renderBar({ threads: TABS.map((item) => (item.threadKey === "q-13" ? { ...item, sideQuestOf: "main" } : item)) });
    fireEvent.click(groupTab("idle"));
    const rows = within(screen.getByTestId("thread-tab-group-list")).getAllByTestId("thread-tab-list-row");
    expect(
      rows.filter((row) => within(row).queryByTestId("side-quest-icon")).map((row) => row.dataset.threadKey),
    ).toEqual(["q-13"]);
  });

  it("names a plain thread by its title, without its key", () => {
    // `topic:<handle>` means nothing to the user; the meta line says it is a thread and its topic.
    renderBar({
      threads: [
        tab("topic:0a1b2c3d", {
          questId: undefined,
          title: "Tailscale",
          stateLabel: "Thread · Remote",
          completed: true,
        }),
      ],
      currentThreadKey: "main",
    });
    fireEvent.contextMenu(groupTab("idle"), { clientX: 10, clientY: 10 });
    const meta = screen.getByTestId("thread-tab-list-row-meta").textContent ?? "";
    expect(meta).toContain("Thread · Remote");
    expect(meta).not.toContain("topic:");
  });

  it("goes Home in one tap, selected there and in the leader log, with Home's bell", () => {
    const { onSelect } = renderBar({ currentThreadKey: "main" });
    const home = screen.getByTestId("thread-group-home");
    expect(home.dataset.selected).toBe("true");
    expect(within(home).getByTestId("thread-tab-bell").dataset.kind).toBe("review");
    fireEvent.click(home);
    expect(onSelect).toHaveBeenCalledWith("main");
    cleanup();
    renderBar({ currentThreadKey: "all" });
    expect(screen.getByTestId("thread-group-home").dataset.selected).toBe("true");
  });

  it("spins the group whose thread the leader is writing in, unless that thread is on screen", () => {
    const spinning = () =>
      within(screen.getByTestId("thread-group-bar"))
        .getAllByRole("tab")
        .filter((item) => item.dataset.activeOutput === "true")
        .map((item) => item.dataset.group ?? "home");
    // Writing is work going on: q-11 is under Needs you and In progress, and In progress spins.
    renderBar({ activeOutputThreadKey: "q-11" });
    expect(spinning()).toEqual(["in-progress"]);
    cleanup();
    renderBar({ activeOutputThreadKey: "q-11", currentThreadKey: "q-11" });
    expect(spinning()).toEqual([]);
  });
});

describe("ThreadGroupBar width", () => {
  // Jiayi: with the side column open, the row ran past the main view into the column. The row sizes
  // itself by its own width (a container query), not the screen's: a narrow bar shares its width
  // with counts only, and only a wide one labels its tabs and anchors a list under its tab.
  it("labels and anchors lists only when the bar itself is wide", () => {
    const width = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(500);
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockReturnValue(300);
    renderBar();
    expect(screen.getByTestId("thread-group-bar").className).toContain("@container");
    fireEvent.click(groupTab("idle"));
    expect(screen.getByTestId("thread-tab-group-list").style.width).toBe("");
    cleanup();
    width.mockReturnValue(1000);
    renderBar();
    fireEvent.click(groupTab("idle"));
    expect(screen.getByTestId("thread-tab-group-list").style.left).toBe("300px");
  });
});

describe("ThreadGroupBar group move animation", () => {
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

  const props = (threads: PrimaryThreadChip[], currentThreadKey: string) => ({
    home: HOME,
    threads,
    currentThreadKey,
    activeOutputThreadKey: null,
    onSelect: vi.fn(),
  });
  const working = [tab("q-10"), tab("q-13", { completed: true })];
  const finished = [tab("q-10", { completed: true }), tab("q-13", { completed: true })];

  it("plays once when the thread on screen moves to another group", () => {
    const played = trackAnimations();
    const { rerender } = render(<ThreadGroupBar {...props(working, "q-10")} />);
    rerender(<ThreadGroupBar {...props(finished, "q-10")} />);
    expect(played).toEqual(["idle"]);
    rerender(<ThreadGroupBar {...props(finished, "q-10")} />);
    expect(played).toEqual(["idle"]);
  });

  it("floats the tab from its old group to its new one, keeping both groups until it lands", () => {
    // Jiayi (Nov 1): the new group used to be the thing that moved, so it vanished from its place
    // as the glide began, and an emptied old group vanished at once. Now both stay put while a
    // floating copy of the selected tab glides between them; then the new group is selected and
    // the emptied old group goes.
    vi.useFakeTimers();
    try {
      trackAnimations();
      const working = [tab("q-10"), tab("q-13", { completed: true })];
      const finished = [tab("q-10", { completed: true }), tab("q-13", { completed: true })];
      const { rerender } = render(<ThreadGroupBar {...props(working, "q-10")} />);
      rerender(<ThreadGroupBar {...props(finished, "q-10")} />);
      const chips = () =>
        screen.getAllByTestId("thread-tab-group-chip").map((chip) => [chip.dataset.group, chip.dataset.selected]);
      // q-10 left In progress, its only member: the group stays while the tab is in flight.
      expect(chips()).toEqual([
        ["idle", "false"],
        ["in-progress", "false"],
      ]);
      expect(screen.getByTestId("thread-tab-group-glide").dataset.group).toBe("idle");

      act(() => vi.advanceTimersByTime(GLIDE_MS + 100));
      expect(chips()).toEqual([["idle", "true"]]);
      expect(screen.queryByTestId("thread-tab-group-glide")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stays still while the thread on screen sits in two groups", () => {
    // A thread with a question that is still running is under Needs you and In progress; the bar
    // selects Needs you for it, and re-renders must not read that as a move.
    const played = trackAnimations();
    const asking = [tab("q-10", { needsInput: true }), tab("q-13", { completed: true })];
    const { rerender } = render(<ThreadGroupBar {...props(asking, "q-10")} />);
    rerender(<ThreadGroupBar {...props(asking, "q-10")} />);
    rerender(<ThreadGroupBar {...props(asking, "q-10")} />);
    expect(played).toEqual([]);
  });

  it("stays still when the user opens a thread that stays in its group, or prefers reduced motion", () => {
    const played = trackAnimations();
    const { rerender } = render(<ThreadGroupBar {...props(working, "q-10")} />);
    rerender(<ThreadGroupBar {...props(working, "q-13")} />);
    expect(played).toEqual([]);
    cleanup();
    const still = trackAnimations(true);
    const reduced = render(<ThreadGroupBar {...props(working, "q-10")} />);
    reduced.rerender(<ThreadGroupBar {...props(finished, "q-10")} />);
    expect(still).toEqual([]);
  });
});
