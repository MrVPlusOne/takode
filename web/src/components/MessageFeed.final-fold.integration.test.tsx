// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
} from "../../server/leader-thread-response.js";
import { useStore } from "../store.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// A leader quest thread's latest turn can run for hours: worker events never start a new
// turn. Once the leader posts a final message (an answer, a new result, a needs-input
// question), the commentary and activity before it fold away the way an older turn's do,
// and what came after it stays open. These tests replay quest-thread histories through
// the server's thread-window producer, with the thread Waiting rather than Ready.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"fold"' }) },
}));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-final-fold";
const QUEST_ID = "q-4400";
const PROGRESS_TEXT = "Batch 1 is running on the cluster.";
const ANSWER_TEXT = "Batch 1 passed: every reference proof is accepted.";
const AFTER_TEXT = "The worker started batch 2.";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });
const questRoute = {
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
  projectionRevision = 0;
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

function timestampAt(historyIndex: number): number {
  return 1_700_000_000_000 + historyIndex * 1000;
}

function waitingStatus(messageId: string, historyIndex: number): LeaderThreadStatus {
  return {
    kind: "waiting",
    label: "Thread Waiting",
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    summary: "worker running",
    messageId,
    timestamp: timestampAt(historyIndex),
    updatedAt: timestampAt(historyIndex),
  };
}

function assistant(history: BrowserIncomingMessage[], id: string, text: string): Assistant {
  const message: Assistant = {
    type: "assistant",
    timestamp: timestampAt(history.length),
    parent_tool_use_id: null,
    leaderThreadRole: "commentary",
    ...questRoute,
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
  history.push(message);
  return message;
}

function answer(history: BrowserIncomingMessage[], id: string, text: string, requestIds: string[]): Assistant {
  const message = assistant(history, id, text);
  message.leaderThreadRole = "answer";
  message.leaderAnswerUserMessageIds = requestIds;
  message.leaderAnswerObservedHistoryLength = history.length - 1;
  expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, message).finalized).toBe(
    true,
  );
  return message;
}

function herdEvent(history: BrowserIncomingMessage[], id: string): void {
  history.push({
    type: "user_message",
    id,
    content: "1 event from 1 session\n\n#12 | turn_end | complete",
    timestamp: timestampAt(history.length),
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...questRoute,
  });
}

/** A request, a progress note and a worker event, then the leader's answer. */
function answeredHistory(): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  history.push({
    type: "user_message",
    id: "request-1",
    content: "Run batch 1 and tell me how it went.",
    timestamp: timestampAt(0),
    leaderUserMessageId: "u1",
    leaderResponseCoverageVersion: 1,
    ...questRoute,
  });
  assistant(history, "progress", PROGRESS_TEXT);
  herdEvent(history, "herd-1");
  answer(history, "answer-1", ANSWER_TEXT, ["u1"]);
  return history;
}

let projectionRevision = 0;

/** Deliver the server's selected-thread window, with the thread Waiting. */
function deliver(history: BrowserIncomingMessage[]): void {
  const projection = buildLeaderThreadResponseState({ id: SESSION_ID, messageHistory: history }, QUEST_ID).projection;
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: -1,
    itemCount: 20,
    sectionItemCount: 20,
    visibleItemCount: 4,
    currentThreadResponseProjection: projection,
  });
  projectionRevision += 1;
  act(() => {
    if (projectionRevision === 1) handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: { ...sync.window, window_hash: `window-${projectionRevision}` },
      ...(sync.threadResponseProjection ? { response_state: sync.threadResponseProjection } : {}),
    });
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: SESSION_ID,
        revision: projectionRevision,
        value: createLeaderThreadTabsProjectionValue({
          tabs: [],
          activePhaseSummary: [],
          threadStatuses: { [QUEST_ID]: waitingStatus("progress", 1) },
        }),
      }),
    );
  });
}

function latestTurn(container: HTMLElement): HTMLElement {
  const turns = container.querySelectorAll<HTMLElement>("[data-turn-id]");
  return turns[turns.length - 1]!;
}

function expectFolded(container: HTMLElement): void {
  const turn = latestTurn(container);
  expect(within(turn).getByRole("button", { name: /Show turn activity/ })).toBeInTheDocument();
  expect(within(turn).queryByText(PROGRESS_TEXT)).not.toBeInTheDocument();
  expect(within(turn).getByText(ANSWER_TEXT)).toBeInTheDocument();
}

function openMessage(messageId: string): void {
  act(() => {
    useStore.getState().requestScrollToMessage(SESSION_ID, messageId);
    useStore.getState().setExpandAllInTurn(SESSION_ID, messageId);
  });
}

