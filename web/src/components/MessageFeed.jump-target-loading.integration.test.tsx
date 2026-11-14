// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { buildThreadWindowSync } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";
import { JUMP_LOOKUP_RETRY_MS } from "./message-feed-scroll-target.js";

// Jumping to a needs-input question (from a notification, a phone alert or a link) opens its
// thread on the question. Until the window around it arrives, the feed held either nothing
// (the question's card then showed alone, drawn from the notification) or an unrelated window
// (the thread's latest messages). The feed must say it is loading instead, and show the
// question's context with its card once the window around it arrives.

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

const SESSION_ID = "leader-jump-target-loading";
const QUEST_ID = "q-77";
const CONTEXT_ID = "needs-input-context-n-3";
const CONTEXT_TEXT = "Two ways to ship the importer: behind a flag, or replacing the old one.";
const QUESTION = "Ship the importer behind a flag?";
const LATEST_TEXT = "Latest progress note 12.";
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

function leaderSession(): SessionState {
  return {
    session_id: SESSION_ID,
    isOrchestrator: true,
    backend_type: "claude-sdk",
    model: "claude-opus",
    cwd: "/tmp/takode",
    tools: [],
    permissionMode: "default",
    claude_code_version: "2.1.0",
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

const questRoute = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const }],
};

function assistant(id: string, text: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    ...questRoute,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

// A long quest thread: twelve conversations (a worker report and the leader's note), with the
// question's context, as the server writes it, in the second one.
function questHistory(): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [];
  for (let item = 1; item <= 12; item++) {
    const at = 1_700_000_000_000 + item * 60_000;
    history.push({
      type: "user_message",
      id: `report-${item}`,
      content: `Worker report ${item}`,
      timestamp: at,
      agentSource: { sessionId: "worker", sessionLabel: "#9 worker" },
      ...questRoute,
    });
    history.push(assistant(`note-${item}`, item === 12 ? LATEST_TEXT : `Progress note ${item}.`, at + 1_000));
    if (item === 2) history.push(assistant(CONTEXT_ID, CONTEXT_TEXT, at + 2_000));
  }
  return history;
}

/** The server's window of the quest thread: the latest three conversations, or those around a target. */
function deliverWindow(history: BrowserIncomingMessage[], hash: string, targetMessageId?: string): void {
  const sync = buildThreadWindowSync({
    messageHistory: history,
    threadKey: QUEST_ID,
    fromItem: -1,
    itemCount: 3,
    sectionItemCount: 3,
    visibleItemCount: 3,
    targetMessageId,
  });
  act(() => {
    handleMessage(SESSION_ID, {
      type: "thread_window_sync",
      thread_key: QUEST_ID,
      entries: sync.entries,
      window: { ...sync.window, window_hash: hash },
      thread_status: null,
    } as BrowserIncomingMessage);
  });
}

function jumpTo(messageId: string): void {
  // The store calls `navigateToNotification` makes for a notification anchored to its context.
  act(() => {
    useStore.getState().requestScrollToMessage(SESSION_ID, messageId);
    useStore.getState().setExpandAllInTurn(SESSION_ID, messageId);
  });
}

function lookupsSent(): number {
  return sendToSession.mock.calls.filter((call) => {
    const message = (call as unknown as [string, { type?: string; target_message_id?: string }])[1];
    return message.type === "thread_window_request" && message.target_message_id === CONTEXT_ID;
  }).length;
}

function setConnection(status: "connected" | "disconnected"): void {
  act(() => useStore.getState().setConnectionStatus(SESSION_ID, status));
}

function expectJumpLoading(): void {
  expect(screen.getByTestId("message-feed-centered-state")).toHaveTextContent(
    "Fetching the messages around the one you opened.",
  );
  expect(screen.queryByText(QUESTION)).not.toBeInTheDocument();
  expect(screen.queryByText(LATEST_TEXT)).not.toBeInTheDocument();
}

