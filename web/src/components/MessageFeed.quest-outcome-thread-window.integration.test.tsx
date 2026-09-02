// @vitest-environment jsdom

import { act, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import { MessageFeed } from "./MessageFeed.js";

const apiMocks = vi.hoisted(() => ({
  getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"outcome-detail"' }),
  updateQuestOutcome: vi.fn(),
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));

vi.mock("../api.js", () => ({ api: apiMocks }));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-outcome-window";
const QUEST_ID = "q-2024";
const THREAD_REF = {
  threadKey: QUEST_ID,
  questId: QUEST_ID,
  source: "explicit" as const,
};

const handleMessage = createWsMessageHandler({
  disconnectSession: vi.fn(),
  sendToSession,
});

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
    backend_type: "claude",
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

function assistantMessage(id: string, text: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [THREAD_REF],
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  };
}

function userMessage(id: string, text: string, timestamp: number): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: text,
    timestamp,
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [THREAD_REF],
  };
}

function completedQuest(): QuestmasterTask {
  return {
    id: `${QUEST_ID}-v4`,
    questId: QUEST_ID,
    version: 4,
    title: "Editable quest outcomes",
    description: "Keep one editable Outcome at the boundary it summarizes.",
    status: "done",
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_003_500,
    verificationItems: [],
    quizItems: [
      {
        id: "outcome-boundary",
        question: "What stays below a completed Outcome?",
        answer: "Later clarification and follow-up activity.",
      },
    ],
    outcome: {
      currentRevisionId: "outcome-r1",
      finalizedRevisionId: "outcome-r1",
      finalizedAt: 1_700_000_003_500,
      revisions: [
        {
          revisionId: "outcome-r1",
          markdown: "## Shipped Outcome\n\nThe first coherent version is ready to try.",
          summaryMarkdown: "The first coherent version is ready to try.",
          summarySource: "derived",
          contentHash: "outcome-hash",
          createdAt: 1_700_000_002_500,
          actor: { kind: "leader", sessionId: SESSION_ID },
          anchor: {
            sessionId: SESSION_ID,
            historyIndex: 41,
            messageId: "assistant-work",
          },
          sources: [],
        },
      ],
    },
  };
}

function producerThreadWindow(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const entries = [
    {
      history_index: 40,
      message: userMessage("user-work", "Original implementation request", 1_700_000_001_000),
    },
    {
      history_index: 41,
      message: assistantMessage("assistant-work", "Implementation and verification details", 1_700_000_002_000),
    },
    {
      history_index: 42,
      message: userMessage("user-finish", "Finish the accepted delivery", 1_700_000_003_000),
    },
    {
      history_index: 43,
      message: assistantMessage(
        "assistant-complete",
        `[${QUEST_ID}](quest:${QUEST_ID}) is complete.\n\n{[(Quest Quiz: ${QUEST_ID})]}`,
        1_700_000_004_000,
      ),
    },
    {
      history_index: 44,
      message: userMessage(
        "user-clarification",
        "Post-completion clarification stays in the conversation",
        1_700_000_005_000,
      ),
    },
  ];
  return {
    type: "thread_window_sync",
    thread_key: QUEST_ID,
    entries,
    window: {
      thread_key: QUEST_ID,
      from_item: 0,
      item_count: entries.length,
      total_items: entries.length,
      has_older_items: false,
      has_newer_items: false,
      source_history_length: 45,
      section_item_count: 30,
      visible_item_count: 10,
    },
  };
}

describe("MessageFeed quest Outcome selected-thread integration", () => {
  beforeEach(() => {
    useStore.getState().reset();
    apiMocks.getQuestValidated.mockClear();
    apiMocks.getQuestValidated.mockResolvedValue({ status: "not-modified", etag: '"outcome-detail"' });
    sendToSession.mockClear();

    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(completedQuest(), { etag: '"outcome-detail"' });
      handleMessage(SESSION_ID, producerThreadWindow());
    });
  });

  it("renders one completed Outcome, hides covered history, and keeps later clarification below it", () => {
    const normalizedMessages = useStore.getState().threadWindowMessages.get(SESSION_ID)?.get(QUEST_ID) ?? [];
    expect(normalizedMessages.map(({ id, historyIndex }) => [id, historyIndex])).toEqual([
      ["user-work", 40],
      ["assistant-work", 41],
      ["user-finish", 42],
      ["assistant-complete", 43],
      ["user-clarification", 44],
    ]);

    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} questId={QUEST_ID} />);

    expect(screen.getAllByTestId("quest-outcome-feed-interstitial")).toHaveLength(1);
    expect(screen.getAllByTestId("quest-outcome-card")).toHaveLength(1);
    expect(screen.getByText("Shipped Outcome")).toBeVisible();
    expect(screen.getByText("Original implementation request")).not.toBeVisible();
    expect(screen.getByText("Finish the accepted delivery")).not.toBeVisible();

    const clarification = screen.getByText("Post-completion clarification stays in the conversation");
    const outcome = screen.getByTestId("quest-outcome-card");
    expect(clarification).toBeVisible();
    expect(outcome.compareDocumentPosition(clarification) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(screen.getAllByTestId("quest-quiz-inline")).toHaveLength(1);
    expect(screen.getByText("What stays below a completed Outcome?")).toBeVisible();
    expect(screen.queryByText(/Quest Quiz:/i)).not.toBeInTheDocument();

    const historyToggle = screen.getByTestId("quest-outcome-history-toggle");
    expect(historyToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(historyToggle);
    expect(historyToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(clarification).toBeVisible();
  });

  it("expands covered history before scrolling to a deep-linked user message", () => {
    useStore.setState({ scrollToMessageId: new Map([[SESSION_ID, "user-work"]]) });

    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} questId={QUEST_ID} />);

    expect(screen.getByText("Original implementation request")).toBeVisible();
    expect(screen.getByTestId("quest-outcome-history-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
  });
});