describe("MessageFeed fold before the newest final message", () => {
  it("folds the activity before an answer and keeps what followed it open", () => {
    const history = answeredHistory();
    herdEvent(history, "herd-2");
    assistant(history, "after", AFTER_TEXT);
    deliver(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expectFolded(view.container);
    const turn = latestTurn(view.container);
    // Commentary after the newest final stays in place, after the answer.
    const after = within(turn).getByText(AFTER_TEXT);
    expect(within(turn).getByText(ANSWER_TEXT).compareDocumentPosition(after)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(within(turn).getByRole("button", { name: /Show turn activity/ }));
    expect(within(latestTurn(view.container)).getByText(PROGRESS_TEXT)).toBeInTheDocument();
    expect(within(latestTurn(view.container)).getByText(AFTER_TEXT)).toBeInTheDocument();
  });

  it("leaves a turn open while no final message has come", () => {
    const history = answeredHistory().slice(0, 3);
    deliver(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const turn = latestTurn(view.container);
    expect(within(turn).getByRole("button", { name: /Hide turn activity/ })).toBeInTheDocument();
    expect(within(turn).getByText(PROGRESS_TEXT)).toBeInTheDocument();
  });

  it("folds before a needs-input question", () => {
    const history = answeredHistory().slice(0, 3);
    const question = assistant(history, "question-1", "Batch 1 found two bad tasks. Drop them or fix the checker?");
    question.notification = { id: "n-1", category: "needs-input", timestamp: timestampAt(3), summary: "Bad tasks" };
    deliver(history);
    act(() => {
      handleMessage(SESSION_ID, {
        type: "notification_update",
        notifications: [
          {
            id: "n-1",
            category: "needs-input",
            timestamp: timestampAt(3),
            done: false,
            messageId: "question-1",
            summary: "Bad tasks",
            threadKey: QUEST_ID,
            questId: QUEST_ID,
          },
        ],
        notificationStatusVersion: 1,
      });
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const turn = latestTurn(view.container);
    expect(within(turn).getByRole("button", { name: /Show turn activity/ })).toBeInTheDocument();
    expect(within(turn).queryByText(PROGRESS_TEXT)).not.toBeInTheDocument();
    expect(within(turn).getByText(/Drop them or fix the checker/)).toBeInTheDocument();
  });

  it("folds again when a newer final arrives, even after the user expanded the turn", () => {
    const history = answeredHistory();
    deliver(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    fireEvent.click(within(latestTurn(view.container)).getByRole("button", { name: /Show turn activity/ }));
    expect(within(latestTurn(view.container)).getByText(PROGRESS_TEXT)).toBeInTheDocument();

    // More work follows in the same turn (worker events don't start one); the expansion holds.
    herdEvent(history, "herd-2");
    assistant(history, "after", AFTER_TEXT);
    deliver(history);
    expect(within(latestTurn(view.container)).getByText(PROGRESS_TEXT)).toBeInTheDocument();

    // A new result folds everything before it, the earlier answer staying on screen.
    answer(history, "result-2", "Batch 2 passed too; the pilot can launch.", []);
    deliver(history);
    const turn = latestTurn(view.container);
    expect(within(turn).queryByText(PROGRESS_TEXT)).not.toBeInTheDocument();
    expect(within(turn).queryByText(AFTER_TEXT)).not.toBeInTheDocument();
    expect(within(turn).getByText(ANSWER_TEXT)).toBeInTheDocument();
    expect(within(turn).getByText("Batch 2 passed too; the pilot can launch.")).toBeInTheDocument();
  });

  it("keeps the fold when navigation opens the answer, and opens it for folded commentary", () => {
    const history = answeredHistory();
    deliver(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    openMessage("answer-1");
    expectFolded(view.container);

    openMessage("progress");
    expect(within(latestTurn(view.container)).getByText(PROGRESS_TEXT)).toBeInTheDocument();
  });

  it("keeps an answer visible when the same message goes on to make a tool call", () => {
    // Jiayi (Nov 3): a Claude leader wrote its result as an answer and called `takode notify` in
    // the same message. The answer was rejected for carrying a tool call and folded away with the
    // turn's activity. It now counts, and the card shows its prose without the call.
    const history = answeredHistory().slice(0, 3);
    const result = assistant(history, "result-with-tool", "The prototype is built and ready for your review.");
    result.message.content.push({
      type: "tool_use",
      id: "notify-1",
      name: "Bash",
      input: { command: "takode notify" },
    });
    result.leaderThreadRole = "answer";
    result.leaderAnswerUserMessageIds = ["u1"];
    result.leaderAnswerObservedHistoryLength = history.length - 1;
    expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: history }, result).finalized).toBe(
      true,
    );
    deliver(history);
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const turn = latestTurn(view.container);
    expect(within(turn).getByRole("button", { name: /Show turn activity/ })).toBeInTheDocument();
    expect(within(turn).queryByText(PROGRESS_TEXT)).not.toBeInTheDocument();
    expect(within(turn).getByText("The prototype is built and ready for your review.")).toBeInTheDocument();
  });
});