function expectQuestionWithContext(): void {
  expect(screen.queryByTestId("message-feed-centered-state")).not.toBeInTheDocument();
  expect(screen.getByText(CONTEXT_TEXT)).toBeInTheDocument();
  expect(screen.getByText(QUESTION)).toBeInTheDocument();
}

describe("MessageFeed jump to a question outside the loaded window", () => {
  beforeEach(() => {
    useStore.getState().reset();
    sendToSession.mockClear();
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      // The open question, as the attention snapshot delivers it, anchored to its context.
      handleMessage(SESSION_ID, {
        type: "notification_update",
        notifications: [
          {
            id: "n-3",
            category: "needs-input",
            summary: QUESTION,
            questionOnly: true,
            contextMessageId: CONTEXT_ID,
            suggestedAnswers: ["Behind a flag", "Replace it"],
            timestamp: 1_700_000_122_000,
            messageId: CONTEXT_ID,
            threadKey: QUEST_ID,
            questId: QUEST_ID,
            done: false,
          },
        ],
      } as BrowserIncomingMessage);
    });
  });

  it("says the thread is loading, not the question card alone, before any window arrives", () => {
    // A cold load from a phone alert: the notification is known, the thread's window is not.
    // Before, the open question's card was drawn alone from the notification.
    jumpTo(CONTEXT_ID);
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expectJumpLoading();

    deliverWindow(questHistory(), "around-question", CONTEXT_ID);
    expectQuestionWithContext();
  });

  it("does not show the thread's latest messages while the window around the question loads", () => {
    const history = questHistory();
    deliverWindow(history, "latest");
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    expect(screen.getByText(LATEST_TEXT)).toBeInTheDocument();
    // The held window lacks the question, so its card is drawn from the notification.
    expect(screen.queryByText(CONTEXT_TEXT)).not.toBeInTheDocument();

    jumpTo(CONTEXT_ID);
    expectJumpLoading();
    const lookup = sendToSession.mock.calls.at(-1) as unknown as [string, { target_message_id?: string }];
    expect(lookup[1].target_message_id).toBe(CONTEXT_ID);

    // The reply to an earlier request (the latest window again, under a new hash) does not
    // answer the lookup: the feed keeps waiting instead of abandoning the jump.
    deliverWindow(history, "latest-again");
    expectJumpLoading();

    deliverWindow(history, "around-question", CONTEXT_ID);
    expectQuestionWithContext();
  });

  describe("when the lookup's reply is lost", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("looks the question up again when the connection comes back, then lands on it", () => {
      // A phone backgrounded mid-jump: the socket dropped after the lookup was sent, so its
      // reply was lost, and the reconnect brings the thread's latest window, not the question's.
      const history = questHistory();
      setConnection("connected");
      deliverWindow(history, "latest");
      render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
      jumpTo(CONTEXT_ID);
      expect(lookupsSent()).toBe(1);

      setConnection("disconnected");
      setConnection("connected");
      deliverWindow(history, "latest-after-reconnect");
      expect(lookupsSent()).toBe(2);
      expectJumpLoading();

      deliverWindow(history, "around-question", CONTEXT_ID);
      expectQuestionWithContext();
    });

    it("asks once more when no reply comes in time, then shows the latest messages", () => {
      const history = questHistory();
      deliverWindow(history, "latest");
      render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
      jumpTo(CONTEXT_ID);
      expect(lookupsSent()).toBe(1);

      act(() => vi.advanceTimersByTime(JUMP_LOOKUP_RETRY_MS));
      expect(lookupsSent()).toBe(2);
      expectJumpLoading();

      // No reply to the second lookup either: the jump gives up instead of loading for good.
      act(() => vi.advanceTimersByTime(JUMP_LOOKUP_RETRY_MS));
      expect(lookupsSent()).toBe(2);
      expect(screen.queryByTestId("message-feed-centered-state")).not.toBeInTheDocument();
      expect(screen.getByText(LATEST_TEXT)).toBeInTheDocument();
    });
  });
});
