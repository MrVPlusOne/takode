// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";
import { groupMessages } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import type { ChatMessage, QuestmasterTask, ToolResultPreview } from "../types.js";
import { MessageBubble } from "./MessageBubble.js";
import { FeedEntries } from "./MessageFeedEntries.js";

const SESSION_ID = "feed-preview-producer-session";

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "role" | "content">): ChatMessage {
  return {
    timestamp: 1_788_034_400_000,
    ...overrides,
  };
}

function expectPreview(questId: string) {
  expect(screen.getByRole("button", { name: new RegExp(`Preview ${questId}(?:$|:)`) })).toBeInTheDocument();
}

function renderProducerEntries(messages: ChatMessage[]) {
  // Derive the same ToolMsgGroup/SubagentGroup/message entries used by the feed,
  // then opt in only at the FeedEntries producer boundary.
  return render(
    <FeedEntries
      entries={groupMessages(messages)}
      sessionId={SESSION_ID}
      isCodexSession
      activeCodexTerminalIds={new Set()}
      onOpenCodexTerminal={() => {}}
      questLinkSurface="chat-feed"
    />,
  );
}

describe("chat-feed quest-link producer forwarding", () => {
  beforeEach(() => {
    useStore.getState().reset();
    useStore.setState({
      zoomLevel: 1,
      sessions: new Map([
        [SESSION_ID, { session_id: SESSION_ID, backend_type: "codex", cwd: "/tmp/project" } as never],
      ]),
      sessionStatus: new Map([[SESSION_ID, "idle"]]),
    });
    window.location.hash = `#/session/${SESSION_ID}`;
  });

  afterEach(() => {
    cleanup();
    useStore.getState().reset();
    vi.restoreAllMocks();
  });

  it("forwards through MessageBubble-dispatched quiz, lifecycle, compaction, and reminder branches", () => {
    // These are distinct MessageBubble branches whose optional child props would
    // silently fall back to legacy behavior if forwarding were removed.
    const quizQuest = {
      id: "q-302-v1",
      questId: "q-302",
      version: 1,
      status: "done",
      title: "Producer-routed quiz",
      description: "Quiz fixture",
      createdAt: 1,
      quizItems: [
        {
          id: "producer-answer",
          question: "Where is the follow-up?",
          answer: "See [q-303](quest:q-303).",
        },
      ],
    } as QuestmasterTask;
    useStore.setState({ questDetails: new Map([["q-302", quizQuest]]) });

    const quizText = "Narrative [q-301](quest:q-301).\n\n{[(Quest Quiz: q-302)]}";
    render(
      <MessageBubble
        message={message({
          id: "producer-quiz",
          role: "assistant",
          content: quizText,
          contentBlocks: [{ type: "text", text: quizText }],
        })}
        sessionId={SESSION_ID}
        backendType="codex"
        questLinkSurface="chat-feed"
      />,
    );
    expectPreview("q-301");
    expectPreview("q-302");
    fireEvent.click(screen.getByText("Show answer"));
    expectPreview("q-303");
    cleanup();

    render(
      <MessageBubble
        message={message({
          id: "producer-quest-claim",
          role: "system",
          content: "Quest claimed",
          variant: "quest_claimed",
          metadata: {
            quest: {
              questId: "q-304",
              title: "Producer-routed claim",
              status: "in_progress",
              description: "Related [q-305](quest:q-305).",
            },
          },
        })}
        sessionId={SESSION_ID}
        questLinkSurface="chat-feed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Quest Claimed/i }));
    expectPreview("q-305");
    cleanup();

    render(
      <MessageBubble
        message={message({
          id: "compact-boundary-producer-preview",
          role: "system",
          content: "Retained summary [q-306](quest:q-306).",
          variant: "info",
        })}
        sessionId={SESSION_ID}
        questLinkSurface="chat-feed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Conversation compacted" }));
    expectPreview("q-306");
    cleanup();

    render(
      <MessageBubble
        message={message({
          id: "producer-thread-outcome",
          role: "user",
          content: [
            "Thread outcome reminder: mark every touched leader thread with a fresh outcome before idling.",
            "Review [q-307](quest:q-307).",
          ].join("\n"),
          agentSource: {
            sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID,
            sessionLabel: THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
          },
        })}
        sessionId={SESSION_ID}
        questLinkSurface="chat-feed"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Expand ${THREAD_OUTCOME_REMINDER_SOURCE_LABEL}`) }));
    expectPreview("q-307");
  });

  it("forwards through producer-grouped timer, reasoning, tool, and subagent entries", () => {
    // Start from normalized ChatMessage payloads instead of constructing leaf
    // component props, so every assertion covers groupMessages plus FeedEntries.
    const timer = message({
      id: "producer-timer",
      role: "user",
      content: [
        "[⏰ Timer t30 reminder] Inspect the producer route",
        "",
        "This is a reminder from your earlier timer note, not a new user instruction.",
        "",
        "Earlier note:",
        "Review [q-308](quest:q-308).",
      ].join("\n"),
      agentSource: { sessionId: "timer:t30", sessionLabel: "Timer t30" },
    });
    renderProducerEntries([timer]);
    fireEvent.click(screen.getByRole("button", { name: "Expand timer description" }));
    expectPreview("q-308");
    cleanup();

    renderProducerEntries([
      message({
        id: "producer-reasoning-a",
        role: "assistant",
        content: "**First producer summary**\nReview [q-309](quest:q-309).",
        metadata: {
          codexReasoningDetail: { status: "complete", reasoningTurnId: "producer-reasoning", summaryIndex: 0 },
        },
      }),
      message({
        id: "producer-reasoning-b",
        role: "assistant",
        content: "**Second producer summary**\nReview [q-310](quest:q-310).",
        metadata: {
          codexReasoningDetail: { status: "complete", reasoningTurnId: "producer-reasoning", summaryIndex: 1 },
        },
      }),
    ]);
    fireEvent.click(screen.getByTestId("codex-reasoning-detail-group").querySelector("summary")!);
    expectPreview("q-309");
    expectPreview("q-310");
    cleanup();

    renderProducerEntries([
      message({
        id: "producer-exit-plan",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "producer-exit-plan-use",
            name: "ExitPlanMode",
            input: { plan: "Implement [q-311](quest:q-311)." },
          },
        ],
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Plan.*Implement/ }));
    expectPreview("q-311");
    cleanup();

    const result: ToolResultPreview = {
      tool_use_id: "producer-task-use",
      content: "Review [q-312](quest:q-312).",
      is_error: false,
      total_size: 33,
      is_truncated: false,
    };
    useStore.setState({ toolResults: new Map([[SESSION_ID, new Map([["producer-task-use", result]])]]) });
    renderProducerEntries([
      message({
        id: "producer-task",
        role: "assistant",
        content: "",
        contentBlocks: [
          {
            type: "tool_use",
            id: "producer-task-use",
            name: "Task",
            input: { description: "Producer subagent", prompt: "Inspect the preview route" },
          },
        ],
      }),
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Producer subagent/i }));
    fireEvent.click(screen.getByRole("button", { name: "Result" }));
    expectPreview("q-312");
  });
});
