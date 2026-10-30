// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));

import { topicApi } from "../../api/topics.js";
import { resetLeaderTopicsForTest } from "../../utils/leader-topics.js";
import { QuestTopicLink, useLeaderQuestTopic } from "./QuestTopicLink.js";

/**
 * The quest views name a quest's topic (Jiayi rarely reads quest tags and wanted the topic
 * instead), as a link that opens the topic conversation where the quest was last discussed.
 */

function QuestTopic({ leader, onNavigate }: { leader: string | null; onNavigate?: () => void }) {
  const topic = useLeaderQuestTopic(leader, "q-7");
  return topic && leader ? (
    <QuestTopicLink questId="q-7" leaderSessionId={leader} topic={topic} onNavigate={onNavigate} />
  ) : null;
}

function mockTopics() {
  return vi.spyOn(topicApi, "questMap").mockResolvedValue({
    enabled: true,
    map: { "q-7": { id: "t1", name: "Relay" } },
    topics: {},
  });
}

afterEach(() => {
  resetLeaderTopicsForTest();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("QuestTopicLink", () => {
  it("names the quest's topic and opens its conversation where the quest was last discussed", async () => {
    mockTopics();
    const lastDiscussed = vi.spyOn(topicApi, "lastDiscussed").mockResolvedValue({ messageId: "u-9" });
    const onNavigate = vi.fn();
    render(<QuestTopic leader="l1" onNavigate={onNavigate} />);
    const link = await screen.findByTestId("quest-topic-link");
    expect(link.textContent).toBe("Relay");
    // Without script (or copied), the link still leads to the topic conversation.
    expect(link.getAttribute("href")).toBe("#/session/l1?thread=topic%3At1");

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(lastDiscussed).toHaveBeenCalledWith("l1", "q-7");
    await waitFor(() => expect(window.location.hash).toBe("#/session/l1/msg/u-9?thread=topic%3At1"));
  });

  it("opens the topic conversation at its end when the server can't say where the quest was discussed", async () => {
    mockTopics();
    vi.spyOn(topicApi, "lastDiscussed").mockResolvedValue({ messageId: null });
    render(<QuestTopic leader="l1" />);
    fireEvent.click(await screen.findByTestId("quest-topic-link"));
    await waitFor(() => expect(window.location.hash).toBe("#/session/l1?thread=topic%3At1"));
  });

  it("shows nothing for a quest under no topic or without a leader, which asks nothing", async () => {
    const questMap = vi.spyOn(topicApi, "questMap").mockResolvedValue({ enabled: true, map: {}, topics: {} });
    const { rerender } = render(<QuestTopic leader={null} />);
    expect(questMap).not.toHaveBeenCalled();
    rerender(<QuestTopic leader="l1" />);
    await waitFor(() => expect(questMap).toHaveBeenCalledWith("l1", ["q-7"]));
    expect(screen.queryByTestId("quest-topic-link")).toBeNull();
  });
});
