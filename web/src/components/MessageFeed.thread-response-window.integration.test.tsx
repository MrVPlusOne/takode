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

function answerIdForRawUserMessage(id: string): string {
  const ids: Record<string, string> = {
    "user-first": "u1",
    "user-second": "u2",
    "user-third": "u3",
    "user-live": "u4",
    "user-quiz-owner": "u1",
    "user-later": "u2",
    "user-only": "u1",
    "user-older-pending": "u1",
    "user-later-answered": "u2",
  };
  const answerId = ids[id];
  if (!answerId) throw new Error(`Missing answer ID fixture for ${id}`);
  return answerId;
}

function userMessage(id: string, text: string, timestamp: number, responseCoverage = true): BrowserIncomingMessage {
  return {
    type: "user_message",
    id,
    content: text,
    timestamp,
    ...(responseCoverage
      ? { leaderResponseCoverageVersion: 1 as const, leaderUserMessageId: answerIdForRawUserMessage(id) }
      : {}),
    ...routedFields(),
  };
}

function assistantMessage(
  id: string,
  text: string,
  timestamp: number,
  codexMessagePhase?: "commentary" | "final_answer",
  leaderThreadRole?: "commentary" | "answer" | "response",
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp,
    parent_tool_use_id: null,
    ...(codexMessagePhase ? { codexMessagePhase } : {}),
    ...(leaderThreadRole ? { leaderThreadRole } : {}),
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
  coveredUserMessageIds: string[];
  content: string;
  timestamp: number;
  observedHistoryLength?: number;
}): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  return {
    type: "assistant",
    timestamp: input.timestamp,
    parent_tool_use_id: null,
    leaderThreadRole: "answer",
    ...routedFields(),
    threadAnswer: {
      version: 2,
      answerUserMessageIds: input.coveredUserMessageIds.map(answerIdForRawUserMessage),
      observedHistoryLength:
        input.observedHistoryLength ??
        Math.max(
          ...input.coveredUserMessageIds.map(
            (id) =>
              ({
                "user-first": 41,
                "user-second": 42,
                "user-third": 45,
                "user-quiz-owner": 41,
                "user-later": 44,
                "user-only": 41,
              })[id] ?? 0,
          ),
        ),
    },
    message: {
      id: input.id,
      type: "message",
      role: "assistant",
      model: "claude-opus-4-20250514",
      content: [{ type: "text", text: input.content }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
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
    version: 2,
    threadKey: QUEST_ID,
    cutoverHistoryIndex: 40,
    pendingMessageCount: ready ? 0 : 1,
    pendingMessages: ready
      ? []
      : [
          {
            userMessageId: "u3",
            historyMessageId: "user-third",
            historyIndex: 44,
            askedAt: 1_700_000_005_000,
          },
        ],
    currentAnswers: [
      {
        version: 2,
        threadKey: QUEST_ID,
        questId: QUEST_ID,
        answerUserMessageIds: ["u1", "u2"],
        referencedUserMessageIds: ["user-first", "user-second"],
        coveredAnswerUserMessageIds: ["u1", "u2"],
        coveredUserMessageIds: ["user-first", "user-second"],
        currentMessageId: "response-grouped-r2",
        currentHistoryIndex: 43,
        createdAt: 1_700_000_004_000,
        updatedAt: 1_700_000_004_000,
        source: "explicit",
      },
      ...(ready
        ? [
            {
              version: 2 as const,
              threadKey: QUEST_ID,
              questId: QUEST_ID,
              answerUserMessageIds: ["u3"],
              referencedUserMessageIds: ["user-third"],
              coveredAnswerUserMessageIds: ["u3"],
              coveredUserMessageIds: ["user-third"],
              currentMessageId: "response-single-r1",
              currentHistoryIndex: 46,
              createdAt: 1_700_000_007_000,
              updatedAt: 1_700_000_007_000,
              source: "explicit" as const,
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
        coveredUserMessageIds: ["user-first", "user-second"],
        content: "Earlier grouped response",
        timestamp: 1_700_000_003_000,
      }),
    },
    {
      history_index: 43,
      message: responseMessage({
        id: "response-grouped-r2",
        coveredUserMessageIds: ["user-first", "user-second"],
        content: "Current grouped response",
        timestamp: 1_700_000_004_000,
      }),
    },
    { history_index: 44, message: userMessage("user-third", "Third pending request", 1_700_000_005_000) },
    {
      history_index: 45,
      message: assistantMessage(
        "assistant-intermediate",
        "Intermediate leader and tool activity",
        1_700_000_006_000,
        undefined,
        "commentary",
      ),
    },
    ...(ready
      ? [
          {
            history_index: 46,
            message: responseMessage({
              id: "response-single-r1",
              coveredUserMessageIds: ["user-third"],
              content: "Current singleton response",
              timestamp: 1_700_000_007_000,
            }),
          },
          {
            history_index: 47,
            message: assistantMessage(
              "assistant-quiz",
              `{[(Quest Quiz: ${QUEST_ID})]}`,
              1_700_000_008_000,
              undefined,
              "commentary",
            ),
          },
        ]
      : []),
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

function producerThreadWindowWithSeparateReady(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const sync = producerThreadWindow();
  const readyStatus = {
    kind: "ready" as const,
    label: "Thread Ready" as const,
    threadKey: QUEST_ID,
    questId: QUEST_ID,
    summary: "responses complete",
    messageId: "assistant-ready",
    timestamp: 1_700_000_009_000,
    updatedAt: 1_700_000_009_000,
  };
  const readyMessage = assistantMessage(
    "assistant-ready",
    "Ready status published after the answer.",
    readyStatus.timestamp,
    undefined,
    "commentary",
  );
  readyMessage.threadStatusMarkers = [readyStatus];
  const entries = [
    ...sync.entries.filter((entry) => entry.history_index !== 48),
    { history_index: 48, message: readyMessage },
    ...sync.entries.filter((entry) => entry.history_index === 48).map((entry) => ({ ...entry, history_index: 49 })),
  ];
  return {
    ...sync,
    entries,
    window: { ...sync.window, item_count: entries.length, total_items: entries.length, source_history_length: 50 },
  };
}

function producerEarlierQuizThenLaterReadyResponse(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const firstResponseTimestamp = 1_700_000_002_000;
  const laterResponseTimestamp = 1_700_000_005_000;
  const observedHistoryLength = 45;
  const entries = [
    {
      history_index: 40,
      message: userMessage("user-quiz-owner", "Request whose response owns the Quiz", 1_700_000_001_000),
    },
    {
      history_index: 41,
      message: responseMessage({
        id: "response-quiz-owner-r1",
        observedHistoryLength: 41,
        coveredUserMessageIds: ["user-quiz-owner"],
        content: "Earlier response with a same-turn Quiz",
        timestamp: firstResponseTimestamp,
      }),
    },
    {
      history_index: 42,
      message: assistantMessage(
        "assistant-earlier-quiz",
        `{[(Quest Quiz: ${QUEST_ID})]}`,
        1_700_000_003_000,
        undefined,
        "commentary",
      ),
    },
    { history_index: 43, message: userMessage("user-later", "Later request without a Quiz", 1_700_000_004_000) },
    {
      history_index: 44,
      message: responseMessage({
        id: "response-later-r1",
        observedHistoryLength: 44,
        coveredUserMessageIds: ["user-later"],
        content: "Later current response without a Quiz",
        timestamp: laterResponseTimestamp,
      }),
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
      source_history_length: observedHistoryLength,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey: QUEST_ID,
      cutoverHistoryIndex: 40,
      pendingMessageCount: 0,
      pendingMessages: [],
      currentAnswers: [
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u1"],
          referencedUserMessageIds: ["user-quiz-owner"],
          coveredAnswerUserMessageIds: ["u1"],
          coveredUserMessageIds: ["user-quiz-owner"],
          currentMessageId: "response-quiz-owner-r1",
          currentHistoryIndex: 41,
          createdAt: firstResponseTimestamp,
          updatedAt: firstResponseTimestamp,
          source: "explicit",
        },
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u2"],
          referencedUserMessageIds: ["user-later"],
          coveredAnswerUserMessageIds: ["u2"],
          coveredUserMessageIds: ["user-later"],
          currentMessageId: "response-later-r1",
          currentHistoryIndex: 44,
          createdAt: laterResponseTimestamp,
          updatedAt: laterResponseTimestamp,
          source: "explicit",
        },
      ],
      ready: true,
    },
  };
}

function producerLaterAnswerWhileOlderPending(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const entries = [
    {
      history_index: 40,
      message: userMessage("user-older-pending", "Older implementation request", 1_700_000_001_000),
    },
    { history_index: 41, message: userMessage("user-later-answered", "Later clarification", 1_700_000_002_000) },
    {
      history_index: 42,
      message: responseMessage({
        id: "answer-later-clarification",
        observedHistoryLength: 42,
        coveredUserMessageIds: ["user-later-answered"],
        content: "The clarification is fully answered while implementation continues.",
        timestamp: 1_700_000_003_000,
      }),
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
      source_history_length: 43,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey: QUEST_ID,
      cutoverHistoryIndex: 40,
      pendingMessageCount: 1,
      pendingMessages: [
        { userMessageId: "u1", historyMessageId: "user-older-pending", historyIndex: 40, askedAt: 1_700_000_001_000 },
      ],
      currentAnswers: [
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u2"],
          referencedUserMessageIds: ["user-later-answered"],
          coveredAnswerUserMessageIds: ["u2"],
          coveredUserMessageIds: ["user-later-answered"],
          currentMessageId: "answer-later-clarification",
          currentHistoryIndex: 42,
          createdAt: 1_700_000_003_000,
          updatedAt: 1_700_000_003_000,
          source: "explicit",
        },
      ],
      ready: false,
    },
  };
}

function producerAsynchronousAnswerFromLaterTurn(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const answerText = "The earlier request is complete after asynchronous work.";
  const answerTimestamp = 1_700_000_004_000;
  const entries = [
    {
      history_index: 40,
      message: userMessage("user-older-pending", "Earlier asynchronous request", 1_700_000_001_000),
    },
    {
      history_index: 41,
      message: assistantMessage(
        "async-work-progress",
        "The earlier request is still running.",
        1_700_000_002_000,
        undefined,
        "commentary",
      ),
    },
    {
      history_index: 42,
      message: userMessage("user-later-answered", "Later request that triggered completion", 1_700_000_003_000),
    },
    {
      history_index: 43,
      message: responseMessage({
        id: "answer-earlier-from-later-turn",
        observedHistoryLength: 43,
        coveredUserMessageIds: ["user-older-pending"],
        content: `${answerText}\n\n{[(Quest Quiz: ${QUEST_ID})]}`,
        timestamp: answerTimestamp,
      }),
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
      source_history_length: 44,
      section_item_count: 30,
      visible_item_count: entries.length,
    },
    response_state: {
      version: 2,
      threadKey: QUEST_ID,
      cutoverHistoryIndex: 40,
      pendingMessageCount: 1,
      pendingMessages: [
        {
          userMessageId: "u2",
          historyMessageId: "user-later-answered",
          historyIndex: 42,
          askedAt: 1_700_000_003_000,
        },
      ],
      currentAnswers: [
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u1"],
          referencedUserMessageIds: ["user-older-pending"],
          coveredAnswerUserMessageIds: ["u1"],
          coveredUserMessageIds: ["user-older-pending"],
          currentMessageId: "answer-earlier-from-later-turn",
          currentHistoryIndex: 43,
          createdAt: answerTimestamp,
          updatedAt: answerTimestamp,
          source: "explicit",
        },
      ],
      ready: false,
    },
  };
}

