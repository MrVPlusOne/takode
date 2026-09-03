// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, QuestmasterTask, SessionState } from "../types.js";
import { useStore } from "../store.js";
import { createWsMessageHandler } from "../ws-handlers.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";
import { MessageFeed } from "./MessageFeed.js";

const apiMocks = vi.hoisted(() => ({
  getQuestValidated: vi.fn().mockResolvedValue({ status: "not-modified", etag: '"response-detail"' }),
}));
const sendToSession = vi.hoisted(() => vi.fn(() => true));

vi.mock("../api.js", () => ({ api: apiMocks }));
vi.mock("../ws.js", () => ({ sendToSession }));
vi.mock("../utils/notification-sound.js", () => ({
  playNotificationSound: vi.fn(),
  playNeedsInputSound: vi.fn(),
  playReviewSound: vi.fn(),
}));

const SESSION_ID = "leader-response-window";
const QUEST_ID = "q-2024";
const THREAD_REF = { threadKey: QUEST_ID, questId: QUEST_ID, source: "explicit" as const };
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

function routedFields() {
  return { threadKey: QUEST_ID, questId: QUEST_ID, threadRefs: [THREAD_REF] };
}

function userMessage(id: string, text: string, timestamp: number, responseCoverage = true): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: text,
    timestamp,
    ...(responseCoverage ? { leaderResponseCoverageVersion: 1 as const } : {}),
    ...routedFields(),
  };
}

function assistantMessage(
  id: string,
  text: string,
  timestamp: number,
  codexMessagePhase?: "commentary" | "final_answer",
): BrowserIncomingMessage {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    ...(codexMessagePhase ? { codexMessagePhase } : {}),
    ...routedFields(),
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function responseMessage(input: {
  id: string;
  logicalResponseId: string;
  revisionId: string;
  revisionNumber: number;
  batchId: string;
  coveredUserMessageIds: string[];
  content: string;
  timestamp: number;
  parentRevisionId?: string;
}): BrowserIncomingMessage {
  return {
    type: "leader_user_message",
    id: input.id,
    content: input.content,
    timestamp: input.timestamp,
    ...routedFields(),
    threadResponse: {
      logicalResponseId: input.logicalResponseId,
      revisionId: input.revisionId,
      ...(input.parentRevisionId ? { parentRevisionId: input.parentRevisionId } : {}),
      revisionNumber: input.revisionNumber,
      batchId: input.batchId,
      batchObservedHistoryLength: 47,
      coveredUserMessageIds: input.coveredUserMessageIds,
      contentHash: `hash-${input.revisionId}`,
    },
  };
}

function quest(): QuestmasterTask {
  return {
    id: `${QUEST_ID}-v4`,
    questId: QUEST_ID,
    version: 4,
    title: "Leader thread responses",
    description: "Keep polished responses visible when Ready.",
    status: "done",
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_006_000,
    verificationItems: [],
    quizItems: [
      {
        id: "response-history",
        question: "What remains available after a response is revised?",
        answer: "The complete chronological thread history.",
      },
    ],
  };
}

function responseState(
  ready = true,
): NonNullable<Extract<BrowserIncomingMessage, { type: "thread_window_sync" }>["response_state"]> {
  return {
    version: 1,
    threadKey: QUEST_ID,
    cutoverHistoryIndex: 40,
    pendingMessageCount: ready ? 0 : 1,
    pendingBatches: ready
      ? []
      : [
          {
            token: "pending-1",
            userMessageIds: ["user-third"],
            messageCount: 1,
            firstHistoryIndex: 44,
            lastHistoryIndex: 44,
            firstAskedAt: 1_700_000_005_000,
            lastAskedAt: 1_700_000_005_000,
          },
        ],
    currentResponses: [
      {
        version: 1,
        logicalResponseId: "response-grouped",
        threadKey: QUEST_ID,
        questId: QUEST_ID,
        batchId: "batch-grouped",
        batchObservedHistoryLength: 47,
        coveredUserMessageIds: ["user-first", "user-second"],
        currentRevisionId: "grouped-r2",
        currentMessageId: "response-grouped-r2",
        currentHistoryIndex: 43,
        revisionCount: 2,
        createdAt: 1_700_000_003_000,
        updatedAt: 1_700_000_004_000,
      },
      ...(ready
        ? [
            {
              version: 1 as const,
              logicalResponseId: "response-single",
              threadKey: QUEST_ID,
              questId: QUEST_ID,
              batchId: "batch-single",
              batchObservedHistoryLength: 47,
              coveredUserMessageIds: ["user-third"],
              currentRevisionId: "single-r1",
              currentMessageId: "response-single-r1",
              currentHistoryIndex: 46,
              revisionCount: 1,
              createdAt: 1_700_000_007_000,
              updatedAt: 1_700_000_007_000,
            },
          ]
        : []),
    ],
    ready,
  };
}

function producerThreadWindow(ready = true): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const entries = [
    { history_index: 40, message: userMessage("user-first", "First pending request", 1_700_000_001_000) },
    { history_index: 41, message: userMessage("user-second", "Second pending request", 1_700_000_002_000) },
    {
      history_index: 42,
      message: responseMessage({
        id: "response-grouped-r1",
        logicalResponseId: "response-grouped",
        revisionId: "grouped-r1",
        revisionNumber: 1,
        batchId: "batch-grouped",
        coveredUserMessageIds: ["user-first", "user-second"],
        content: "Earlier grouped response",
        timestamp: 1_700_000_003_000,
      }),
    },
    {
      history_index: 43,
      message: responseMessage({
        id: "response-grouped-r2",
        logicalResponseId: "response-grouped",
        revisionId: "grouped-r2",
        parentRevisionId: "grouped-r1",
        revisionNumber: 2,
        batchId: "batch-grouped",
        coveredUserMessageIds: ["user-first", "user-second"],
        content: "Current grouped response",
        timestamp: 1_700_000_004_000,
      }),
    },
    { history_index: 44, message: userMessage("user-third", "Third pending request", 1_700_000_005_000) },
    {
      history_index: 45,
      message: assistantMessage("assistant-intermediate", "Intermediate leader and tool activity", 1_700_000_006_000),
    },
    {
      history_index: 46,
      message: responseMessage({
        id: "response-single-r1",
        logicalResponseId: "response-single",
        revisionId: "single-r1",
        revisionNumber: 1,
        batchId: "batch-single",
        coveredUserMessageIds: ["user-third"],
        content: "Current singleton response",
        timestamp: 1_700_000_007_000,
      }),
    },
    {
      history_index: 47,
      message: assistantMessage("assistant-quiz", `{[(Quest Quiz: ${QUEST_ID})]}`, 1_700_000_008_000),
    },
    {
      history_index: 48,
      message: {
        type: "compact_marker",
        id: "hidden-compact",
        summary: "Hidden compact marker",
        timestamp: 1_700_000_009_000,
        ...routedFields(),
      } as BrowserIncomingMessage,
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
      source_history_length: 49,
      section_item_count: 30,
      visible_item_count: 10,
    },
    response_state: responseState(ready),
  };
}

