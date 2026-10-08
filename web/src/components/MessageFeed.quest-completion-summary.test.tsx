// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
} from "../../server/leader-thread-response.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";
import { api } from "../api.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// Completed quest threads end with a "Quest complete" card built from the quest's
// final debrief, so a wrap-up turn holding only a Quiz still explains the outcome.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"summary"' }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-completion-summary";
const QUEST_ID = "q-4200";
const QUIZ_DIRECTIVE = `{[(Quest Quiz: ${QUEST_ID})]}`;
const TLDR = "Quest writes now take about 100 ms.";
const DEBRIEF = "Quest writes were slow because every write re-read the whole store. It is now cached in memory.";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
const route = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};
type Assistant = Extract<BrowserIncomingMessage, { type: "assistant" }>;

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

beforeEach(() => {
  useStore.getState().reset();
  sendToSession.mockClear();
});
afterEach(cleanup);

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude-sdk",
    model: "claude-opus",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "main",
    is_worktree: false,
    is_containerized: false,
    repo_root: "/tmp/takode",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function doneQuest(overrides: Partial<Extract<QuestmasterTask, { status: "done" }>> = {}): QuestmasterTask {
  return {
    id: "completion-summary-quest",
    questId: QUEST_ID,
    version: 2,
    title: "Speed up quest writes",
    description: "Make quest writes fast.",
    status: "done",
    createdAt: 1,
    completedAt: 2,
    verificationItems: [],
    debrief: DEBRIEF,
    debriefTldr: TLDR,
    quizItems: [{ id: "why", question: "Why were writes slow?", answer: "Every write re-read the store." }],
    ...overrides,
  };
}

function assistant(id: string, text: string, historyIndex: number): Assistant {
  return {
    type: "assistant",
    timestamp: 1_700_000_000_000 + historyIndex,
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...route,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

/** An answered request followed by the Memory wrap-up turn the leader runs on the worker's turn_end. */
function wrapUpHistory(wrapUpText: string): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  history.push({
    type: "user_message",
    id: "request-1",
    content: "Please speed up quest writes.",
    timestamp: 1_700_000_000_000,
    leaderUserMessageId: "u1",
    leaderResponseCoverageVersion: 1,
    ...route,
  });
  const answer = assistant("answer-1", "Writes are fast now; Memory is closing the quest.", history.length);
  answer.leaderThreadRole = "answer";
  answer.leaderAnswerUserMessageIds = ["u1"];
  answer.leaderAnswerObservedHistoryLength = history.length;
  history.push(answer);
  expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, answer).finalized).toBe(true);
  history.push({
    type: "user_message",
    id: "herd-wrap-up",
    content: "1 event from 1 session\n\n#12 | turn_end | complete",
    timestamp: 1_700_000_000_010,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...route,
  });
  history.push(assistant("wrap-up", wrapUpText, history.length));
  return history;
}

function installHistory(history: BrowserIncomingMessage[], quest: QuestmasterTask | null): void {
  // Use the shared producer so the browser receives the normal thread window shape.
  const projection = buildLeaderThreadResponseState({ id: SESSION_ID, messageHistory: history }, QUEST_ID).projection;
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: 0,
    itemCount: 10,
    sectionItemCount: 10,
    visibleItemCount: 4,
    currentThreadResponseProjection: projection,
  });
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    if (quest) useStore.getState().upsertQuestDetail(quest, { etag: '"summary"' });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: sync.window,
      response_state: sync.threadResponseProjection,
    });
  });
}

function wrapUpTurn(): HTMLElement {
  return screen.getByText(/turn_end/).closest<HTMLElement>("[data-turn-id]")!;
}

