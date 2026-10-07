// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { THREAD_ROUTING_REMINDER_SOURCE_ID } from "../../shared/thread-routing-reminder.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { MessageFeed } from "./MessageFeed.js";

// A collapsed leader turn that has no answer (the request was handed off to a
// quest, or the leader only dispatched work) shows its last message instead of
// collapsing to nothing. Turns with answers keep collapsing to their answers.

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../api.js", () => ({ api: {} }));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

type ThreadWindowSync = Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>;
type AssistantIncoming = Extract<BrowserIncomingMessage, { type: "assistant" }>;

const SESSION_ID = "leader-unanswered-collapse";
const HANDOFF_QUEST_ID = "q-77";
const ANSWER_TEXT = "Here is the answer to the first request.";
const ANSWERED_TURN_COMMENTARY = "Checking the first request before answering.";
const HANDOFF_NOTE = "You're right, that's a bug. I've reopened the quest and I'll follow the fix there.";
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

function assistant(
  id: string,
  content: AssistantIncoming["message"]["content"],
  timestamp: number,
  extra: Partial<AssistantIncoming> = {},
): AssistantIncoming {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    threadKey: "main",
    ...extra,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function commentary(id: string, text: string, timestamp: number): AssistantIncoming {
  return assistant(id, [{ type: "text", text }], timestamp, { leaderThreadRole: "commentary" });
}

function readTool(id: string, timestamp: number): AssistantIncoming {
  return assistant(
    id,
    [{ type: "tool_use", id: `${id}-use`, name: "Read", input: { file_path: "/tmp/a.png" } }],
    timestamp,
    {
      leaderThreadRole: "commentary",
    },
  );
}

function mainWindow(entries: ThreadWindowSync["entries"], responseState?: ThreadWindowSync["response_state"]) {
  const sourceHistoryLength = Math.max(...entries.map((entry) => entry.history_index)) + 1;
  return {
    type: "thread_window_sync",
    thread_key: "main",
    entries,
    window: {
      thread_key: "main",
      from_item: 0,
      item_count: entries.length,
      total_items: entries.length,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: sourceHistoryLength,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    ...(responseState ? { response_state: responseState } : {}),
  } satisfies ThreadWindowSync;
}

function installMainReady(messageId: string, timestamp: number) {
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: SESSION_ID,
      value: createLeaderThreadTabsProjectionValue({
        tabs: [],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        activePhaseSummary: [],
        threadStatuses: {
          main: {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "main",
            summary: "Main handed off",
            messageId,
            timestamp,
            updatedAt: timestamp,
          },
        },
      }),
    }),
  );
}

function turnOf(container: HTMLElement, userMessageId: string): HTMLElement {
  return container
    .querySelector<HTMLElement>(`[data-message-id="${userMessageId}"]`)!
    .closest<HTMLElement>("[data-turn-id]")!;
}

/** Main after a handoff: the first request has an answer; the second was handed
 *  off to a quest, so Main's turn holds only tools and a commentary note. */
function handoffMainWindow(): ThreadWindowSync {
  return mainWindow(
    [
      {
        history_index: 40,
        message: {
          type: "user_message",
          id: "user-answered",
          content: "First request",
          timestamp: 1_700_000_001_000,
          leaderResponseCoverageVersion: 1,
          leaderUserMessageId: "u1",
          threadKey: "main",
        },
      },
      { history_index: 41, message: commentary("answered-commentary", ANSWERED_TURN_COMMENTARY, 1_700_000_002_000) },
      {
        history_index: 42,
        message: assistant("answer-u1", [{ type: "text", text: ANSWER_TEXT }], 1_700_000_003_000, {
          leaderThreadRole: "answer",
          threadAnswer: { version: 2, answerUserMessageIds: ["u1"], observedHistoryLength: 42 },
        }),
      },
      {
        history_index: 43,
        message: {
          type: "user_message",
          id: "user-handed-off",
          content: "This looks like a bug in the quest you just delivered.",
          timestamp: 1_700_000_004_000,
          leaderResponseCoverageVersion: 1,
          leaderUserMessageId: "u2",
          threadKey: "main",
          threadRefs: [
            {
              threadKey: HANDOFF_QUEST_ID,
              questId: HANDOFF_QUEST_ID,
              source: "explicit",
              attachedAt: 1_700_000_006_000,
              attachedBy: SESSION_ID,
            },
          ],
        },
      },
      { history_index: 44, message: readTool("handoff-read", 1_700_000_005_000) },
      { history_index: 45, message: commentary("handoff-note", HANDOFF_NOTE, 1_700_000_007_000) },
    ],
    {
      version: 2,
      threadKey: "main",
      cutoverHistoryIndex: 40,
      pendingMessageCount: 0,
      pendingMessages: [],
      ready: true,
      currentAnswers: [
        {
          version: 2,
          threadKey: "main",
          answerUserMessageIds: ["u1"],
          referencedUserMessageIds: ["user-answered"],
          coveredAnswerUserMessageIds: ["u1"],
          coveredUserMessageIds: ["user-answered"],
          currentMessageId: "answer-u1",
          currentHistoryIndex: 42,
          createdAt: 1_700_000_003_000,
          updatedAt: 1_700_000_003_000,
          source: "explicit",
        },
      ],
    },
  );
}

