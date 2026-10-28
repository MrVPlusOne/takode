// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestRecordFetchContext } from "./QuestSummaryCard.js";
import { TopicFeedContext, TopicFeedQuestStart } from "./topic-feed.js";

/**
 * Tapping a quest's strip in a topic conversation opens that quest alone, the tab's own quest
 * included (selecting the tab already on screen used to do nothing and leave the topic view on).
 * The quest ID in the strip is a real quest link, like any quest link in the feed, so it is not
 * part of the button that zooms.
 */
describe("TopicFeedQuestStart", () => {
  it("opens the quest alone through the topic feed", () => {
    const openQuest = vi.fn();
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-3", "q-12"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest }}
        >
          <TopicFeedQuestStart questId="q-12" />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    // Tapping the strip zooms into the quest, passing the strip so that part's place carries over.
    fireEvent.click(screen.getByTitle("Zoom into this quest"));
    expect(openQuest).toHaveBeenCalledWith("q-12", screen.getByTestId("topic-feed-quest-start"));

    const link = screen.getByRole("link", { name: "q-12" });
    expect(link.getAttribute("href")).toContain("q-12");
    expect(screen.getByTitle("Zoom into this quest").contains(link)).toBe(false);
  });
});

describe("the topic's own thread", () => {
  it("gets a strip naming the topic, which opens no quest", () => {
    // Topics are threads: what was written in the conversation itself is its own part, with its own
    // strip, so it never reads as part of the quest above it.
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-3"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest: vi.fn() }}
        >
          <TopicFeedQuestStart questId="topic:aaaaaaaa" />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    expect(screen.getByTestId("topic-feed-quest-start").textContent).toContain("Relay");
    expect(screen.queryByTitle("Zoom into this quest")).toBeNull();
  });
});

describe("the pinned strip's spacing", () => {
  it("keeps its distance from the message above as a margin, so no empty band shows once pinned", () => {
    // Jiayi saw an empty band between the topic header and the pinned quest strip: the space above
    // the strip was padding inside the sticky box, which stays when it pins. A stuck sticky box
    // ignores its margin. (jsdom does no layout, so this checks the classes that decide it.)
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-3"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest: vi.fn() }}
        >
          <TopicFeedQuestStart questId="q-3" />
          <TopicFeedQuestStart questId="topic:aaaaaaaa" />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    for (const strip of screen.getAllByTestId("topic-feed-quest-start")) {
      expect(strip.className).toContain("mt-2");
      expect(strip.className).not.toMatch(/\bpt-/);
    }
  });
});
