// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));

import { topicApi } from "../../api/topics.js";
import { resetLeaderTopicsForTest } from "../../utils/leader-topics.js";
import { useSideColumnStore } from "../../utils/side-column.js";
import { QuestTopicLink, useLeaderQuestTopic } from "./QuestTopicLink.js";

/**
 * The quest views name a quest's topic (Jiayi rarely reads quest tags and wanted the topic
 * instead). Topics are tags for browsing: the link opens the quest's thread with the topic's page
 * beside it.
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
  it("names the quest's topic and opens the quest's thread with the topic's page beside", async () => {
    mockTopics();
    useSideColumnStore.setState({ columns: {} });
    const onNavigate = vi.fn();
    render(<QuestTopic leader="l1" onNavigate={onNavigate} />);
    const link = await screen.findByTestId("quest-topic-link");
    expect(link.textContent).toBe("Relay");
    // Without script (or copied), the link still leads to the quest's thread.
    expect(link.getAttribute("href")).toBe("#/session/l1?thread=q-7");

    fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe("#/session/l1?thread=q-7");
    expect(useSideColumnStore.getState().columns.l1?.items).toEqual([
      expect.objectContaining({ kind: "topic", topicId: "t1" }),
    ]);
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
