// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));

import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { artifactApi } from "../../api/artifacts.js";
import { setTopicSheetOpen, useTopicPanel } from "../../utils/topic-panel.js";
import { LeaderTopicPanel, TopicSidePanel } from "./TopicSidePanel.js";

/**
 * A leader's topic panel against a mocked API: a leader past about 20 quests gets the hint to
 * turn topics on, the page writer's tidying shows as one line with Undo, the panel follows the
 * quest tab to its topic's page (with Update now and a place to say what to fix), and it sits in
 * the layout as a collapsible rail on desktop or opens as a sheet on phones.
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
  suggestions: [],
};

/** The same leader once topics are on: its Scribe is filing, a rename waits for the user. */
const ON: TopicListResponse = {
  ...LIST,
  leaders: [{ ...LIST.leaders[0]!, enabled: true, suggest: false }],
  suggestions: [
    { id: "s1", topicId: "t7", topicName: "T7 run", name: "Coding T7", reason: "Two runs share it", at: NOW },
  ],
  writer: {
    state: "filing",
    text: "Filing 120 of 336 quests",
    writerSessionId: "scribe-1",
    writerSessionNum: 3300,
    progress: { done: 120, total: 336 },
    pending: 0,
  },
  groupingNotes: "",
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
  localStorage.clear();
  useTopicPanel.setState({ panels: {}, sheets: [], focus: null });
});

function mockApi() {
  vi.spyOn(topicApi, "list").mockResolvedValue(LIST);
  vi.spyOn(topicApi, "get").mockResolvedValue(DETAIL);
  vi.spyOn(artifactApi, "list").mockResolvedValue({ artifacts: [], total: 0 } as never);
  vi.spyOn(topicApi, "questMap").mockResolvedValue({ enabled: true, map: { "q-2713": { id: "t7", name: "T7 run" } } });
  return {
    enable: vi.spyOn(topicApi, "setLeaderEnabled").mockResolvedValue({ enabled: true }),
    undo: vi.spyOn(topicApi, "undo").mockResolvedValue({}),
    update: vi.spyOn(topicApi, "updateNow").mockResolvedValue({ result: "asked" }),
    feedback: vi.spyOn(topicApi, "feedback").mockResolvedValue({ ok: true }),
  };
}

describe("TopicSidePanel", () => {
  it("offers to turn topics on, lists topics and undoes the Scribe's tidying", async () => {
    const api = mockApi();
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
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

  it("follows the quest tab on screen to its topic's page, with Update now and a fix request", async () => {
    const api = mockApi();
    // q-2713 is filed under T7 run, so the panel opens on that page.
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-page")).toHaveTextContent("Step ~165.");
    expect(view).toHaveTextContent("Launch T7");

    // Both go to the Scribe of the leader whose panel this is.
    fireEvent.click(within(view).getByText("Update now"));
    expect(api.update).toHaveBeenCalledWith("t7", "l1");
    fireEvent.change(within(view).getByLabelText("Fix this page"), { target: { value: "The LR is 0.02" } });
    fireEvent.click(within(view).getByText("Send"));
    expect(api.feedback).toHaveBeenCalledWith("t7", "The LR is 0.02", "l1");
    await waitFor(() => expect(view).toHaveTextContent("Sent to the Scribe; the page will be corrected shortly."));
  });

  it("shows the Scribe's live status, rename suggestions to answer, and the grouping instructions box", async () => {
    const api = mockApi();
    vi.spyOn(topicApi, "list").mockResolvedValue(ON);
    const answer = vi.spyOn(topicApi, "answerSuggestion").mockResolvedValue({});
    const notes = vi.spyOn(topicApi, "setGroupingNotes").mockResolvedValue({ groupingNotes: "x" });
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
    const status = await screen.findByTestId("scribe-status");
    expect(status).toHaveTextContent("Scribe #3300 · Filing 120 of 336 quests");
    expect(status).toHaveAttribute("data-state", "filing");

    const suggestions = screen.getByTestId("topic-suggestions");
    expect(suggestions).toHaveTextContent("Rename “T7 run” to “Coding T7”?");
    fireEvent.click(within(suggestions).getByText("Accept"));
    expect(answer).toHaveBeenCalledWith("s1", true);

    fireEvent.click(screen.getByText("Settings and grouping"));
    fireEvent.change(screen.getByLabelText("How to group my topics"), { target: { value: "One topic per run." } });
    fireEvent.click(within(screen.getByTestId("topic-grouping-notes")).getByText("Save"));
    expect(notes).toHaveBeenCalledWith("l1", "One topic per run.");
    expect(api.enable).not.toHaveBeenCalled();
  });

  it("is part of the desktop layout: open by default, collapsing to a rail naming the topic", async () => {
    mockApi();
    render(<LeaderTopicPanel leaderId="l1" threadKey="q-2713" desktop />);
    expect(await screen.findByTestId("topic-side-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse topics" }));
    const rail = await screen.findByTestId("topic-rail");
    await waitFor(() => expect(rail).toHaveTextContent("T7 run"));
    fireEvent.click(within(rail).getByRole("button", { name: "Show the topic T7 run" }));
    expect(await screen.findByTestId("topic-side-panel")).toBeInTheDocument();
  });

  it("opens as a sheet on phones and stays closed until asked", async () => {
    mockApi();
    const { rerender } = render(<LeaderTopicPanel leaderId="l1" threadKey="main" desktop={false} />);
    expect(screen.queryByTestId("topic-side-panel")).toBeNull();
    act(() => setTopicSheetOpen("l1", true));
    rerender(<LeaderTopicPanel leaderId="l1" threadKey="main" desktop={false} />);
    expect(await screen.findByTestId("topic-side-panel")).toHaveAttribute("data-variant", "sheet");
  });
});
