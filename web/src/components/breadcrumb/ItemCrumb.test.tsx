// @vitest-environment jsdom
/**
 * The breadcrumb's second part: switching to another quest or thread of the topic on screen, or
 * zooming out to the whole topic, and Shift-click putting a quest or thread in the side column.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
const get = vi.hoisted(() => vi.fn());
vi.mock("../../api/topics.js", () => ({ topicApi: { get } }));
vi.mock("../../utils/leader-topics.js", () => ({
  useKnownTopicBrief: () => ({ questIds: ["q-1", "q-2"], threads: [{ handle: "aaaa0001", name: "Why it settles" }] }),
}));
import { useSideColumnStore } from "../../utils/side-column.js";
import { markLeaderThreadDisplayed } from "../../utils/thread-viewport.js";
import { ItemCrumb } from "./ItemCrumb.js";

afterEach(() => {
  cleanup();
  get.mockReset();
  useSideColumnStore.setState({ columns: {} });
  localStorage.clear();
});

function renderCrumb() {
  get.mockResolvedValue({
    quests: [
      { questId: "q-1", title: "Older quest", status: "done", changedAt: 1 },
      { questId: "q-2", title: "Newer quest", status: "in_progress", changedAt: 2 },
    ],
  });
  const handlers = { onOpenTopic: vi.fn(), onOpenQuest: vi.fn(), onOpenThread: vi.fn() };
  render(
    <ItemCrumb
      leaderId="l1"
      topicId="t1"
      current={{ kind: "quest", questId: "q-1" }}
      label="Older quest"
      {...handlers}
    />,
  );
  return handlers;
}

const rowTitles = () =>
  screen.getAllByTestId("item-crumb-row").map((row) => row.querySelector("span + span")!.firstChild!.textContent);

describe("ItemCrumb", () => {
  it("lists the whole topic, then its quests most recently changed first, then its threads", async () => {
    const { onOpenTopic, onOpenQuest, onOpenThread } = renderCrumb();
    fireEvent.click(screen.getByTestId("item-crumb-button"));
    await screen.findByText("Newer quest");
    expect(get).toHaveBeenCalledWith("t1");
    expect(rowTitles()).toEqual(["Whole topic", "Newer quest", "Older quest", "Why it settles"]);
    const rows = screen.getAllByTestId("item-crumb-row");
    expect(rows[2]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.textContent).toContain("All 2 quests as one conversation");

    fireEvent.click(rows[1]!);
    expect(onOpenQuest).toHaveBeenCalledWith("q-2");
    expect(screen.queryByTestId("item-crumb-list")).toBeNull();
    fireEvent.click(screen.getByTestId("item-crumb-button"));
    fireEvent.click((await screen.findAllByTestId("item-crumb-row"))[3]!);
    expect(onOpenThread).toHaveBeenCalledWith("topic:aaaa0001");
    fireEvent.click(screen.getByTestId("item-crumb-button"));
    fireEvent.click((await screen.findAllByTestId("item-crumb-row"))[0]!);
    expect(onOpenTopic).toHaveBeenCalled();
  });

  it("puts a quest in the side column on Shift-click instead of opening it", async () => {
    const shown = markLeaderThreadDisplayed("l1", "q-1");
    try {
      const { onOpenQuest } = renderCrumb();
      fireEvent.click(screen.getByTestId("item-crumb-button"));
      fireEvent.click(await screen.findByText("Newer quest"), { shiftKey: true });
      expect(onOpenQuest).not.toHaveBeenCalled();
      expect(useSideColumnStore.getState().columns.l1!.items).toEqual([
        expect.objectContaining({ kind: "conversation", threadKey: "q-2" }),
      ]);
    } finally {
      shown();
    }
  });
});
