// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
const readTopicConversation = vi.hoisted(() => vi.fn());
vi.mock("../../utils/topic-conversation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readTopicConversation,
}));

import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import type { NowEntry } from "../../../shared/topic-now-items.js";
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
  page: ["T7 is the 12B coding run with 384K context.", "## History\n- **Oct 23** · Step ~165."].join("\n"),
  now: [entry({ id: "n1", text: "compare with the 256K twin at step 200." })],
  events: [],
  quests: [
    { questId: "q-2713", title: "Launch T7", status: "done" },
    { questId: "q-2797", title: "Twin evals", status: "in_progress" },
  ],
};

/** A Now entry of the panel's leader, added at NOW unless said otherwise. */
function entry(fields: Partial<NowEntry> & { id: string; text: string }): NowEntry {
  return { group: "next", leaderId: "l1", questIds: [], since: NOW, lastNews: NOW, ...fields };
}

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

  it("follows the quest tab on screen to its topic's page: summary, open quests, Now before History", async () => {
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

  it("turns the quest count into the way to read the topic as one conversation", async () => {
    // Jiayi: the button shares the count's place instead of repeating the count on a line of its own.
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, questIds: ["q-2713", "q-2797"] });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const read = await screen.findByTestId("topic-read-conversation");
    expect(read).toHaveTextContent("Read all 2 quests");
    expect(screen.queryByText(/^2 quests/)).toBeNull();
    fireEvent.click(read);
    expect(readTopicConversation).toHaveBeenCalledWith("l1", ["q-2713", "q-2797"], "q-2713");
  });

  it("keeps a plain count for a topic of one quest", async () => {
    mockApi();
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).queryByTestId("topic-read-conversation")).toBeNull();
    expect(view).toHaveTextContent(/1 quest\s*· page updated/);
  });

  it("dates each Now entry, mutes one with no news for a week, and marks one done for the Scribe", async () => {
    // The page shows when each entry was added, mutes one quiet for over a week, and a done tap
    // goes to the panel leader's Scribe.
    mockApi();
    const day = 24 * 60 * 60 * 1000;
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      now: [
        entry({ id: "n1", text: "compare with the twin.", since: NOW - day, lastNews: NOW - day, due: "2026-11-06" }),
        entry({ id: "n2", text: "the QA seeds.", since: NOW - 10 * day, lastNews: NOW - 10 * day }),
      ],
    });
    const done = vi.spyOn(topicApi, "nowDone").mockResolvedValue({ ok: true });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const items = await screen.findAllByTestId("topic-now-item");
    expect(items[0]).toHaveTextContent("Due Nov 6 · Since");
    expect(items[0]).not.toHaveAttribute("data-stale");
    expect(items[1]).toHaveTextContent("No news since");
    expect(items[1]).toHaveAttribute("data-stale", "true");
    fireEvent.click(within(items[1]!).getByRole("button", { name: "Mark done" }));
    expect(done).toHaveBeenCalledWith("t7", "n2", "l1", true);
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

  it("shows Now after a leading Status section, in fixed groups, the panel leader's first", async () => {
    // Now is kept as entries and placed by the page: after Status (or a Latest section), grouped
    // in a fixed order, newest first; a shared topic's other leaders' entries fold below.
    mockApi();
    const day = 24 * 60 * 60 * 1000;
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      page: "T7.\n## Status\nAs of Oct 24: step 215.\n## History\n- Oct 23",
      now: [
        entry({ id: "a", text: "old step.", since: NOW - 2 * day }),
        entry({ id: "b", group: "progress", text: "the run.", since: NOW - day }),
        entry({ id: "c", text: "new step." }),
        entry({ id: "d", group: "waiting", who: "Parsewave", text: "images." }),
        entry({ id: "e", text: "send the guide.", doneAt: NOW }),
        entry({ id: "f", text: "a hosts check.", leaderId: "l2", leaderNum: 2763 }),
      ],
    });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const now = await screen.findByTestId("topic-now");
    const page = screen.getByTestId("topic-page").textContent!;
    expect(page.indexOf("step 215")).toBeLessThan(page.indexOf("old step."));
    expect(page.indexOf("old step.")).toBeLessThan(page.indexOf("Oct 23"));
    const groups = within(now).getAllByTestId("topic-now-group");
    expect(groups.map((group) => group.firstElementChild?.textContent)).toEqual([
      "Waiting on Parsewave",
      "In progress",
      "Next",
    ]);
    expect(
      within(groups[2]!)
        .getAllByTestId("topic-now-item")
        .map((item) => item.textContent),
    ).toEqual([expect.stringContaining("new step."), expect.stringContaining("old step.")]);
    const done = within(now).getAllByTestId("topic-now-item").at(-1)!;
    expect(done).toHaveTextContent("send the guide.");
    expect(within(done).getByText("Undo")).toBeInTheDocument();

    expect(within(now).queryByText("a hosts check.")).toBeNull();
    fireEvent.click(within(now).getByTestId("topic-now-others"));
    expect(within(now).getByTestId("topic-now-others")).toHaveTextContent("From other leaders (1)");
    expect(within(now).getByText("a hosts check.").closest("li")).toHaveTextContent("#2763 · Since");
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
