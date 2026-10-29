// @vitest-environment jsdom
/**
 * A topic-first leader's navigation by breadcrumb (phones and desktop alike): the place picker at
 * the start of the strip (Main, All threads, then the topics and the quests under no topic), and
 * the Working on picker of quests in motion in the top bar, which also opens the full board.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const navigateToNotification = vi.hoisted(() => vi.fn());
vi.mock("../../utils/notification-navigation.js", () => ({ navigateToNotification }));
import { useStore } from "../../store.js";
import type { SdkSessionInfo } from "../../types.js";
import type { ThreadSummary } from "../../../shared/library-topics.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { LeaderBreadcrumbNav, type LeaderBreadcrumbNavProps } from "./LeaderBreadcrumbNav.js";

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
];
const topic = (id: string, name: string, questIds: string[], latestUpdate = `${name} moved.`) =>
  ({ id, name, activityAt: questIds.length, questIds, latestUpdate }) as never;
const TOPICS = [topic("t1", "Relay", ["q-10", "q-12"]), topic("t2", "Briefing", ["q-13"])];
const TOPIC_OF_QUEST = { "q-10": "t1", "q-12": "t1", "q-13": "t2" };

afterEach(() => {
  cleanup();
  for (const place of document.querySelectorAll("[data-test-place]")) place.remove();
  vi.restoreAllMocks();
  useStore.getState().reset();
});

function renderNav(overrides: Partial<LeaderBreadcrumbNavProps> = {}) {
  const place = (name: string) => {
    const element = document.createElement("div");
    element.dataset.testPlace = name;
    document.body.appendChild(element);
    return element;
  };
  const helpers = place("helpers");
  const crumbSlot = place("crumb");
  const onSelect = vi.fn();
  const onOpenTopic = vi.fn();
  const onToggleBoard = vi.fn();
  const props = (next: Partial<LeaderBreadcrumbNavProps>): LeaderBreadcrumbNavProps => ({
    main: MAIN,
    tabs: TABS,
    currentThreadKey: "q-10",
    activeOutputThreadKey: null,
    onSelect,
    topics: { list: TOPICS, currentTopicId: null, topicOfQuest: TOPIC_OF_QUEST, onOpen: onOpenTopic },
    threads: [],
    helpers,
    crumbSlot,
    board: { open: false, dots: [], onToggle: onToggleBoard },
    ...next,
  });
  const view = render(<LeaderBreadcrumbNav {...props(overrides)} />);
  return {
    helpers,
    crumbSlot,
    onSelect,
    onOpenTopic,
    onToggleBoard,
    rerender: (next: Partial<LeaderBreadcrumbNavProps>) => view.rerender(<LeaderBreadcrumbNav {...props(next)} />),
  };
}

const openPlaces = () => fireEvent.click(screen.getByTestId("place-crumb-button"));
const openWorkingOn = () => fireEvent.click(screen.getByTestId("thread-tab-group-working-on"));

describe("the place picker", () => {
  it("names where the conversation on screen lives: its quest's topic, Main or All", () => {
    const { crumbSlot, rerender } = renderNav();
    // Drawn at the start of the strip, not in place: no tab row at all.
    expect(within(crumbSlot).getByTestId("place-crumb-button").textContent).toContain("Relay");
    expect(screen.queryByTestId("thread-tab-group-bar")).toBeNull();
    rerender({ currentThreadKey: "q-11" });
    expect(screen.getByTestId("place-crumb-button").textContent).toContain("Main");
    rerender({ currentThreadKey: "all" });
    expect(screen.getByTestId("place-crumb-button").textContent).toContain("All threads");
    // A topic's own conversation, and a thread filed under a topic, are that topic.
    rerender({
      currentThreadKey: "q-13",
      topics: { list: TOPICS, currentTopicId: "t1", topicOfQuest: TOPIC_OF_QUEST, onOpen: vi.fn() },
    });
    expect(screen.getByTestId("place-crumb-button").textContent).toContain("Relay");
    const filed = {
      id: "aaaa0001",
      key: "topic:aaaa0001",
      name: "A thread",
      leaderId: "l",
      createdAt: 1,
      activityAt: 1,
      topic: { id: "t2", name: "Briefing" },
    } as ThreadSummary;
    rerender({ currentThreadKey: "topic:aaaa0001", threads: [filed] });
    expect(screen.getByTestId("place-crumb-button").textContent).toContain("Briefing");
  });

  it("lists Main and All first, then every topic and the quests under no topic", () => {
    const { onSelect, onOpenTopic } = renderNav();
    openPlaces();
    const list = screen.getByTestId("place-crumb-list");
    expect(within(list).getByTestId("place-row-main")).toBeTruthy();
    expect(within(list).getByTestId("place-row-all")).toBeTruthy();
    // Each topic says what its quests are doing; the topic on screen is marked.
    const [relay, briefing] = within(list).getAllByTestId("topic-tab-row");
    expect(relay!.className).toContain("bg-cc-active");
    expect(within(relay!).getByTestId("topic-tab-status").textContent).toContain("1 in progress");
    const unsorted = within(list).getByTestId("topic-tab-unsorted");
    expect(
      within(unsorted)
        .getAllByTestId("thread-tab-list-row")
        .map((row) => row.dataset.threadKey),
    ).toEqual(["q-11"]);

    fireEvent.click(within(briefing!).getByRole("menuitem"));
    expect(onOpenTopic).toHaveBeenCalledWith(expect.objectContaining({ id: "t2" }), expect.anything());
    expect(screen.queryByTestId("place-crumb-list")).toBeNull();
    openPlaces();
    fireEvent.click(screen.getByTestId("place-row-main"));
    expect(onSelect).toHaveBeenCalledWith("main");
    openPlaces();
    fireEvent.click(screen.getByTestId("place-row-all"));
    expect(onSelect).toHaveBeenCalledWith("all");
  });

  it("passes the click on, so a Shift-click on a topic can open it in the side column", () => {
    const { onOpenTopic } = renderNav();
    openPlaces();
    fireEvent.click(within(screen.getAllByTestId("topic-tab-row")[1]!).getByRole("menuitem"), { shiftKey: true });
    expect(onOpenTopic.mock.calls[0]![1]).toMatchObject({ shiftKey: true });
  });

  it("searches the topics from the list's heading", () => {
    renderNav({
      topics: {
        list: [
          topic("t1", "Formal verification", ["q-10"], "Lean evals use the relay."),
          topic("t2", "Relay", ["q-12"], "Proxy fixed."),
        ],
        currentTopicId: null,
        topicOfQuest: { "q-10": "t1", "q-12": "t2" },
        onOpen: vi.fn(),
      },
    });
    openPlaces();
    const listed = () => screen.queryAllByTestId("topic-tab-row").map((row) => row.dataset.topic);
    fireEvent.change(screen.getByRole("textbox", { name: "Search topics" }), { target: { value: "relay" } });
    // Names match first, then the newest update.
    expect(listed()).toEqual(["t2", "t1"]);
  });

  it("shows a topic's open questions, opening one where it was asked", () => {
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
    const { onOpenTopic } = renderNav({ currentThreadKey: "main" });
    openPlaces();
    const briefing = screen.getAllByTestId("topic-tab-row").find((row) => row.dataset.topic === "t2")!;
    const badge = within(briefing).getByTestId("topic-questions-badge");
    expect(badge.textContent).toBe("1 question for you");
    fireEvent.click(badge);
    expect(navigateToNotification).toHaveBeenCalledWith("leader", question, expect.any(Array));
    expect(onOpenTopic).not.toHaveBeenCalled();
  });

  it("puts Main's bell beside Main, and counts unread results on topic rows", () => {
    renderNav({
      topics: {
        list: TOPICS,
        currentTopicId: null,
        topicOfQuest: TOPIC_OF_QUEST,
        onOpen: vi.fn(),
        unreadOf: (keys) => (keys.includes("q-13") ? { answers: 0, finished: 1 } : { answers: 0, finished: 0 }),
      },
    });
    openPlaces();
    expect(within(screen.getByTestId("place-row-main")).getByTestId("thread-tab-bell").dataset.kind).toBe("review");
    const briefing = screen.getAllByTestId("topic-tab-row").find((row) => row.dataset.topic === "t2")!;
    expect(within(briefing).getByTestId("topic-tab-unread").textContent).toBe("1 finished");
  });
});

describe("the Working on picker", () => {
  it("lists the quests in motion in the top bar, and opens one", () => {
    // Jiayi: ongoing quests need their own picker in the top bar, not only the breadcrumb.
    const { helpers, onSelect } = renderNav();
    const button = within(helpers).getByTestId("thread-tab-group-working-on");
    // jsdom has the desktop shell's width: the label is spelled out (phones show the count only).
    expect(button.textContent).toContain("Working on 2");
    // No bell on the picker: the quest's row carries it.
    expect(within(button).queryByTestId("thread-tab-bell")).toBeNull();
    openWorkingOn();
    const list = within(helpers).getByTestId("thread-tab-group-list");
    const rows = within(list).getAllByTestId("thread-tab-list-row");
    // Unfinished quests, and finished ones still waiting on a question; never Main or finished work.
    expect(rows.map((row) => row.dataset.threadKey).sort()).toEqual(["q-10", "q-11"]);
    expect(
      within(rows.find((row) => row.dataset.threadKey === "q-11")!).getByTestId("thread-tab-bell").dataset.kind,
    ).toBe("needs-input");
    fireEvent.click(
      within(rows.find((row) => row.dataset.threadKey === "q-11")!).getByTestId("thread-tab-list-row-select"),
    );
    expect(onSelect).toHaveBeenCalledWith("q-11");
    expect(within(helpers).queryByTestId("thread-tab-group-list")).toBeNull();
  });

  it("opens the full board from its list, and shows pressed while the board is open", () => {
    const { helpers, onToggleBoard, rerender } = renderNav();
    openWorkingOn();
    const board = within(helpers).getByTestId("thread-top-bar-board-button");
    expect(board.textContent).toContain("Full board");
    fireEvent.click(board);
    expect(onToggleBoard).toHaveBeenCalledTimes(1);
    rerender({ board: { open: true, dots: [], onToggle: onToggleBoard } });
    const button = within(helpers).getByTestId("thread-tab-group-working-on");
    expect(button.className).toContain("border-cc-primary");
    fireEvent.click(button);
    expect(within(helpers).getByTestId("thread-top-bar-board-button").textContent).toContain("Close board");
  });

  it("spins for writing in a quest it lists, unless that writing is on screen", () => {
    const spins = () =>
      !!within(screen.getByTestId("thread-tab-group-working-on")).queryByTestId("thread-tab-active-output-spinner");
    const { rerender } = renderNav({ currentThreadKey: "main", activeOutputThreadKey: "q-10" });
    expect(spins()).toBe(true);
    rerender({ currentThreadKey: "q-10", activeOutputThreadKey: "q-10" });
    expect(spins()).toBe(false);
    // In the topic's conversation holding the quest, the writing is on screen too.
    rerender({
      currentThreadKey: "q-12",
      activeOutputThreadKey: "q-10",
      topics: { list: TOPICS, currentTopicId: "t1", topicOfQuest: TOPIC_OF_QUEST, onOpen: vi.fn() },
    });
    expect(spins()).toBe(false);
    // Writing in Main spins Main's row in the place list instead.
    rerender({ currentThreadKey: "q-10", activeOutputThreadKey: "main" });
    expect(spins()).toBe(false);
    openPlaces();
    expect(within(screen.getByTestId("place-row-main")).getByTestId("thread-tab-active-output-spinner")).toBeTruthy();
  });
});