describe("MessageFeed quest completion summary", () => {
  it("shows the debrief TLDR above a quiz-only wrap-up through collapse toggles", () => {
    // The reported case: the wrap-up turn's only content is the Quiz directive.
    installHistory(wrapUpHistory(QUIZ_DIRECTIVE), doneQuest());
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const turn = wrapUpTurn();
    const assertCardAboveQuiz = () => {
      const cards = within(turn).getAllByTestId("quest-completion-summary");
      expect(cards).toHaveLength(1);
      expect(cards[0]).toHaveTextContent(TLDR);
      const quiz = within(turn).getByRole("region", { name: "Quest quiz" });
      expect(cards[0].compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };

    assertCardAboveQuiz();
    // The latest turn starts expanded; collapsing must keep the card with the Quiz.
    fireEvent.click(within(turn).getByRole("button", { name: /Hide turn activity/ }));
    assertCardAboveQuiz();
    fireEvent.click(within(turn).getByRole("button", { name: /Show turn activity/ }));
    assertCardAboveQuiz();
    expect(screen.getAllByTestId("quest-completion-summary")).toHaveLength(1);

    fireEvent.click(within(turn).getByRole("button", { name: "Show full debrief" }));
    expect(within(turn).getByTestId("quest-completion-summary")).toHaveTextContent(DEBRIEF);
  });

  it("ends the thread with the card when the leader posted no Quiz", () => {
    installHistory(wrapUpHistory("Quest closed."), doneQuest({ quizItems: undefined }));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const cards = screen.getAllByTestId("quest-completion-summary");
    expect(cards).toHaveLength(1);
    const turn = wrapUpTurn();
    expect(turn).toContainElement(cards[0]);
    expect(cards[0]).toHaveTextContent(TLDR);
    fireEvent.click(within(turn).getByRole("button", { name: /Hide turn activity/ }));
    expect(within(turn).getByTestId("quest-completion-summary")).toHaveTextContent(TLDR);
  });

  it("loads the quest record once the leader's completed board shows the quest", async () => {
    // Open quest threads stay request-free; a completed board row is enough to fetch the debrief.
    vi.mocked(api.getQuestValidated).mockClear();
    installHistory(wrapUpHistory("Quest closed."), null);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(api.getQuestValidated).not.toHaveBeenCalled();

    vi.mocked(api.getQuestValidated).mockResolvedValueOnce({ status: "fresh", etag: '"fresh"', data: doneQuest() });
    act(() => {
      useStore.getState().setSessionCompletedBoard(SESSION_ID, [{ questId: QUEST_ID, updatedAt: 3, completedAt: 3 }]);
    });
    expect(await screen.findByTestId("quest-completion-summary")).toHaveTextContent(TLDR);
    expect(api.getQuestValidated).toHaveBeenCalledWith(QUEST_ID, null);
  });

  it("follows the current quest record when the quest is reopened and completed again", () => {
    installHistory(wrapUpHistory(QUIZ_DIRECTIVE), doneQuest());
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(screen.getByTestId("quest-completion-summary")).toHaveTextContent(TLDR);

    act(() => {
      useStore.getState().upsertQuestDetail({
        id: "completion-summary-quest",
        questId: QUEST_ID,
        version: 3,
        title: "Speed up quest writes",
        description: "Make quest writes fast.",
        status: "in_progress",
        createdAt: 1,
        sessionId: "worker",
        claimedAt: 3,
      });
    });
    expect(screen.queryByTestId("quest-completion-summary")).not.toBeInTheDocument();

    act(() => {
      useStore.getState().upsertQuestDetail(doneQuest({ version: 4, debriefTldr: "Reads are fast too." }));
    });
    expect(screen.getByTestId("quest-completion-summary")).toHaveTextContent("Reads are fast too.");
  });

  it.each([
    ["missing debrief", doneQuest({ debrief: undefined, debriefTldr: undefined })],
    ["cancelled quest", doneQuest({ cancelled: true })],
  ])("renders no card for a %s and keeps the Quiz", (_label, quest) => {
    installHistory(wrapUpHistory(QUIZ_DIRECTIVE), quest);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(screen.queryByTestId("quest-completion-summary")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Quest quiz" })).toBeInTheDocument();
  });

  it("shows the TLDR alone when the debrief adds nothing more", () => {
    installHistory(wrapUpHistory("Quest closed."), doneQuest({ debrief: TLDR }));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(screen.getByTestId("quest-completion-summary")).toHaveTextContent(TLDR);
    expect(screen.queryByRole("button", { name: "Show full debrief" })).not.toBeInTheDocument();
  });
});
