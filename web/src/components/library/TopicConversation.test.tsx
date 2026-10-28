// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { TopicCrumb, TopicEntryContext, TopicEntryLine, TopicFeedEntry } from "./TopicConversation.js";
import { QuestThreadBanner } from "../QuestThreadBanner.js";

/**
 * The ways into a topic conversation from a quest tab: the topic line above the quest strip, and
 * the "Part of" line its conversation opens with, which shows only where the tab provides a topic.
 */
describe("topic entry points", () => {
  it("names the topic above the strip and opens the conversation when tapped", () => {
    const onOpen = vi.fn();
    render(<TopicEntryLine name="Quest workflow and work board" count={24} onOpen={onOpen} />);
    const line = screen.getByTestId("topic-entry-line");
    expect(line).toHaveTextContent("Quest workflow and work board· 24 quests");
    fireEvent.click(line);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("opens the quest's conversation with the topic it is part of, and is absent without one", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <TopicEntryContext.Provider value={{ name: "Library and topics", count: 3, onOpen }}>
        <TopicFeedEntry />
      </TopicEntryContext.Provider>,
    );
    const entry = screen.getByTestId("topic-feed-entry");
    expect(entry).toHaveTextContent("Part of Library and topics · view the whole topic");
    fireEvent.click(entry);
    expect(onOpen).toHaveBeenCalledOnce();

    rerender(
      <TopicEntryContext.Provider value={null}>
        <TopicFeedEntry />
      </TopicEntryContext.Provider>,
    );
    expect(screen.queryByTestId("topic-feed-entry")).toBeNull();
  });
});

/**
 * Desktop with the thread navigation in the top bar: the topic line above the strip becomes the
 * strip's first part, without the quest count (the topic panel beside it shows that).
 */
describe("topic crumb in the quest strip", () => {
  it("starts the one-line strip with the topic, which zooms out when tapped", () => {
    const onOpen = vi.fn();
    render(
      <QuestThreadBanner
        threadKey="q-7"
        row={{ threadKey: "q-7", questId: "q-7", title: "Daily briefing: October 27" } as never}
        singleLine
        leading={<TopicCrumb name="Daily briefing" onOpen={onOpen} />}
      />,
    );
    const strip = screen.getByTestId("quest-thread-banner");
    const crumb = screen.getByTestId("topic-crumb");
    expect(crumb).toHaveTextContent("Daily briefing");
    expect(crumb.textContent).not.toMatch(/quests/);
    // The topic comes before the quest it holds.
    const questLink = screen.getByText("q-7");
    expect(crumb.compareDocumentPosition(questLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The strip is the container its details compact against in a narrow chat column.
    expect(strip.className).toContain("@container/quest-strip");
    fireEvent.click(crumb);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
