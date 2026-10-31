// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../MarkdownContent.js", () => ({ MarkdownContent: ({ text }: { text: string }) => <div>{text}</div> }));
const openTopicConversation = vi.hoisted(() => vi.fn());
const navigateToNotification = vi.hoisted(() => vi.fn());
vi.mock("../../utils/notification-navigation.js", () => ({ navigateToNotification }));
vi.mock("../../utils/topic-conversation.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openTopicConversation,
}));
const navigateToSessionThread = vi.hoisted(() => vi.fn());
vi.mock("../../utils/routing.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  navigateToSessionThread,
}));

import type { ArtifactSummary } from "../../../shared/artifact-library.js";
import type { TopicDetail, TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
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
    },
  ],
  spaces: ["MSI"],
  suggestions: [],
};

/** The same leader once topics are on: its Scribe is initializing, a rename waits for the user. */
const ON: TopicListResponse = {
  ...LIST,
  leaders: [{ ...LIST.leaders[0]!, enabled: true }],
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
  stands: [{ leaderId: "l1", leaderNum: 2957, lines: ["Compare with the 256K twin at step 200."], at: NOW }],
  events: [],
  quests: [
    {
      questId: "q-2713",
      title: "Launch T7",
      status: "done",
      completedAt: NOW,
      wrapUp: "Launched; not tried on an iPhone.",
    },
    { questId: "q-2797", title: "Twin evals", status: "in_progress" },
  ],
};

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
  it("says when pictures are newer than the text about them", async () => {
    // A monitor redraws the T7 plots in place; until the Scribe has caught up, the page says that
    // its text predates them. (Each picture's redraw time is tested with the Markdown images.)
    mockApi();
    const plot = "/runs/t7/evals_by_data.png";
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      page: `T7 is the 12B coding run.\n\n## Latest plots\n![Evals](${plot})`,
      pictures: { [plot]: NOW },
      picturesNewerThanText: true,
    });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-pictures-newer")).toHaveTextContent(
      "Some pictures here were redrawn after the text about them was written",
    );
  });

  it("offers to turn topics back on, lists topics and undoes the Scribe's tidying", async () => {
    const api = mockApi();
    // q-2713 (T7 run) has an open question; an answered one and a muted one don't count.
    const [question] = askQuestions(
      { questId: "q-2713", summary: "Pick the grading?" },
      { questId: "q-2713", done: true },
      { questId: "q-2713", muted: true },
    );
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
    // Topics are on by default; a leader the user turned off can turn them back on here.
    const hint = await screen.findByTestId("topic-hint");
    expect(hint).toHaveTextContent("Topics are off for this leader.");
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

  it("searches the topic list from its header, and hides the box on a topic's page", async () => {
    // The same search as the Topics tab group: names first, then the newest update line.
    mockApi();
    render(<TopicSidePanel leaderId="l1" threadKey="main" variant="docked" />);
    const box = await screen.findByRole("textbox", { name: "Search topics" });
    const names = () => screen.queryAllByTestId("library-topic-row").map((row) => row.textContent);
    fireEvent.change(box, { target: { value: "twin" } });
    expect(names()).toEqual([expect.stringContaining("T7 run")]);
    fireEvent.change(box, { target: { value: "qa seeded" } });
    expect(names()).toEqual([expect.stringContaining("Seeded QA")]);
    fireEvent.change(box, { target: { value: "nothing like it" } });
    expect(screen.getByTestId("topic-search-empty")).toBeTruthy();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(names()).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId("library-topic-row")[0]!.querySelector("button")!);
    expect(screen.queryByRole("textbox", { name: "Search topics" })).toBeNull();
  });

  it("follows the quest tab on screen to its topic's page: summary, where it stands, open quests, History", async () => {
    const api = mockApi();
    vi.mocked(artifactApi.list).mockResolvedValue({
      artifacts: [{ ...ARTIFACT, id: "a1" }],
      total: 7,
    } as never);
    // q-2713 is filed under T7 run, so the panel opens on that page.
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-lead")).toHaveTextContent("T7 is the 12B coding run with 384K context.");
    // Only quests still open are listed (live), not every quest of the topic. In the side column
    // they start folded behind their count: the overview above lists what runs.
    const open = within(view).getByTestId("topic-open-quests");
    expect(open).toHaveTextContent("Open quests · 1");
    expect(open.dataset.collapsed).toBe("true");
    fireEvent.click(within(open).getByTestId("topic-section-toggle"));
    expect(open).toHaveTextContent("Twin evals · in progress");
    expect(open).not.toHaveTextContent("Launch T7");
    // Where it stands comes first, above the page; finished quests are in the quest log.
    expect(view.textContent!.indexOf("Compare with the 256K twin")).toBeLessThan(
      view.textContent!.indexOf("Step ~165."),
    );
    expect(within(view).getByTestId("topic-quest-log")).toHaveTextContent(
      "Launch T7: Launched; not tried on an iPhone.",
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
    // The topic's conversation is a place of its own.
    expect(openTopicConversation).toHaveBeenCalledWith("l1", "topic:t7", { replace: false });
    cleanup();

    // With the topic's conversation on screen, the page says so.
    render(<TopicSidePanel leaderId="l1" threadKey="topic:t7" variant="docked" />);
    expect(await screen.findByTestId("topic-viewing-conversation")).toHaveTextContent("Viewing topic tab");
    expect(screen.queryByTestId("topic-read-conversation")).toBeNull();
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
    expect(navigateToSessionThread).toHaveBeenCalledWith("l1", "q-2801", false, "l1");
    expect(screen.queryByTestId("topic-quest-picker-list")).toBeNull();
  });

  it("shows History's newest lines in the side column, folding the older ones until asked", async () => {
    // Jiayi: a long History always on the side is too much; recent entries show, older ones fold.
    mockApi();
    const lines = Array.from({ length: 7 }, (_, index) => `- **Oct ${30 - index}** · Change ${index + 1}`);
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, page: `T7.\n## History\n${lines.join("\n")}` });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    const page = within(view).getByTestId("topic-page");
    expect(page).toHaveTextContent("Change 5");
    expect(page).not.toHaveTextContent("Change 6");
    const older = within(view).getByTestId("topic-history-older");
    expect(older).toHaveTextContent("2 older entries");
    fireEvent.click(older);
    expect(page).toHaveTextContent("Change 7");
    expect(within(view).queryByTestId("topic-history-older")).toBeNull();
  });

  it("folds sections at their headings, remembered per topic, including the quest log", async () => {
    // Every section folds (a long History can be put away to reach what follows); the topic keeps
    // what the user folded across reloads. The quest log comes from the topic's records, not the Scribe.
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      page: "T7.\n## Status\nAs of Oct 24: step 215.\n## History\n- Oct 23 step 165",
      quests: [
        { questId: "q-2713", title: "Launch T7", status: "done", changedAt: NOW - 1000 },
        { questId: "q-2797", title: "Twin evals", status: "in_progress", changedAt: NOW },
      ],
    });
    const { unmount } = render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    const history = within(view).getByRole("button", { name: "History" });
    expect(within(view).getByText("- Oct 23 step 165")).toBeInTheDocument();
    fireEvent.click(history);
    expect(history).toHaveAttribute("aria-expanded", "false");
    expect(within(view).queryByText("- Oct 23 step 165")).toBeNull();
    expect(within(view).getByText("As of Oct 24: step 215.")).toBeInTheDocument();

    const log = within(view).getByTestId("topic-quest-log");
    expect(log).toHaveTextContent("Quest log · 1");
    expect(log).toHaveTextContent("Launch T7");
    expect(log).not.toHaveTextContent("Twin evals");
    fireEvent.click(within(log).getByTestId("topic-section-toggle"));
    expect(log).not.toHaveTextContent("Launch T7");

    // Reopened later: History and the quest log stay folded, as the user left them.
    unmount();
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const again = await screen.findByTestId("topic-view");
    expect(within(again).getByRole("button", { name: "History" })).toHaveAttribute("aria-expanded", "false");
    expect(within(again).getByTestId("topic-quest-log")).not.toHaveTextContent("Launch T7");
  });

  it("offers the topic view for a topic of one quest too", async () => {
    // A quest tab is always a zoomed-in view of its topic, also while the topic holds one quest.
    mockApi();
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const view = await screen.findByTestId("topic-view");
    expect(within(view).getByTestId("topic-read-conversation")).toHaveTextContent("View topic tab");
    expect(view).toHaveTextContent(/1 quest\s*▾\s*· page updated/);
  });

  it("shows where the topic stands as plain lines, nothing to tick, the panel leader's first", async () => {
    // Jiayi: Next, Follow-ups and To try went stale and their tick buttons made chores. Where it
    // stands is a few lines the Scribe rewrites; other leaders' lines fold below.
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({
      ...DETAIL,
      stands: [
        { leaderId: "l1", leaderNum: 2957, lines: ["Eval v2 waits on budget numbers"], at: NOW },
        { leaderId: "l2", leaderNum: 2763, lines: ["Hosts check pending"], at: NOW - 1 },
      ],
    });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const stands = await screen.findByTestId("topic-stands");
    expect(stands).toHaveTextContent("Eval v2 waits on budget numbers");
    expect(within(stands).queryByRole("button", { name: "Mark done" })).toBeNull();
    expect(stands).not.toHaveTextContent("Hosts check pending");
    fireEvent.click(within(stands).getByTestId("topic-stands-others"));
    expect(stands).toHaveTextContent("#2763 · Hosts check pending");
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

  it("folds the quest log after its five newest quests", async () => {
    mockApi();
    const quests = Array.from({ length: 7 }, (_, index) => ({
      questId: `q-${index + 1}`,
      title: `Quest ${index + 1}`,
      status: "done",
      completedAt: NOW - index * 1000,
      wrapUp: `Wrap-up ${index + 1}`,
    }));
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, questIds: quests.map((quest) => quest.questId), quests });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    const log = await screen.findByTestId("topic-quest-log");
    expect(log).toHaveTextContent("Quest log · 7");
    expect(log).toHaveTextContent("Quest 5: Wrap-up 5");
    expect(log).not.toHaveTextContent("Quest 6");
    fireEvent.click(within(log).getByTestId("topic-quest-log-older"));
    expect(log).toHaveTextContent("Quest 7: Wrap-up 7");
  });

  it("shows a written page that is only its summary as written, not as being written", async () => {
    // History holds only events outside quests, so a topic whose news is all finished quests has a
    // page of just its summary sentence, with the quest log below it.
    mockApi();
    vi.mocked(topicApi.get).mockResolvedValue({ ...DETAIL, page: "How changes land on the shared branch." });
    render(<TopicSidePanel leaderId="l1" threadKey="q-2713" variant="docked" />);
    expect(await screen.findByTestId("topic-quest-log")).toHaveTextContent("Launch T7");
    expect(screen.queryByText("The page is being written.")).toBeNull();
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

  it("is part of the desktop layout (the side column): open by default, collapsing to a rail naming the topic", async () => {
    mockApi();
    render(<LeaderTopicPanel leaderId="l1" threadKey="q-2713" desktop />);
    expect(await screen.findByTestId("topic-side-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse the side column" }));
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