function producerFinalResponseOnlyThreadWindow(): Extract<BrowserIncomingMessage, { type: "thread_window_sync" }> {
  const responseTimestamp = 1_700_000_004_000;
  const entries = [
    { history_index: 40, message: userMessage("user-only", "Only pending request", 1_700_000_003_000) },
    {
      history_index: 41,
      message: responseMessage({
        id: "response-only-r1",
        observedHistoryLength: 42,
        coveredUserMessageIds: ["user-only"],
        content: "Only current response",
        timestamp: responseTimestamp,
      }),
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
      source_history_length: 42,
      section_item_count: 30,
      visible_item_count: 10,
    },
    response_state: {
      version: 2,
      threadKey: QUEST_ID,
      cutoverHistoryIndex: 40,
      pendingMessageCount: 0,
      pendingMessages: [],
      currentAnswers: [
        {
          version: 2,
          threadKey: QUEST_ID,
          questId: QUEST_ID,
          answerUserMessageIds: ["u1"],
          referencedUserMessageIds: ["user-only"],
          coveredAnswerUserMessageIds: ["u1"],
          coveredUserMessageIds: ["user-only"],
          currentMessageId: "response-only-r1",
          currentHistoryIndex: 41,
          createdAt: responseTimestamp,
          updatedAt: responseTimestamp,
          source: "explicit",
        },
      ],
      ready: true,
    },
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

function installReadyStatus(timestamp = 1_700_000_010_000, messageId = "response-single-r1") {
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
            messageId,
            timestamp,
            updatedAt: timestamp,
          },
        },
      }),
    }),
  );
}