function producerMixedCutoverThreadWindow(
  options: { includePreCutoverQuiz?: boolean; includePostCutoverQuiz?: boolean } = {},
): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const postCutover = producerThreadWindow();
  const postCutoverEntries =
    options.includePostCutoverQuiz === false
      ? postCutover.entries.filter((entry) => entry.history_index !== 47)
      : postCutover.entries;
  const entries = [
    {
      history_index: 36,
      message: userMessage("user-before-cutover", "Request before response coverage", 1_699_999_996_000, false),
    },
    {
      history_index: 37,
      message: assistantMessage(
        "assistant-before-cutover-final",
        "Phase-aware response before response coverage",
        1_699_999_997_000,
        "final_answer",
      ),
    },
    ...(options.includePreCutoverQuiz
      ? [
          {
            history_index: 38,
            message: assistantMessage(
              "assistant-before-cutover-quiz",
              `{[(Quest Quiz: ${QUEST_ID})]}`,
              1_699_999_998_000,
              "commentary",
            ),
          },
        ]
      : []),
    {
      history_index: 39,
      message: assistantMessage(
        "assistant-before-cutover-commentary",
        "Pre-cutover commentary stays behind expansion",
        1_699_999_999_000,
        "commentary",
      ),
    },
    ...postCutoverEntries,
  ];
  return {
    ...postCutover,
    entries,
    window: {
      ...postCutover.window,
      item_count: entries.length,
      total_items: entries.length,
      visible_item_count: entries.length,
    },
  };
}

