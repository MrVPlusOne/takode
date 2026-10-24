// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QuestRecordFetchContext } from "./QuestSummaryCard.js";
import { TopicFeedContext, TopicFeedQuestStart } from "./topic-feed.js";

/**
 * Tapping a quest's strip in a topic conversation opens that quest alone, the tab's own quest
 * included (selecting the tab already on screen used to do nothing and leave the topic view on).
 */
describe("TopicFeedQuestStart", () => {
  it("opens the quest alone through the topic feed", () => {
    const openQuest = vi.fn();
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider value={{ questIds: ["q-3", "q-12"], openQuest }}>
          <TopicFeedQuestStart questId="q-12" />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    fireEvent.click(screen.getByTitle("Open this quest's own tab"));
    expect(openQuest).toHaveBeenCalledWith("q-12");
  });
});
