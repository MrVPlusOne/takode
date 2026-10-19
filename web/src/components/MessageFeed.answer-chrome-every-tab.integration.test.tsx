// @vitest-environment jsdom

import { act, cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLeaderThreadResponseState,
  finalizeRoutedLeaderResponseMessage,
} from "../../server/leader-thread-response.js";
import { sendHistoryWindowSync } from "../../server/bridge/browser-transport-controller.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// A leader answer looks the same in every tab that shows it. The reported case:
// a request sent in Main was continued in a quest, and the leader answered it
// from the quest. The quest owns the request, so Main's projection gives the
// answer no coverage; Main used to render it as a plain message with only a
// thread link, while the quest tab framed it and quoted the request. All
// Threads has no projection at all and needs the requests' `uN` IDs, which
// older rows never stored, from the history window.

vi.mock("../api.js", () => ({
  api: { getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: null }) },
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-answer-chrome-every-tab";
const QUEST_ID = "q-2693";
const MAIN_REQUEST = "Where should the message times go? Today I have to hover to find them.";
const QUEST_REQUEST = "Lower right, and cluster close messages.";
const ANSWER_TEXT = "Message times now show in each message's lower-right corner.";
const handleMessage = createWsMessageHandler({ disconnectSession: vi.fn(), sendToSession });

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

/**
 * The Main request continued in the quest, the quest's own request, and the
 * answer the leader wrote in the quest covering both. Neither request stores
 * its `uN` ID, as in histories older than persisted IDs.
 */
function history(): BrowserIncomingMessage[] {
  const messages: BrowserIncomingMessage[] = [
    {
      type: "user_message",
      id: "main-request",
      content: MAIN_REQUEST,
      timestamp: 1_700_000_000_000,
      leaderResponseCoverageVersion: 1,
      threadKey: "main",
      threadRefs: [
        {
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          source: "explicit",
          attachedAt: 1_700_000_001_000,
          attachedBy: "leader",
        },
      ],
    },
    {
      type: "user_message",
      id: "quest-request",
      content: QUEST_REQUEST,
      timestamp: 1_700_000_002_000,
      leaderResponseCoverageVersion: 1,
      threadKey: QUEST_ID,
      questId: QUEST_ID,
      threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" }],
    },
  ];
  const answer: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
    type: "assistant",
    timestamp: 1_700_000_003_000,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    leaderAnswerUserMessageIds: ["u1", "u2"],
    leaderAnswerObservedHistoryLength: messages.length,
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" }],
    message: {
      id: "answer-from-quest",
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text: ANSWER_TEXT }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
  messages.push(answer);
  expect(finalizeRoutedLeaderResponseMessage({ id: SESSION_ID, messageHistory: messages }, answer).finalized).toBe(
    true,
  );
  return messages;
}

/** Deliver one tab's window the way the server builds it. */
function installThreadWindow(
  messages: BrowserIncomingMessage[],
  threadKey: string,
): ReturnType<typeof buildLeaderThreadResponseState>["projection"] {
  const projection = buildLeaderThreadResponseState({ id: SESSION_ID, messageHistory: messages }, threadKey).projection;
  const sync = buildThreadWindowSync({
    messageHistory: messages,
    threadKey,
    fromItem: 0,
    itemCount: 10,
    sectionItemCount: 10,
    visibleItemCount: 10,
    currentThreadResponseProjection: projection,
  });
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: threadKey,
      entries: sync.entries,
      window: sync.window,
      response_state: sync.threadResponseProjection,
    });
  });
  return projection;
}

/** Deliver the All Threads history window through the server's own sender. */
function installHistoryWindow(messages: BrowserIncomingMessage[]): void {
  const sent: BrowserIncomingMessage[] = [];
  sendHistoryWindowSync(
    { messageHistory: messages },
    { send: (data: string) => sent.push(JSON.parse(data) as BrowserIncomingMessage) },
    { fromTurn: 0, turnCount: 10, sectionTurnCount: 10, visibleSectionCount: 1 },
  );
  expect(sent.map((message) => message.type)).toEqual(["history_window_sync"]);
  act(() => {
    handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
    handleMessage(SESSION_ID, sent[0]!);
  });
}

/** The answer's frame and its reference line, failing when the answer renders as a plain message. */
function answerReference(): HTMLElement {
  const answer = screen.getByText(ANSWER_TEXT);
  const frame =
    answer.closest<HTMLElement>("[data-testid='thread-response-current-expanded']") ??
    answer.closest<HTMLElement>("[data-testid='thread-response-current']");
  expect(frame).not.toBeNull();
  return within(frame!).getByTestId("thread-response-answer-reference");
}

describe("leader answer chrome in every tab", () => {
  it("quotes both requests in Main, where the quest owns the answered request", () => {
    const messages = history();
    const projection = installThreadWindow(messages, "main");
    // Main's projection proves the answer but gives it no coverage: the quest owns both requests.
    expect(projection?.currentAnswers[0]).toMatchObject({
      currentMessageId: "answer-from-quest",
      coveredUserMessageIds: [],
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);

    const reference = answerReference();
    expect(reference).toHaveAttribute("data-variant", "quote");
    expect(reference).toHaveAttribute("data-answer-count", "2");
    expect(reference).toHaveTextContent(MAIN_REQUEST);
    expect(reference).toHaveTextContent(QUEST_REQUEST);
  });

  it("shows the same quote in the quest tab it was written in", () => {
    installThreadWindow(history(), QUEST_ID);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const reference = answerReference();
    expect(reference).toHaveAttribute("data-variant", "quote");
    expect(reference).toHaveTextContent(MAIN_REQUEST);
    expect(reference).toHaveTextContent(QUEST_REQUEST);
  });

  it("shows the same quote in All Threads from the history window's derived request IDs", () => {
    installHistoryWindow(history());
    render(<MessageFeed sessionId={SESSION_ID} threadKey="all" />);

    const reference = answerReference();
    expect(reference).toHaveAttribute("data-variant", "quote");
    expect(reference).toHaveTextContent(MAIN_REQUEST);
    expect(reference).toHaveTextContent(QUEST_REQUEST);
    // The quote belongs to the answer row once, not again inside it.
    expect(screen.getAllByTestId("thread-response-answer-reference")).toHaveLength(1);
  });
});
