// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
const readTopicConversation = vi.hoisted(() => vi.fn());
const navigateToNotification = vi.hoisted(() => vi.fn());
vi.mock("../../utils/notification-navigation.js", () => ({ navigateToNotification }));
vi.mock("../../utils/topic-conversation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  readTopicConversation,
}));
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../../utils/routing.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigateToSessionThread,
}));

import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import type { NowEntry } from "../../../shared/topic-now-items.js";
import { topicApi } from "../../api/topics.js";
import { useStore } from "../../store.js";
import type { SdkSessionInfo, SessionNotification } from "../../types.js";
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

/** Puts the browser on a route, as navigation would (the hash store listens to hashchange). */
function showRoute(hash: string) {
  history.replaceState(null, "", hash || "#/");
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

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
    activityAt: NOW,
    openNow: 0,
    ...overrides,
  };
}

const LIST: TopicListResponse = {
  topics: [
    topic({ latestUpdate: "Oct 24 · Twin caught up at step 200." }),
    topic({ id: "qa", name: "Seeded QA", tentative: true, summary: "", questIds: ["q-2790"] }),
  ],
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
  useStore.getState().reset();
});

/**
 * The leader's open questions to the user, as the top bar's question list reads them: the leader's
 * needs-input notifications, each asked in a quest's thread. A topic's questions are only these.
 */
function askQuestions(...questions: Array<Partial<SessionNotification> & { questId: string }>) {
  const notifications = questions.map((question, index) => ({
    id: `n-${index + 1}`,
    category: "needs-input" as const,
    summary: `Question ${index + 1}`,
    timestamp: NOW - index * 60_000,
    messageId: `m-${index + 1}`,
    threadKey: question.questId,
    done: false,
    ...question,
  }));
  useStore.setState({
    sdkSessions: [{ sessionId: "l1", name: "Leader", sessionNum: 7, isOrchestrator: true } as SdkSessionInfo],
    sessionNotifications: new Map([["l1", notifications]]),
  });
  return notifications;
}

function mockApi() {
  vi.spyOn(topicApi, "list").mockResolvedValue(LIST);
  vi.spyOn(topicApi, "get").mockResolvedValue(DETAIL);
  vi.spyOn(artifactApi, "list").mockResolvedValue({ artifacts: [], total: 0 } as never);
  vi.spyOn(topicApi, "questMap").mockResolvedValue({
    enabled: true,
    map: { "q-2713": { id: "t7", name: "T7 run" } },
    topics: { t7: { name: "T7 run", questIds: ["q-2713", "q-2797"], activityAt: NOW } },
  });
  return {
    enable: vi.spyOn(topicApi, "setLeaderEnabled").mockResolvedValue({ enabled: true }),
    undo: vi.spyOn(topicApi, "undo").mockResolvedValue({}),
    update: vi.spyOn(topicApi, "updateNow").mockResolvedValue({ result: "asked" }),
  };
}

