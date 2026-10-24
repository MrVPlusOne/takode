// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it } from "vitest";
import { DoneTopicList } from "./DoneTopicList.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/**
 * Done list layouts that keep recent quests on top and show a topic as its own kind of row, which
 * opens the topic as one conversation and lists its quests on demand.
 */
const NOW = Date.now();
function tab(n: number): PrimaryThreadChip {
  return {
    threadKey: `q-${n}`,
    questId: `q-${n}`,
    title: `Quest ${n}`,
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: true,
    updatedAt: NOW - n * 1000,
    completed: true,
  };
}
// Newest first, as the Done group lists them.
const TABS = [1, 2, 3, 4, 5, 6, 7, 8].map(tab);
const MAP = {
  "q-1": { id: "t", name: "T7 run" },
  "q-6": { id: "t", name: "T7 run" },
  "q-7": { id: "t", name: "T7 run" },
  "q-3": { id: "v", name: "Voice" },
};
const row = (item: PrimaryThreadChip) => (
  <div key={item.threadKey} data-testid="row">
    {item.title}
  </div>
);

describe("DoneTopicList", () => {
  it("lists the five newest quests, then a row per topic that opens its conversation or lists its quests", () => {
    const opened: string[] = [];
    render(<DoneTopicList tabs={TABS} map={MAP} renderRow={row} onOpenConversation={(key) => opened.push(key)} />);
    expect(screen.getAllByTestId("row").map((item) => item.textContent)).toEqual([
      "Quest 1",
      "Quest 2",
      "Quest 3",
      "Quest 4",
      "Quest 5",
    ]);
    const topics = screen.getAllByTestId("done-topic-row");
    expect(topics.map((topic) => topic.textContent)).toEqual([
      expect.stringContaining("T7 run3 quests · latest: Quest 1"),
      expect.stringContaining("Voice1 quest"),
    ]);
    // Tapping the topic opens its conversation from its newest quest; ▾ lists every quest of it.
    fireEvent.click(screen.getByText("T7 run"));
    expect(opened).toEqual(["q-1"]);
    fireEvent.click(screen.getByRole("button", { name: "List the quests of T7 run" }));
    expect(screen.getByText("Quest 6")).toBeInTheDocument();
    expect(screen.getByText("Quests under no topic · 4 ▾")).toBeInTheDocument();
  });
});
