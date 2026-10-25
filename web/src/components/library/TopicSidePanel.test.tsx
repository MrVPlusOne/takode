// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));

import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { artifactApi } from "../../api/artifacts.js";
import { setTopicSheetOpen, useTopicPanel } from "../../utils/topic-panel.js";
import { LeaderTopicPanel, TopicSidePanel } from "./TopicSidePanel.js";

/**
 * A leader's topic panel against a mocked API: a leader past about 20 quests gets the hint to
 * turn topics on, a Scribe's tidying shows as one line with Undo, the panel follows the
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
  suggestions: [],
};

/** The same leader once topics are on: its Scribe is initializing, a rename waits for the user. */
const ON: TopicListResponse = {
  ...LIST,
  leaders: [{ ...LIST.leaders[0]!, enabled: true, suggest: false }],
  suggestions: [
    { id: "s1", topicId: "t7", topicName: "T7 run", name: "Coding T7", reason: "Two runs share it", at: NOW },
  ],
  scribe: {
    activity: {
      state: "initializing",
      text: "Sorting recent work into topics: 120 of 336 quests",
      sessionId: "scribe-1",
      sessionNum: 3300,
      progress: { done: 120, total: 336 },
      pending: 0,
    },
    paused: false,
    instructions: "",
  },
};

const ARTIFACT: ArtifactSummary = {
  id: "a1",
  kind: "post",
  title: "T7 thread update",
  space: "MSI",
  sessionId: "l1",
  threadKey: "q-2713",
  createdAt: NOW,
  updatedAt: NOW,
  starred: false,
  versionCount: 1,
  latest: {
    n: 1,
    at: NOW,
    bytes: 10,
    kept: true,
    source: { sessionId: "l1", messageId: "m1", threadKey: "q-2713", at: NOW },
  },
  preview: "Quick T7 update",
};

