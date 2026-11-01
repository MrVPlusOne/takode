// @vitest-environment jsdom
/**
 * A leader's Home, where its Main conversation was: its threads by what they need (the status
 * row's groups at full width), links to the leader log and the topics, over a message box whose
 * first message starts a new thread with the leader, which then opens in the main view.
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
import { resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { scopedSetItem } from "../utils/scoped-storage.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { useTopicPanel } from "../utils/topic-panel.js";
import { LeaderHomePage } from "./LeaderHomePage.js";
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
  useSideColumnStore.setState({ columns: {} });
  startThread.mockReset();
  navigateToSessionThread.mockReset();
});

describe("LeaderHomePage", () => {
  it("lists the leader's threads by what they need, and opens one in the main view", () => {
    // The same members the status row groups: quest threads and the leader's other threads alike.
    useLeaderThreadMembers.setState({
      byLeader: {
        l1: [
          member("q-4", { questId: "q-4", title: "Fix the relay", needsInput: true }),
          member("topic:aaaa0001", { title: "Quick question", blueNudge: true }),
          member("q-2", { questId: "q-2", title: "Old work", completed: true }),
        ],
      },
    });
    render(<LeaderHomePage leaderId="l1" />);
    const sections = screen.getAllByTestId("thread-group-section");
    expect(sections.map((section) => section.dataset.group)).toEqual(["needs-input", "new-results", "idle"]);
    expect(sections[1]!.textContent).toContain("Quick question");
    fireEvent.click(within(sections[0]!).getByTestId("thread-tab-list-row-select"));
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "q-4");
  });

  it("says so when the leader has no threads yet, and links to the leader log and the topics", () => {
    render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getByTestId("leader-home-empty")).toBeTruthy();
    fireEvent.click(screen.getByTestId("leader-home-log"));
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "all");
    // Topics are browsed beside: the side column opens on their list.
    fireEvent.click(screen.getByTestId("leader-home-topics"));
    expect(useTopicPanel.getState().panels.l1).toBe(true);
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
      expect(screen.getByTestId("thread-tab-list-row-line").textContent).toBe("Waiting on your pick of the grading."),
    );
    expect(homeLines).toHaveBeenCalledWith("l1", ["q-2", "q-3", "q-4"]);
    expect(screen.getByTestId("home-since-last-looked").textContent).toContain("1 question · 1 finished");
  });

  it("lists Idle newest first or by topic, remembering the choice", async () => {
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
    fireEvent.click(screen.getByTestId("idle-view-topic"));
    const topics = await screen.findAllByTestId("idle-topic");
    await waitFor(() => expect(screen.getAllByTestId("idle-topic")[0]!.textContent).toContain("Relay"));
    expect(screen.getByTestId("idle-topic-summary").textContent).toBe("The phone reaches it again.");
    expect(topics.at(-1)!.textContent).toContain("No topic");
    view.unmount();
    render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getByTestId("idle-by-topic")).toBeTruthy();
  });
});
