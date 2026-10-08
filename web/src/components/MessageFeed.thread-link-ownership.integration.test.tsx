// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, SessionState } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { MessageFeed } from "./MessageFeed.js";

// Which thread a message's header links to. A message belongs to one thread:
// the one it was written in. This reproduces a leader answer written in a quest
// tab that covers a request first sent in Main and later handed off to that
// quest. The server stores such an answer with Main as its route (so it can
// show in Main) and the quest as a visibility-only reference; only the
// answer's authored thread says where it was written.

// Leader quest threads load their quest record for the opening description card.
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

const SESSION_ID = "leader-thread-link-ownership";
const QUEST_ID = "q-2289";
const HANDED_OFF_USER_ID = "user-main-handed-off";
const QUEST_USER_ID = "user-quest";
const ANSWER_ID = "answer-from-quest";
const ANSWER_TEXT = "Design C is built and pushed.";
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

// Sent in Main, then handed off: the handoff appends an explicit quest reference.
function handedOffMainRequest(): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: HANDED_OFF_USER_ID,
    content: "Please make the thread tags clickable.",
    timestamp: 1_700_000_010_000,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: "u32",
    threadKey: "main",
    threadRefs: [
      {
        threadKey: QUEST_ID,
        questId: QUEST_ID,
        source: "explicit",
        attachedAt: 1_700_000_011_000,
        attachedBy: "leader",
      },
    ],
  };
}

function questRequest(): BrowserIncomingMessage {
  return {
    type: "user_message",
    id: QUEST_USER_ID,
    content: "Design C, and links on all messages.",
    timestamp: 1_700_000_012_000,
    leaderResponseCoverageVersion: 1,
    leaderUserMessageId: "u35",
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" }],
  };
}

// The stored shape after answer routing canonicalizes `[thread:q-2289:A:u32,u35]`.
function answerFromQuest(): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp: 1_700_000_013_000,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    threadKey: "main",
    threadRefs: [{ threadKey: QUEST_ID, questId: QUEST_ID, source: "backfill", attachedAt: 1_700_000_013_000 }],
    threadAnswer: {
      version: 2,
      answerUserMessageIds: ["u32", "u35"],
      observedHistoryLength: 13,
      authoredThreadKey: QUEST_ID,
      ownerGroups: [{ threadKey: QUEST_ID, userMessageIds: ["u32", "u35"] }],
    },
    message: {
      id: ANSWER_ID,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text: ANSWER_TEXT }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function threadWindow(
  threadKey: string,
  entries: Array<{ history_index: number; message: BrowserIncomingMessage }>,
  covered: { answerIds: string[]; messageIds: string[] },
): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
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
      source_history_length: 14,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey,
      cutoverHistoryIndex: 0,
      pendingMessageCount: 0,
      pendingMessages: [],
      ready: true,
      currentAnswers: [
        {
          version: 2,
          threadKey: "main",
          answerUserMessageIds: ["u32", "u35"],
          referencedUserMessageIds: [HANDED_OFF_USER_ID, QUEST_USER_ID],
          coveredAnswerUserMessageIds: covered.answerIds,
          coveredUserMessageIds: covered.messageIds,
          currentMessageId: ANSWER_ID,
          currentHistoryIndex: 13,
          createdAt: 1_700_000_013_000,
          updatedAt: 1_700_000_013_000,
          source: "explicit",
        },
      ],
    },
  };
}

function installReadyStatuses() {
  const ready = (threadKey: string) => ({
    kind: "ready" as const,
    label: "Thread Ready" as const,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    summary: "answered",
    messageId: ANSWER_ID,
    timestamp: 1_700_000_014_000,
    updatedAt: 1_700_000_014_000,
  });
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: SESSION_ID,
      value: createLeaderThreadTabsProjectionValue({
        tabs: [],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        activePhaseSummary: [],
        threadStatuses: { main: ready("main"), [QUEST_ID]: ready(QUEST_ID) },
      }),
    }),
  );
}

function answerHeader(container: HTMLElement): HTMLElement {
  const answer = container.querySelector<HTMLElement>(`[data-message-id="${ANSWER_ID}"]`)!;
  const row =
    answer.closest<HTMLElement>('[data-testid="thread-response-current"]') ??
    answer.querySelector<HTMLElement>('[data-testid="thread-response-current-expanded"]')!;
  return within(row).getByTestId("message-thread-header");
}

function userThreadLink(container: HTMLElement, messageId: string): string | null {
  const message = container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`)!;
  return message.querySelector('[data-testid="thread-source-badge"]')?.textContent ?? null;
}

describe("MessageFeed thread link ownership", () => {
  beforeEach(() => {
    useStore.getState().reset();
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(
        SESSION_ID,
        threadWindow(
          "main",
          // The server includes every prompt the answer references as bounded
          // proof, even the quest-only one that Main does not display.
          [
            { history_index: 10, message: handedOffMainRequest() },
            { history_index: 12, message: questRequest() },
            { history_index: 13, message: answerFromQuest() },
          ],
          { answerIds: [], messageIds: [] },
        ),
      );
      handleMessage(
        SESSION_ID,
        threadWindow(
          QUEST_ID,
          [
            { history_index: 10, message: handedOffMainRequest() },
            { history_index: 12, message: questRequest() },
            { history_index: 13, message: answerFromQuest() },
          ],
          { answerIds: ["u32", "u35"], messageIds: [HANDED_OFF_USER_ID, QUEST_USER_ID] },
        ),
      );
      installReadyStatuses();
    });
  });

  it("shows only the answer chip in the quest tab the answer was written in", () => {
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const header = answerHeader(view.container);
    expect(within(header).getByTestId("thread-response-answer-count")).toHaveTextContent("Answers 2 messages");
    expect(within(header).queryByTestId("thread-source-badge")).toBeNull();
    // The handed-off request was written in Main, so it links back there.
    expect(userThreadLink(view.container, HANDED_OFF_USER_ID)).toBe("thread:main");
    expect(userThreadLink(view.container, QUEST_USER_ID)).toBeNull();
  });

  it("links the answer to its quest from the Main tab, collapsed and expanded", () => {
    const view = render(<MessageFeed sessionId={SESSION_ID} threadKey="main" />);

    const collapsedHeader = answerHeader(view.container);
    expect(within(collapsedHeader).getByTestId("thread-source-badge")).toHaveTextContent(`thread:${QUEST_ID}`);
    expect(within(collapsedHeader).getByTestId("thread-response-answer-count")).toBeInTheDocument();
    expect(userThreadLink(view.container, HANDED_OFF_USER_ID)).toBeNull();

    const turn = view.container
      .querySelector<HTMLElement>(`[data-message-id="${HANDED_OFF_USER_ID}"]`)!
      .closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(turn).getByRole("button", { name: /Show turn activity/ }));
    expect(screen.getAllByText(ANSWER_TEXT)).toHaveLength(1);
    expect(screen.getAllByTestId("thread-source-badge").map((link) => link.textContent)).toEqual([
      `thread:${QUEST_ID}`,
    ]);
  });
});