describe("collapsed leader turns without an answer", () => {
  it("shows the handoff note in a Ready-collapsed turn while answered turns still show only answers", () => {
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(SESSION_ID, handoffMainWindow());
      installMainReady("handoff-note", 1_700_000_008_000);
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);

    const handoffTurn = turnOf(view.container, "user-handed-off");
    expect(within(handoffTurn).getByRole("button", { name: /Show turn activity/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(within(handoffTurn).getByTestId("thread-response-unanswered-message")).toHaveTextContent(HANDOFF_NOTE);
    expect(within(handoffTurn).getAllByText(HANDOFF_NOTE)).toHaveLength(1);

    // The answered turn collapses exactly as before: answer only, commentary hidden.
    const answeredTurn = turnOf(view.container, "user-answered");
    expect(within(answeredTurn).getByText(ANSWER_TEXT)).toBeVisible();
    expect(within(answeredTurn).queryByText(ANSWERED_TURN_COMMENTARY)).not.toBeInTheDocument();
    expect(within(answeredTurn).queryByTestId("thread-response-unanswered-message")).not.toBeInTheDocument();

    // Expanding shows the note once in its chronological place, not twice.
    fireEvent.click(within(handoffTurn).getByRole("button", { name: /Show turn activity/ }));
    expect(within(handoffTurn).getAllByText(HANDOFF_NOTE)).toHaveLength(1);
    expect(within(handoffTurn).queryByTestId("thread-response-unanswered-message")).not.toBeInTheDocument();
  });

  it("shows the last dispatch note of a collapsed turn when Main has no response state", () => {
    const dispatchNote = "I created the quest and dispatched it. I'll follow it in the quest thread.";
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(
        SESSION_ID,
        mainWindow([
          {
            history_index: 10,
            message: {
              type: "user_message",
              id: "user-dispatch",
              content: "Please fix it",
              timestamp: 1_700_000_001_000,
            },
          },
          { history_index: 11, message: commentary("dispatch-early", "Creating the quest now.", 1_700_000_002_000) },
          { history_index: 12, message: readTool("dispatch-read", 1_700_000_003_000) },
          { history_index: 13, message: commentary("dispatch-note", dispatchNote, 1_700_000_004_000) },
          {
            history_index: 14,
            message: {
              type: "user_message",
              id: "user-later",
              content: "Another question",
              timestamp: 1_700_000_005_000,
            },
          },
          { history_index: 15, message: commentary("later-note", "Still working on it.", 1_700_000_006_000) },
        ]),
      );
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);

    // Earlier turns are collapsed; only the last message stands in for the turn.
    const dispatchTurn = turnOf(view.container, "user-dispatch");
    expect(within(dispatchTurn).getByTestId("collapsed-turn-unanswered-message")).toHaveTextContent(dispatchNote);
    expect(within(dispatchTurn).queryByText("Creating the quest now.")).not.toBeInTheDocument();
  });

  it("skips replies to model-only reminders when choosing the last message", () => {
    const humanNote = "Handed this request to the quest thread.";
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(
        SESSION_ID,
        mainWindow([
          {
            history_index: 10,
            message: {
              type: "user_message",
              id: "user-reminded",
              content: "Please look",
              timestamp: 1_700_000_001_000,
            },
          },
          { history_index: 11, message: commentary("reminded-note", humanNote, 1_700_000_002_000) },
          {
            history_index: 12,
            message: {
              type: "user_message",
              id: "routing-reminder",
              content: "Thread routing reminder",
              timestamp: 1_700_000_003_000,
              agentSource: { sessionId: THREAD_ROUTING_REMINDER_SOURCE_ID, sessionLabel: "Thread Routing" },
            },
          },
          { history_index: 13, message: commentary("reminder-reply", "Routing corrected.", 1_700_000_004_000) },
          {
            history_index: 14,
            message: { type: "user_message", id: "user-next", content: "Next", timestamp: 1_700_000_005_000 },
          },
        ]),
      );
    });
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);

    const remindedTurn = turnOf(view.container, "user-reminded");
    expect(within(remindedTurn).getByTestId("collapsed-turn-unanswered-message")).toHaveTextContent(humanNote);
    expect(within(remindedTurn).queryByText("Routing corrected.")).not.toBeInTheDocument();
  });
});
