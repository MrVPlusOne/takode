// @vitest-environment jsdom
/**
 * A topic leader's Home, where its Main conversation was (Jiayi chose it over a bare "new thread"
 * page): the leader's overview at full width and its threads, over a message box whose first
 * message starts a new thread with the leader, which then opens in the main view.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
const startThread = vi.hoisted(() => vi.fn());
vi.mock("../api/topics.js", () => ({ topicApi: { startThread, threads: vi.fn(() => new Promise(() => {})) } }));
type NewThread = { start: (text: string) => Promise<string | null>; started: (threadKey: string) => void };
const composer = vi.hoisted(() => ({ props: null as null | { newThread: NewThread; threadKey: string } }));
vi.mock("./Composer.js", () => ({
  Composer: (props: { newThread: NewThread; threadKey: string }) => {
    composer.props = props;
    return <div data-testid="composer" />;
  },
}));
vi.mock("./overview/LeaderOverview.js", () => ({
  useLeaderOverview: () => ({}),
  LeaderOverview: () => <div data-testid="leader-overview" />,
}));
vi.mock("./TopicTabList.js", () => ({ useTopicTabTopics: () => [] }));
vi.mock("./side-column/thread-names.js", () => ({ threadNameFromMessage: (text: string) => `named: ${text}` }));
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../utils/routing.js", () => ({ navigateToSessionThread }));
import { rememberThreads } from "../utils/leader-topics.js";
import { LeaderHomePage } from "./LeaderHomePage.js";

afterEach(() => {
  cleanup();
  startThread.mockReset();
  navigateToSessionThread.mockReset();
});

describe("LeaderHomePage", () => {
  it("shows the overview and the leader's threads, the leader's own marked as such", () => {
    rememberThreads("l1", [
      {
        id: "a1",
        key: "topic:aaaa0001",
        name: "Faster eval sweeps",
        leaderId: "l1",
        createdAt: 1,
        activityAt: 2,
        startedBy: "leader",
      },
      { id: "a2", key: "topic:aaaa0002", name: "Quick question", leaderId: "l1", createdAt: 1, activityAt: 1 },
    ]);
    render(<LeaderHomePage leaderId="l1" />);
    expect(screen.getByTestId("leader-overview")).toBeTruthy();
    const threads = screen.getByTestId("leader-home-threads");
    expect(threads.textContent).toContain("Faster eval sweeps");
    expect(threads.textContent).toContain("the leader's");
    expect(threads.textContent).toContain("Quick question");
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
});