describe("MessageFeed explicit answer selected-window integration", () => {
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

  it("shows each current answer once after its last prompt and one Quiz when Ready", () => {
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
    const singletonFrame = screen
      .getByText("Current singleton response")
      .closest<HTMLElement>("[data-testid='thread-response-current-expanded']")!;
    expect(singletonFrame).toBeInTheDocument();
    expect(singletonFrame).toHaveClass("border-cc-primary/25");
    expect(singletonFrame).not.toHaveClass("bg-cc-primary/[0.045]");
    expect(within(singletonFrame).getByText("Current answer")).toBeVisible();
    expect(within(singletonFrame).queryByTestId("thread-response-group-provenance")).not.toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);

    const secondTurn = screen.getByText("Second pending request").closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(secondTurn).getByRole("button", { name: /Leader activity/i }));
    const earlier = screen.getByText("Earlier grouped response");
    const current = screen.getByText("Current grouped response");
    expect(earlier).toBeVisible();
    expect(current).toBeVisible();
    expect(earlier.closest("[data-testid='thread-response-current-expanded']")).toBeNull();
    const groupedFrame = current.closest<HTMLElement>("[data-testid='thread-response-current-expanded']")!;
    expect(groupedFrame).toBeInTheDocument();
    expect(within(groupedFrame).getByText("Current answer")).toBeVisible();
    expect(within(groupedFrame).getByTestId("thread-response-group-provenance")).toHaveTextContent(
      "Answers 2 messages",
    );
    expect(earlier.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  });

  it("collapses on a separate fresh Ready commentary row and restores it through manual expansion", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerThreadWindowWithSeparateReady());
      installReadyStatus(1_700_000_009_000, "assistant-ready");
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("Current singleton response")).toBeVisible();
    expect(screen.queryByText("Ready status published after the answer.")).not.toBeInTheDocument();

    const thirdTurn = screen.getByText("Third pending request").closest<HTMLElement>("[data-turn-id]")!;
    const quiz = within(thirdTurn).getByRole("region", { name: "Quest quiz" });
    const expand = within(thirdTurn).getByRole("button", { name: "Expand this turn" });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(quiz.compareDocumentPosition(expand) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    expand.focus();
    fireEvent.click(expand);
    expect(screen.getByText("Ready status published after the answer.")).toBeVisible();
    expect(screen.getByText("Current singleton response")).toBeVisible();
    const collapse = within(thirdTurn).getByRole("button", { name: "Collapse this turn" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(document.activeElement).toBe(collapse);

    fireEvent.click(collapse);
    expect(screen.queryByText("Ready status published after the answer.")).not.toBeInTheDocument();
    expect(screen.getByText("Current singleton response")).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    const restoredExpand = within(thirdTurn).getByRole("button", { name: "Expand this turn" });
    expect(restoredExpand).toBeVisible();
    expect(document.activeElement).toBe(restoredExpand);
  });

  it("keeps an earlier Quiz with its producing turn when a later Ready turn collapses", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerEarlierQuizThenLaterReadyResponse());
      installReadyStatus(1_700_000_006_000, "response-later-r1");
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const quizOwnerTurn = screen
      .getByText("Request whose response owns the Quiz")
      .closest<HTMLElement>("[data-turn-id]")!;
    const laterTurn = screen.getByText("Later request without a Quiz").closest<HTMLElement>("[data-turn-id]")!;
    const quiz = within(quizOwnerTurn).getByRole("region", { name: "Quest quiz" });

    expect(quiz).toBeVisible();
    expect(within(laterTurn).queryByRole("region", { name: "Quest quiz" })).not.toBeInTheDocument();
    expect(quiz.compareDocumentPosition(laterTurn) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);

    fireEvent.click(within(laterTurn).getByRole("button", { name: "Expand this turn" }));
    expect(within(laterTurn).getByText("Later current response without a Quiz")).toBeVisible();
    expect(within(laterTurn).queryByRole("region", { name: "Quest quiz" })).not.toBeInTheDocument();
    fireEvent.click(within(laterTurn).getByRole("button", { name: "Collapse this turn" }));
    expect(within(laterTurn).queryByRole("region", { name: "Quest quiz" })).not.toBeInTheDocument();

    fireEvent.click(within(quizOwnerTurn).getByRole("button", { name: "Expand this turn" }));
    expect(within(quizOwnerTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();
    expect(screen.getAllByRole("region", { name: "Quest quiz" })).toHaveLength(1);
    fireEvent.click(within(quizOwnerTurn).getByRole("button", { name: "Collapse this turn" }));
    expect(within(quizOwnerTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();
  });

  it("keeps a later clarification answer visible while an older request remains pending", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(SESSION_ID, producerLaterAnswerWhileOlderPending());
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(screen.getByText("Older implementation request")).toBeVisible();
    expect(screen.getByText("Later clarification")).toBeVisible();
    expect(screen.getByText("The clarification is fully answered while implementation continues.")).toBeVisible();
    const laterTurn = screen.getByText("Later clarification").closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(laterTurn).getByRole("button", { name: "Collapse this turn" }));
    expect(within(laterTurn).getByTestId("thread-response-current")).toBeVisible();
    expect(
      within(laterTurn).getByText("The clarification is fully answered while implementation continues."),
    ).toBeVisible();
    expect(useStore.getState().threadWindowResponseStates.get(SESSION_ID)?.get(QUEST_ID)).toMatchObject({
      ready: false,
      pendingMessages: [{ userMessageId: "u1" }],
    });
  });

  it("shows one asynchronous answer while its distinct source turn expands and collapses", () => {
    // Relocation is presentation-only: expanding the real source swaps hosts instead of duplicating DOM identity.
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      useStore.getState().upsertQuestDetail(quest(), { etag: '"response-detail"' });
      handleMessage(SESSION_ID, producerAsynchronousAnswerFromLaterTurn());
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const answerText = "The earlier request is complete after asynchronous work.";
    const anchorTurn = screen.getByText("Earlier asynchronous request").closest<HTMLElement>("[data-turn-id]")!;
    const sourceTurn = screen
      .getByText("Later request that triggered completion")
      .closest<HTMLElement>("[data-turn-id]")!;

    expect(screen.getAllByText(answerText)).toHaveLength(1);
    expect(within(sourceTurn).getByText(answerText)).toBeVisible();
    expect(within(sourceTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();

    expect(within(anchorTurn).getByRole("button", { name: "Expand this turn" })).toBeVisible();
    expect(within(anchorTurn).queryByTestId("thread-response-current")).not.toBeInTheDocument();

    fireEvent.click(within(sourceTurn).getByRole("button", { name: "Collapse this turn" }));
    expect(screen.getAllByText(answerText)).toHaveLength(1);
    expect(within(anchorTurn).getByTestId("thread-response-current")).toBeVisible();
    expect(within(anchorTurn).getByText(answerText)).toBeVisible();
    expect(within(sourceTurn).queryByText(answerText)).not.toBeInTheDocument();
    expect(within(sourceTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();

    fireEvent.click(within(sourceTurn).getByRole("button", { name: "Expand this turn" }));
    expect(screen.getAllByText(answerText)).toHaveLength(1);
    expect(within(anchorTurn).queryByTestId("thread-response-current")).not.toBeInTheDocument();
    expect(within(sourceTurn).getByText(answerText)).toBeVisible();
    expect(within(sourceTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();

    fireEvent.click(within(sourceTurn).getByRole("button", { name: "Collapse this turn" }));
    expect(screen.getAllByText(answerText)).toHaveLength(1);
    expect(within(anchorTurn).getByTestId("thread-response-current")).toBeVisible();
    expect(within(sourceTurn).getByRole("region", { name: "Quest quiz" })).toBeVisible();
  });

  it("keeps both explicit toggle states for an answer-only Ready turn", () => {
    act(() => {
      useStore.getState().reset();
      handleMessage(SESSION_ID, { type: "session_init", session: leaderSession() });
      handleMessage(SESSION_ID, producerFinalResponseOnlyThreadWindow());
      installReadyStatus(1_700_000_004_000, "response-only-r1");
    });
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    const turn = screen.getByText("Only pending request").closest<HTMLElement>("[data-turn-id]")!;
    expect(within(turn).queryByRole("button", { name: /Leader activity/i })).not.toBeInTheDocument();
    fireEvent.click(within(turn).getByRole("button", { name: "Expand this turn" }));

    expect(screen.getByText("Only current response")).toBeVisible();
    const collapse = within(turn).getByRole("button", { name: "Collapse this turn" });
    expect(collapse).toBeVisible();
    fireEvent.click(collapse);
    expect(within(turn).getByRole("button", { name: "Expand this turn" })).toBeVisible();
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

    expect(screen.getAllByTestId("thread-response-current")).toHaveLength(1);
    expect(screen.getByText("Intermediate leader and tool activity")).toBeVisible();
    expect(screen.getByText("Current singleton response")).toBeVisible();
    expect(
      screen.getByText("Current singleton response").closest("[data-testid='thread-response-current-expanded']"),
    ).toBeInTheDocument();
  });

  it("keeps prior current-answer identity visible while newer coverage is pending", () => {
    act(() => handleMessage(SESSION_ID, producerThreadWindow(false)));
    render(<MessageFeed sessionId={SESSION_ID} threadKey={QUEST_ID} />);

    expect(useStore.getState().threadWindowResponseStates.get(SESSION_ID)?.get(QUEST_ID)?.ready).toBe(false);
    expect(screen.getAllByTestId("thread-response-current")).toHaveLength(1);
    expect(screen.getByText("Current grouped response")).toBeVisible();
    expect(screen.getByText("Intermediate leader and tool activity")).toBeVisible();
    const secondTurn = screen.getByText("Second pending request").closest<HTMLElement>("[data-turn-id]")!;
    fireEvent.click(within(secondTurn).getByRole("button", { name: /Leader activity/i }));
    expect(screen.getByText("Earlier grouped response")).toBeVisible();
    const current = screen.getByText("Current grouped response");
    const frame = current.closest<HTMLElement>("[data-testid='thread-response-current-expanded']")!;
    expect(frame).toBeInTheDocument();
    expect(within(frame).getByTestId("thread-response-group-provenance")).toHaveTextContent("Answers 2 messages");
  });
});
