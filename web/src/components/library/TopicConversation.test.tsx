// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { TopicEntryContext, TopicFeedEntry } from "./TopicConversation.js";

/**
 * A way into a topic conversation from a quest tab: the "Part of" line its conversation opens
 * with, which shows only where the tab provides a topic.
 */
describe("topic entry points", () => {
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
