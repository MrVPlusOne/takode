// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));

import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { artifactApi } from "../../api/artifacts.js";
import { showLibraryTopic } from "../../utils/library-nav.js";
import { TopicsPanel } from "./TopicsPanel.js";

/**
 * The Library's Topics tab against a mocked API: a leader past about 20 quests gets the hint to
 * turn topics on, the page writer's tidying shows as one line with Undo, and a topic opens on its
 * page with Update now and a place to say what to fix.
 */

const NOW = Date.now();

function topic(overrides: Partial<TopicSummary>): TopicSummary {
  return {
    id: "t7",
    space: "MSI",
    name: "T7 run",
    nameSource: "agent",
    tentative: false,
    createdAt: NOW,
    updatedAt: NOW,
    questIds: ["q-2713"],
    summary: "Step ~165; the twin tracks T7.",
    upToDateAt: NOW,
    pendingEvents: 2,
    ...overrides,
  };
}

const LIST: TopicListResponse = {
  topics: [topic({}), topic({ id: "qa", name: "Seeded QA", tentative: true, summary: "" })],
  changes: [
    { id: "c1", at: NOW, space: "MSI", text: 'Folded "256K twin" into "T7 run"', byAgent: true, undone: false },
  ],
  leaders: [
    {
      sessionId: "l1",
      sessionNum: 2851,
      name: "Daily Leader",
      space: "MSI",
      enabled: false,
      questCount: 24,
      suggest: true,
    },
  ],
  spaces: ["MSI"],
  paused: false,
  budget: { used: 0, limit: 0, overBudget: false },
};

const DETAIL: TopicDetail = {
  ...LIST.topics[0]!,
  aliases: [],
  page: "## Where it stands\nStep ~165.",
  events: [],
  quests: [{ questId: "q-2713", title: "Launch T7", status: "done" }],
};

afterEach(() => {
  vi.restoreAllMocks();
  showLibraryTopic(null);
});

function mockApi() {
  vi.spyOn(topicApi, "list").mockResolvedValue(LIST);
  vi.spyOn(topicApi, "get").mockResolvedValue(DETAIL);
  vi.spyOn(artifactApi, "list").mockResolvedValue({ artifacts: [], total: 0 } as never);
  return {
    enable: vi.spyOn(topicApi, "setLeaderEnabled").mockResolvedValue({ enabled: true }),
    undo: vi.spyOn(topicApi, "undo").mockResolvedValue({}),
    update: vi.spyOn(topicApi, "updateNow").mockResolvedValue({ result: "asked" }),
    feedback: vi.spyOn(topicApi, "feedback").mockResolvedValue({ ok: true }),
  };
}

describe("TopicsPanel", () => {
  it("offers to turn topics on, lists topics and undoes the page writer's tidying", async () => {
    const api = mockApi();
    render(<TopicsPanel space="MSI" />);
    const hint = await screen.findByTestId("topic-hint");
    expect(hint).toHaveTextContent("#2851 Daily Leader has 24 quests. Group them by topic?");
    fireEvent.click(within(hint).getByText("Turn on"));
    expect(api.enable).toHaveBeenCalledWith("l1", true);

    const rows = screen.getAllByTestId("library-topic-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("T7 run"),
      expect.stringContaining("Seeded QA"),
    ]);
    fireEvent.click(within(screen.getByTestId("topic-changes")).getByText("Undo"));
    expect(api.undo).toHaveBeenCalledWith("c1");
  });

  it("opens a topic on its page, with Update now and a fix request", async () => {
    const api = mockApi();
    render(<TopicsPanel space="MSI" />);
    fireEvent.click((await screen.findAllByTestId("library-topic-row"))[0]!);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-page")).toHaveTextContent("Step ~165.");
    expect(view).toHaveTextContent("Launch T7");

    fireEvent.click(within(view).getByText("Update now"));
    expect(api.update).toHaveBeenCalledWith("t7");
    fireEvent.change(within(view).getByLabelText("Fix this page"), { target: { value: "The LR is 0.02" } });
    fireEvent.click(within(view).getByText("Send"));
    expect(api.feedback).toHaveBeenCalledWith("t7", "The LR is 0.02");
    await waitFor(() => expect(view).toHaveTextContent("Sent; the page will be corrected shortly."));
  });
});