describe("TopicSidePanel", () => {
  it("offers to turn topics on, lists topics and undoes the Scribe's tidying", async () => {
    const api = mockApi();
    // q-2713 (T7 run) has an open question; an answered one and a muted one don't count.
    const [question] = askQuestions(
      { questId: "q-2713", summary: "Pick the grading?" },
      { questId: "q-2713", done: true },
      { questId: "q-2713", muted: true },
    );
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
    const hint = await screen.findByTestId("topic-hint");
    expect(hint).toHaveTextContent("#2851 Daily Leader has 24 quests. Group them by topic?");
    fireEvent.click(within(hint).getByText("Turn on"));
    expect(api.enable).toHaveBeenCalledWith("l1", true);

    // Each topic shows its newest update (else its description) and its open questions to the user.
    const rows = screen.getAllByTestId("library-topic-row");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("T7 run"),
      expect.stringContaining("Seeded QA"),
    ]);
    expect(rows[0]).toHaveTextContent("Twin caught up at step 200.");
    expect(rows[0]).not.toHaveTextContent("Oct 24 ·");
    expect(rows[0]).toHaveTextContent("1 question for you");
    expect(rows[1]).not.toHaveTextContent("for you");
    // The badge opens the question where it was asked; the 🔔 list stays the place to answer.
    fireEvent.click(within(rows[0]!).getByTestId("topic-questions-badge"));
    expect(navigateToNotification).toHaveBeenCalledWith("l1", question, expect.any(Array));
    // Recent changes to the topics fold into one line, so they don't crowd the list: Show lists
    // them with Undo, Dismiss puts them away without undoing them.
    const changes = screen.getByTestId("topic-changes");
    expect(within(changes).queryByText("Undo")).toBeNull();
    fireEvent.click(within(changes).getByText(/1 recent change to\s+topics/));
    expect(changes).toHaveTextContent('Folded "256K twin" into "T7 run"');
    fireEvent.click(within(changes).getByText("Undo"));
    expect(api.undo).toHaveBeenCalledWith("c1");
    const dismiss = vi.spyOn(topicApi, "dismissChanges").mockResolvedValue({});
    fireEvent.click(within(changes).getByText("Dismiss"));
    expect(dismiss).toHaveBeenCalledWith(["c1"]);
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

  it("shows the topic's open questions on its page, and drops one once it is answered", async () => {
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, questIds: ["q-2713", "q-2797"] });
    askQuestions({ questId: "q-2797", summary: "Keep strict grading?" }, { questId: "q-9", summary: "Elsewhere?" });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const questions = await screen.findByTestId("topic-questions");
    expect(questions).toHaveTextContent("A question for you");
    expect(questions).toHaveTextContent("Keep strict grading?");
    expect(questions).toHaveTextContent("q-2797");
    expect(questions).not.toHaveTextContent("Elsewhere?");
    fireEvent.click(within(questions).getByTestId("topic-question"));
    expect(navigateToNotification).toHaveBeenCalledWith(
      "l1",
      expect.objectContaining({ id: "n-1" }),
      expect.any(Array),
    );

    // Answered: the notification is done, and the page drops it without waiting for a reload.
    act(() => {
      useStore.setState({
        sessionNotifications: new Map([
          [
            "l1",
            useStore
              .getState()
              .sessionNotifications.get("l1")!
              .map((item) => ({ ...item, done: true })),
          ],
        ]),
      });
    });
    expect(screen.queryByTestId("topic-questions")).toBeNull();
  });

  it("offers a View topic tab button, which reads Viewing topic tab while the topic is on screen", async () => {
    // Jiayi: the "Read all N quests" link was too subtle for how often she jumps to the topic's
    // conversation, so it is a button; once that conversation is on screen it says so instead.
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, questIds: ["q-2713", "q-2797"] });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-read-conversation");
    expect(view.tagName).toBe("BUTTON");
    expect(view).toHaveTextContent("View topic tab");
    fireEvent.click(view);
    expect(readTopicConversation).toHaveBeenCalledWith("l1", ["q-2713", "q-2797"], "q-2713", { replace: false });

    // The route says the tab shows its topic (zoomed out).
    act(() => showRoute("#/session/l1?thread=q-2713&topic=1"));
    expect(screen.getByTestId("topic-viewing-conversation")).toHaveTextContent("Viewing topic tab");
    expect(screen.queryByTestId("topic-read-conversation")).toBeNull();
    act(() => showRoute("#/session/l1?thread=q-2713"));
  });

  it("turns the quest count into a picker of the topic's quests, most recent first", async () => {
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      questIds: ["q-2713", "q-2797", "q-2801"],
      quests: [
        { questId: "q-2713", title: "Launch T7", status: "done", changedAt: NOW - 3 * 60 * 60_000 },
        { questId: "q-2797", title: "Twin evals", status: "in_progress", changedAt: NOW - 5 * 60_000 },
        { questId: "q-2801", title: "Grading check", status: "done", changedAt: NOW - 60 * 60_000 },
      ],
    });
    // The tab on screen shows the topic's conversation; picking its own quest reads it alone.
    showRoute("#/session/l1?thread=q-2713&topic=1");
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const picker = await screen.findByTestId("topic-quest-picker");
    expect(picker).toHaveTextContent("3 quests");
    fireEvent.click(picker);
    const rows = screen.getAllByTestId("topic-quest-picker-row");
    expect(rows.map((row) => row.dataset.quest)).toEqual(["q-2797", "q-2801", "q-2713"]);
    expect(rows[2]).toHaveAttribute("aria-selected", "true");
    expect(rows[0]).toHaveTextContent("Twin evals");
    expect(rows[0]).toHaveTextContent("q-2797 · In Progress · 5m ago");

    fireEvent.click(rows[1]!);
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "q-2801", false, "l1", { topicView: false });
    expect(screen.queryByTestId("topic-quest-picker-list")).toBeNull();

    // Picking the tab's own quest zooms in: the same tab, without the topic view.
    fireEvent.click(picker);
    fireEvent.click(screen.getAllByTestId("topic-quest-picker-row")[2]!);
    expect(navigateToSessionThread).toHaveBeenLastCalledWith("l1", "q-2713", false, "l1", { topicView: false });
    showRoute("");
  });

  it("offers the topic view for a topic of one quest too", async () => {
    // A quest tab is always a zoomed-in view of its topic, also while the topic holds one quest.
    mockApi();
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-read-conversation")).toHaveTextContent("View topic tab");
    expect(view).toHaveTextContent(/1 quest\s*▾\s*· page updated/);
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
    // Nothing in Now waits on the user (open questions come from notifications).
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
        entry({ id: "g", group: "followup", text: "set up Open in VS Code." }),
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
      "Follow-ups",
    ]);
    // Follow-ups are optional: shown quietly (grey), and they keep their done button.
    const followUp = within(groups[3]!).getByTestId("topic-now-item");
    expect(followUp).toHaveAttribute("data-quiet", "true");
    expect(within(followUp).getByTestId("topic-now-done")).toBeInTheDocument();
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

    // Settings open from the header's gear, as a titled box above the topics, not a list row.
    expect(screen.queryByTestId("topic-settings")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Topic settings" }));
    expect(screen.getByTestId("topic-settings")).toHaveTextContent("Topic settings");
    fireEvent.change(screen.getByLabelText("Instructions for the Scribe"), { target: { value: "One topic per run." } });
    fireEvent.click(within(screen.getByTestId("scribe-instructions")).getByText("Save"));
    expect(instructions).toHaveBeenCalledWith("l1", "One topic per run.");
    expect(api.enable).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByTestId("topic-settings")).getByText("Done"));
    expect(screen.queryByTestId("topic-settings")).toBeNull();
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