const DETAIL: TopicDetail = {
  ...LIST.topics[0]!,
  aliases: [],
  writtenAt: NOW,
  instructions: "",
  page: [
    "T7 is the 12B coding run with 384K context.",
    "## Now\n- **Next:** compare with the 256K twin at step 200.",
    "## Recent\n- **Oct 23** · Step ~165.",
  ].join("\n"),
  events: [],
  quests: [
    { questId: "q-2713", title: "Launch T7", status: "done" },
    { questId: "q-2797", title: "Twin evals", status: "in_progress" },
  ],
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

  it("follows the quest tab on screen to its topic's page: summary, open quests, Now before Recent", async () => {
    const api = mockApi();
    vi.mocked(artifactApi.list).mockResolvedValue({
      artifacts: [{ ...ARTIFACT, id: "a1" }],
      total: 7,
    } as never);
    // q-2713 is filed under T7 run, so the panel opens on that page.
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-lead")).toHaveTextContent("T7 is the 12B coding run with 384K context.");
    // Only quests still open are listed (live), not every quest of the topic.
    const open = within(view).getByTestId("topic-open-quests");
    expect(open).toHaveTextContent("Twin evals · in progress");
    expect(open).not.toHaveTextContent("Launch T7");
    const page = within(view).getByTestId("topic-page");
    expect(page.textContent!.indexOf("compare with the 256K twin")).toBeLessThan(
      page.textContent!.indexOf("Step ~165."),
    );
    // No per-quest move menus or fix box: actions sit in the menu, fixes go through the leader.
    expect(within(view).queryByLabelText(/Move q-/)).toBeNull();
    expect(within(view).queryByLabelText("Fix this page")).toBeNull();
    await waitFor(() => expect(within(view).getByText("All 7 in the gallery ›")).toBeInTheDocument());

    fireEvent.click(within(view).getByText("Update now"));
    expect(api.update).toHaveBeenCalledWith("t7", "l1");
  });

  it("dates each Now item, mutes one with no news for a week, and marks one done for the Scribe", async () => {
    // The server reports per Now item when it appeared and its latest news; the page shows that
    // date, mutes an item quiet for over a week, and a done tap goes to the panel leader's Scribe.
    mockApi();
    const day = 24 * 60 * 60 * 1000;
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      page: "T7.\n## Now\n- **Next:** compare with the twin ([q-2797](quest:q-2797)).\n- **On hold:** the QA seeds.\n## Recent\n- Oct 23",
      nowItems: [
        { key: "next|quest:q-2797", since: NOW - day, lastNews: NOW - day },
        { key: "on hold|the qa seeds", since: NOW - 10 * day, lastNews: NOW - 10 * day },
      ],
    });
    const done = vi.spyOn(topicApi, "nowDone").mockResolvedValue({ ok: true });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const items = await screen.findAllByTestId("topic-now-item");
    expect(items[0]).toHaveTextContent("Since");
    expect(items[0]).not.toHaveAttribute("data-stale");
    expect(items[1]).toHaveTextContent("No news since");
    expect(items[1]).toHaveAttribute("data-stale", "true");
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Mark done" }));
    expect(done).toHaveBeenCalledWith("t7", "on hold|the qa seeds", "l1", true);
  });

  it("edits the user's requests for this page from the topic menu, for the panel leader's Scribe", async () => {
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, instructions: "Keep the newest report at the top." });
    const save = vi.spyOn(topicApi, "setPageRequests").mockResolvedValue({ instructions: "x" });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    fireEvent.click(await screen.findByRole("button", { name: "Topic actions" }));
    fireEvent.click(screen.getByRole("button", { name: "Requests for this page" }));
    const box = screen.getByLabelText("Requests for this page");
    expect(box).toHaveValue("Keep the newest report at the top.");
    fireEvent.change(box, { target: { value: "Keep the two newest reports at the top." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(save).toHaveBeenCalledWith("t7", "Keep the two newest reports at the top.", "l1");
  });

  it("groups Now items under their labels, newest first, and keeps a done item with Undo", async () => {
    // The Scribe groups items by label but nothing showed the groups, so a new item seemed to land
    // in a random place; the label is now the group's heading and the newest item leads.
    mockApi();
    const day = 24 * 60 * 60 * 1000;
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      page: "T7.\n## Now\n- **Next:** old step.\n- **In progress:** the run.\n- **Next:** new step.\n## Recent\n- Oct 23",
      nowItems: [
        { key: "next|old step", since: NOW - 2 * day, lastNews: NOW - 2 * day },
        { key: "in progress|the run", since: NOW - day, lastNews: NOW - day },
        { key: "next|new step", since: NOW, lastNews: NOW },
        { key: "next|sent", since: NOW - day, lastNews: NOW - day, doneAt: NOW, text: "**Next:** send the guide." },
      ],
    });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    await screen.findAllByTestId("topic-now-item");
    const groups = screen.getAllByTestId("topic-now-group");
    expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual(["Next", "In progress"]);
    expect(
      within(groups[0]!)
        .getAllByTestId("topic-now-item")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("new step."), expect.stringContaining("old step.")]);
    const done = screen.getAllByTestId("topic-now-item").at(-1)!;
    expect(done).toHaveTextContent("send the guide.");
    expect(done).toHaveTextContent("Marked done");
    expect(within(done).getByText("Undo")).toBeInTheDocument();
  });

  it("shows the Scribe's live status, rename suggestions to answer, and the instructions box", async () => {
    const api = mockApi();
    vi.spyOn(topicApi, "list").mockResolvedValue(ON);
    const answer = vi.spyOn(topicApi, "answerSuggestion").mockResolvedValue({});
    const instructions = vi.spyOn(topicApi, "setScribeInstructions").mockResolvedValue({ instructions: "x" });
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
    const status = await screen.findByTestId("scribe-status");
    expect(status).toHaveTextContent("Scribe #3300 · Sorting recent work into topics: 120 of 336 quests");
    expect(status).toHaveAttribute("data-state", "initializing");

    const suggestions = screen.getByTestId("topic-suggestions");
    expect(suggestions).toHaveTextContent("Rename “T7 run” to “Coding T7”?");
    fireEvent.click(within(suggestions).getByText("Accept"));
    expect(answer).toHaveBeenCalledWith("s1", true);

    fireEvent.click(screen.getByText("Settings and instructions"));
    fireEvent.change(screen.getByLabelText("Instructions for the Scribe"), { target: { value: "One topic per run." } });
    fireEvent.click(within(screen.getByTestId("scribe-instructions")).getByText("Save"));
    expect(instructions).toHaveBeenCalledWith("l1", "One topic per run.");
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

  it("keeps the dismissed phone sheet and recently shown pages mounted, so they come back as left", async () => {
    // Dismissing the sheet to glance at the chat used to unmount it, losing the page and its
    // scroll position. Now the sheet stays mounted (hidden) and so do the last few topic pages.
    mockApi();
    vi.mocked(topicApi.get).mockImplementation(async (id: string) =>
      id === "qa" ? { ...DETAIL, id: "qa", name: "Seeded QA", page: "QA seeds." } : DETAIL,
    );
    act(() => setTopicSheetOpen("l1", true));
    render(<LeaderTopicPanel leaderId="l1" threadKey="q-2713" desktop={false} />);
    const view = await screen.findByTestId("topic-view");
    await waitFor(() => expect(within(view).getByTestId("topic-lead")).toHaveTextContent("T7 is the 12B"));
    view.scrollTop = 240;

    act(() => setTopicSheetOpen("l1", false));
    // It slides away first, then hides.
    await waitFor(() => expect(screen.queryByTestId("topic-side-panel")).not.toBeVisible());
    act(() => setTopicSheetOpen("l1", true));
    expect(screen.getByTestId("topic-side-panel")).toBeVisible();
    expect(screen.getAllByTestId("topic-view")[0]).toBe(view);
    expect(view.scrollTop).toBe(240);

    // Another topic and back: the first page is the same element, still scrolled.
    fireEvent.click(screen.getByRole("button", { name: /All topics/ }));
    expect(view).not.toBeVisible();
    fireEvent.click(await within(screen.getByTestId("topic-panel-list")).findByText("Seeded QA"));
    await waitFor(() => expect(screen.getByText("QA seeds.")).toBeVisible());
    // A topic picked over the tab's own stays picked when the sheet is dismissed and reopened.
    act(() => setTopicSheetOpen("l1", false));
    await waitFor(() => expect(screen.queryByTestId("topic-side-panel")).not.toBeVisible());
    act(() => setTopicSheetOpen("l1", true));
    expect(screen.getByText("QA seeds.")).toBeVisible();
    expect(view).not.toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /All topics/ }));
    fireEvent.click(within(screen.getByTestId("topic-panel-list")).getByText("T7 run"));
    expect(view).toBeVisible();
    expect(view.scrollTop).toBe(240);
  });
});