function installReadyStatus(timestamp = 1_700_000_010_000) {
  useStore.getState().applySyncedProjectionSnapshot(
    createLeaderThreadTabsProjectionEnvelope({
      key: SESSION_ID,
      value: createLeaderThreadTabsProjectionValue({
        tabs: [],
        mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
        activePhaseSummary: [],
        threadStatuses: {
          [QUEST_ID]: {
            kind: "ready",
            label: "Thread Ready",
            threadKey: QUEST_ID,
            questId: QUEST_ID,
            summary: "responses complete",
            messageId: "response-single-r1",
            timestamp,
            updatedAt: timestamp,
          },
        },
      }),
    }),
  );
}

describe("MessageFeed pending-batch response selected-window integration", () => {
  beforeEach(() => {
    useStore.getState().reset();
    apiMocks.getQuestValidated.mockClear();
    sendToSession.mockClear();
    act(() => {
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerThreadWindow());
      installReadyStatus();
    });
  });

  it("preserves the pre-cutover collapsed response while using response rows after cutover", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerMixedCutoverThreadWindow());
      installReadyStatus();
    });

    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const legacyResponse = screen.getByText("Phase-aware response before response coverage");
    expect(legacyResponse).toBeVisible();
    expect(screen.queryByText("Pre-cutover commentary stays behind expansion")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("thread-response-current")).toHaveLength(2);
    expect(screen.getByText("Current grouped response")).toBeVisible();
    expect(screen.getByText("Current singleton response")).toBeVisible();
  });

  it("excludes a pre-cutover Quiz directive from the Ready response presentation", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(
        SESSION_ID,
        producerMixedCutoverThreadWindow({ includePreCutoverQuiz: true, includePostCutoverQuiz: false }),
      );
      installReadyStatus();
    });

    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("Phase-aware response before response coverage")).toBeVisible();
    expect(screen.queryByRole("region", { name: "Quest quiz" })).not.toBeInTheDocument();
    expect(screen.getAllByTestId("thread-response-current")).toHaveLength(2);
  });

  it("shows each current batch response once after its last prompt and one Quiz when Ready", () => {
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const first = screen.getByText("First pending request");
    const second = screen.getByText("Second pending request");
    const third = screen.getByText("Third pending request");
    const grouped = screen.getByText("Current grouped response");
    const singleton = screen.getByText("Current singleton response");
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(second.compareDocumentPosition(grouped) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(third.compareDocumentPosition(singleton) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(screen.getByTestId("thread-response-group-provenance")).toHaveTextContent("Answers 2 messages");
    expect(screen.getAllByTestId("thread-response-current")).toHaveLength(2);
    expect(screen.queryByText("Earlier grouped response")).not.toBeInTheDocument();
    expect(screen.queryByText("Intermediate leader and tool activity")).not.toBeInTheDocument();
    expect(screen.queryByText("Hidden compact marker")).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    expect(screen.queryByText(/Quest Quiz:/i)).not.toBeInTheDocument();
  });

  it("reveals superseded revisions and intermediate activity in unchanged expanded chronology", () => {
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);
    const thirdTurn = screen.getByText("Third pending request").closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(thirdTurn).getByRole("button", { name: /Leader activity/i }));

    expect(screen.getByText("Intermediate leader and tool activity")).toBeVisible();
    expect(screen.getByText("Current singleton response")).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);

    const secondTurn = screen.getByText("Second pending request").closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(secondTurn).getByRole("button", { name: /Leader activity/i }));
    expect(screen.getByText("Earlier grouped response")).toBeVisible();
    expect(screen.getByText("Current grouped response")).toBeVisible();
  });

  it("fails closed immediately when a new live covered user message outruns the cached response state", () => {
    act(() => {
      handleMessage(SESSION_ID, userMessage("user-live", "A new request arrived", 1_700_000_011_000));
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("A new request arrived")).toBeVisible();
    expect(screen.queryByTestId("thread-response-current")).not.toBeInTheDocument();
  });

  it("requires a Ready marker at least as fresh as the current response revision", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerThreadWindow());
      installReadyStatus(1_700_000_000_000);
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.queryByTestId("thread-response-current")).not.toBeInTheDocument();
    expect(screen.getByText("Earlier grouped response")).toBeVisible();
  });

  it("keeps the phase-aware fallback when coverage is pending even if a stale Ready marker exists", () => {
    act(() => handleMessage(SESSION_ID, producerThreadWindow(false)));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(useStore.getState().threadWindowResponseStates.get(SESSION_ID)?.get(QUEST_ID)?.ready).toBe(false);
    expect(screen.queryByTestId("thread-response-group-provenance")).not.toBeInTheDocument();
    expect(screen.getByText("Earlier grouped response")).toBeVisible();
  });
});
