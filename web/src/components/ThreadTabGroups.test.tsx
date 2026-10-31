// @vitest-environment jsdom
/**
 * A leader's status row and Home lists: how threads (quest threads and the leader's other threads
 * alike) are filed into groups, the row's group tabs and their lists, and Home's sections.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ThreadSummary } from "../../shared/library-topics.js";
import type { SessionNotification } from "../types.js";
import { ThreadGroupBar, ThreadGroupSections, groupThreads, plainThreadChip, readOnScreen } from "./ThreadTabGroups.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
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
  it("files threads by question, unread result, finished state", () => {
    // A question outranks an unread result, and a finished thread with an unread result stays
    // under New results until it is read.
    const groups = groupThreads(TABS);
    const keys = (id: keyof typeof groups) => groups[id].map((item) => item.threadKey);
    expect(keys("needs-input")).toEqual(["q-11"]);
    expect(keys("new-results")).toEqual(["q-12"]);
    expect(keys("in-progress")).toEqual(["q-10"]);
    expect(keys("done")).toEqual(["q-13", "q-14", "q-15"]);
  });

  it("lists the thread that entered a group most recently first, keeping order for ties", () => {
    // q-21 was read a moment ago (moving it from New results into Done), so it leads Done.
    const done = groupThreads([
      tab("q-22", { completed: true, groupChangedAt: 100 }),
      tab("q-23", { completed: true, groupChangedAt: 100 }),
      tab("q-20", { completed: true, groupChangedAt: 50 }),
      tab("q-21", { completed: true, groupChangedAt: 900 }),
    ]).done;
    expect(done.map((item) => item.threadKey)).toEqual(["q-21", "q-22", "q-23", "q-20"]);
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

  it("files a leader's other thread by its open question or unread answer, and as done once settled", () => {
    // Threads are members of the groups like quest threads: what waits on the user decides.
    expect(plainThreadChip(thread, [note("needs-input")]).needsInput).toBe(true);
    expect(plainThreadChip(thread, [note("review")]).blueNudge).toBe(true);
    expect(plainThreadChip(thread, [note("review", true)]).blueNudge).toBe(false);
    expect(plainThreadChip(thread, []).completed).toBe(false);
    expect(plainThreadChip({ ...thread, settledAt: 9 }, []).completed).toBe(true);
    // A settled thread with a new answer is still a new result.
    expect(plainThreadChip({ ...thread, settledAt: 9 }, [note("review")]).completed).toBe(false);
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
    // No question waits, so Needs you is hidden rather than showing 0.
    expect(chips.map((chip) => [chip.dataset.group, chip.dataset.count])).toEqual([
      ["in-progress", "1"],
      ["new-results", "1"],
      ["done", "3"],
    ]);
    expect(chips.map((chip) => chip.dataset.selected)).toEqual(["true", "false", "false"]);
  });

  it("opens a larger group's list without switching, and switches from the list", () => {
    const { onSelect } = renderBar();
    fireEvent.click(groupTab("done"));
    expect(onSelect).not.toHaveBeenCalled();
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

  it("opens the list on a first click and its first thread on a second mouse click", () => {
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    fireEvent.pointerDown(groupTab("done"), { pointerType: "mouse" });
    fireEvent.click(groupTab("done"));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.pointerDown(groupTab("done"), { pointerType: "mouse" });
    fireEvent.click(groupTab("done"));
    expect(onSelect).toHaveBeenCalledWith("q-13");
    expect(screen.queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("closes the list on a second finger tap instead of switching", () => {
    const { onSelect } = renderBar({ currentThreadKey: "q-14" });
    fingerTap(groupTab("done"));
    expect(screen.getByTestId("thread-tab-group-list")).toBeTruthy();
    fingerTap(groupTab("done"));
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
      fireEvent.click(groupTab("done"));
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
    fireEvent.click(groupTab("done"));
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
    fireEvent.contextMenu(groupTab("done"), { clientX: 10, clientY: 10 });
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
    renderBar({ activeOutputThreadKey: "q-11" });
    expect(spinning()).toEqual(["needs-input"]);
    cleanup();
    renderBar({ activeOutputThreadKey: "q-11", currentThreadKey: "q-11" });
    expect(spinning()).toEqual([]);
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
    expect(played).toEqual(["done"]);
    rerender(<ThreadGroupBar {...props(finished, "q-10")} />);
    expect(played).toEqual(["done"]);
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

describe("ThreadGroupSections", () => {
  it("lists the groups as Home's sections, Done's newest few with the rest behind N older", () => {
    const onSelect = vi.fn();
    render(
      <ThreadGroupSections
        threads={TABS}
        context={{ currentThreadKey: "main", activeOutputThreadKey: null, onSelect }}
        doneLimit={2}
      />,
    );
    const sections = screen.getAllByTestId("thread-group-section");
    expect(sections.map((section) => section.dataset.group)).toEqual([
      "needs-input",
      "in-progress",
      "new-results",
      "done",
    ]);
    const done = sections[3]!;
    expect(within(done).getAllByTestId("thread-tab-list-row")).toHaveLength(2);
    fireEvent.click(within(done).getByTestId("thread-group-more"));
    expect(within(done).getAllByTestId("thread-tab-list-row")).toHaveLength(3);
    fireEvent.click(within(sections[0]!).getByTestId("thread-tab-list-row-select"));
    expect(onSelect).toHaveBeenCalledWith("q-11");
  });
});
