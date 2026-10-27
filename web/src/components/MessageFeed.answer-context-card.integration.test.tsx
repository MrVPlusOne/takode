// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

// A leader's `takode notify needs-input --answers u12` asked in Main writes its
// context as an answer to a request the user sent in a quest tab. The answer is
// shown in both tabs, so the question card under it must be answerable in both:
// before, the quest tab showed the explanation with no buttons to answer it.

const apiMocks = vi.hoisted(() => ({
  getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: null }),
  sendNeedsInputResponse: vi.fn().mockResolvedValue({ ok: true, delivery: "sent" }),
}));
vi.mock("../api.js", () => ({ api: apiMocks }));
const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-answer-context-card";
const QUEST_ID = "q-42";
const QUEST_USER_ID = "user-quest-request";
const CONTEXT_ID = "needs-input-context-n-7";
const CONTEXT_TEXT = "Proposed quest: ask the user when work waits on their action.";
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
    model: "claude-opus-4-20250514",
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

function questRequest(): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: QUEST_USER_ID,
    content: "Why were we waiting on a timer instead of asking me to restart?",
    timestamp: 1_700_000_010_000,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: "u12",
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" }],
  };
}

// The stored shape of a settled notify context written in Main with `--answers u12`.
function contextAnswer(): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp: 1_700_000_011_000,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    threadKey: "main",
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "backfill", attachedAt: 1_700_000_011_000 }],
    threadAnswer: {
      version: 2,
      answerUserMessageIds: ["u12"],
      observedHistoryLength: 11,
      authoredThreadKey: "main",
      ownerGroups: [{ threadKey: QUEST_ID, userMessageIds: ["u12"] }],
    },
    message: {
      id: CONTEXT_ID,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text: CONTEXT_TEXT }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function threadWindow(
  threadKey: string,
  covered: string[],
): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const entries = [
    { history_index: 10, message: questRequest() },
    { history_index: 11, message: contextAnswer() },
  ];
  return {
    type: "thread_window_sync",
    thread_key: threadKey,
    entries,
    window: {
      thread_key: threadKey,
      from_item: 0,
      item_count: entries.length,
      total_items: entries.length,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 12,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey,
      cutoverHistoryIndex: 0,
      pendingMessageCount: 0,
      pendingMessages: [],
      ready: false,
      currentAnswers: [
        {
          version: 2,
          threadKey: "main",
          answerUserMessageIds: ["u12"],
          referencedUserMessageIds: [QUEST_USER_ID],
          coveredAnswerUserMessageIds: covered.length ? ["u12"] : [],
          coveredUserMessageIds: covered,
          currentMessageId: CONTEXT_ID,
          currentHistoryIndex: 11,
          createdAt: 1_700_000_011_000,
          updatedAt: 1_700_000_011_000,
          source: "explicit",
        },
      ],
    },
  };
}

function notificationUpdate(done: boolean): BrowserIncomingMessage {
  return {
    type: "notification_update",
    notifications: [
      {
        id: "n-7",
        category: "needs-input",
        summary: "Approve the restart-wait instruction fix?",
        questionOnly: true,
        contextMessageId: CONTEXT_ID,
        suggestedAnswers: ["Yes, file and dispatch", "Change something"],
        timestamp: 1_700_000_011_000,
        messageId: CONTEXT_ID,
        threadKey: "main",
        done,
      },
    ],
  } as BrowserIncomingMessage;
}

describe("MessageFeed needs-input card under an answer shown in another tab", () => {
  beforeEach(() => {
    useStore.getState().reset();
    apiMocks.sendNeedsInputResponse.mockClear();
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(SESSION_ID, threadWindow("main", []));
      handleMessage(SESSION_ID, threadWindow(QUEST_ID, [QUEST_USER_ID]));
      handleMessage(SESSION_ID, notificationUpdate(false));
    });
  });

  it("shows the answerable card in both the tab it was asked in and the tab whose request it answers", () => {
    for (const threadKey of ["main", QUEST_ID]) {
      const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={threadKey} />);
      expect(screen.getAllByText(CONTEXT_TEXT)).toHaveLength(1);
      const card = view.container.querySelector<HTMLElement>('[data-notification-id="n-7"]');
      expect(card).not.toBeNull();
      expect(within(card!).getByRole("button", { name: "Use suggested answer: Yes, file and dispatch" })).toBeTruthy();
      view.unmount();
    }
  });

  it("answers the same notification from the quest tab, through its owner thread", () => {
    vi.useFakeTimers();
    const onSelectThread = vi.fn();
    try {
      render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} onSelectThread={onSelectThread} />);
      fireEvent.click(screen.getByRole("button", { name: "Use suggested answer: Yes, file and dispatch" }));
      fireEvent.click(screen.getByRole("button", { name: "Reply" }));
      // Only the timers pending now: message time labels keep a daily midnight timer that
      // reschedules itself, which runAllTimers would follow forever.
      act(() => {
        vi.runOnlyPendingTimers();
      });

      // The reply opens the thread the question was asked in, where it is delivered.
      expect(onSelectThread).toHaveBeenCalledWith("main");
      expect(apiMocks.sendNeedsInputResponse).toHaveBeenCalledTimes(1);
      expect(apiMocks.sendNeedsInputResponse).toHaveBeenCalledWith(
        SESSION_ID,
        "n-7",
        expect.objectContaining({ threadKey: "main" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the answered card in the quest tab once the notification is resolved", () => {
    act(() => {
      handleMessage(SESSION_ID, notificationUpdate(true));
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const card = view.container.querySelector<HTMLElement>('[data-notification-id="n-7"]');
    expect(card).not.toBeNull();
    expect(within(card!).queryByRole("button", { name: "Reply" })).toBeNull();
  });
});
