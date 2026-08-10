// @vitest-environment jsdom

const mockScrollIntoView = vi.fn();
const mockScrollTo = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = mockScrollIntoView;
  Element.prototype.scrollTo = mockScrollTo;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChatMessage, SessionAttentionRecord, ThreadTransitionMarker } from "../types.js";
import {
  THREAD_ROUTING_REMINDER_SOURCE_ID,
  THREAD_ROUTING_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-routing-reminder.js";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

const mockStoreValues: Record<string, unknown> = {};
const mockToggleTurnActivity = vi.fn();
const mockFocusTurn = vi.fn();
const mockClearScrollToTurn = vi.fn();
const mockClearScrollToMessage = vi.fn();
const mockSetActiveTaskTurnId = vi.fn();
const mockKeepTurnExpanded = vi.fn();
const mockSetCollapsibleTurnIds = vi.fn();
const mockSetFeedScrollPosition = vi.fn();
const mockCollapseAllTurnActivity = vi.fn();
const mockClearBottomAlignOnNextUserMessage = vi.fn();
const mockSetComposerDraft = vi.fn();
const mockRequestScrollToMessage = vi.fn();
const mockSetExpandAllInTurn = vi.fn();
const mockSendToSession: any = vi.fn(() => true);
const mockOpenQuestOverlay = vi.fn();
const mockGetQuestValidated = vi.hoisted(() => vi.fn());

vi.mock("../api.js", () => ({
  api: {
    getQuestValidated: mockGetQuestValidated,
  },
}));

vi.mock("../ws.js", () => ({
  sendToSession: (sessionId: string, msg: any) => mockSendToSession(sessionId, msg),
}));

vi.mock("../store.js", () => {
  const useStore: any = (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      messages: mockStoreValues.messages ?? new Map(),
      messageFrozenCounts: mockStoreValues.messageFrozenCounts ?? new Map(),
      messageFrozenRevisions: mockStoreValues.messageFrozenRevisions ?? new Map(),
      historyLoading: mockStoreValues.historyLoading ?? new Map(),
      historyWindows: mockStoreValues.historyWindows ?? new Map(),
      streaming: mockStoreValues.streaming ?? new Map(),
      streamingByParentToolUseId: mockStoreValues.streamingByParentToolUseId ?? new Map(),
      streamingThinking: mockStoreValues.streamingThinking ?? new Map(),
      streamingThinkingByParentToolUseId: mockStoreValues.streamingThinkingByParentToolUseId ?? new Map(),
      streamingStartedAt: mockStoreValues.streamingStartedAt ?? new Map(),
      streamingOutputTokens: mockStoreValues.streamingOutputTokens ?? new Map(),
      streamingPausedDuration: mockStoreValues.streamingPausedDuration ?? new Map(),
      streamingPauseStartedAt: mockStoreValues.streamingPauseStartedAt ?? new Map(),
      sessionStatus: mockStoreValues.sessionStatus ?? new Map(),
      sessionStuck: mockStoreValues.sessionStuck ?? new Map(),
      sessions: mockStoreValues.sessions ?? new Map(),
      toolProgress: mockStoreValues.toolProgress ?? new Map(),
      toolResults: mockStoreValues.toolResults ?? new Map(),
      toolStartTimestamps: mockStoreValues.toolStartTimestamps ?? new Map(),
      sdkSessions: mockStoreValues.sdkSessions ?? [],
      feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
      turnActivityOverrides: mockStoreValues.turnActivityOverrides ?? new Map(),
      autoExpandedTurnIds: mockStoreValues.autoExpandedTurnIds ?? new Map(),
      toggleTurnActivity: mockToggleTurnActivity,
      scrollToTurnId: mockStoreValues.scrollToTurnId ?? new Map(),
      clearScrollToTurn: mockClearScrollToTurn,
      scrollToMessageId: mockStoreValues.scrollToMessageId ?? new Map(),
      clearScrollToMessage: mockClearScrollToMessage,
      expandAllInTurn: mockStoreValues.expandAllInTurn ?? new Map(),
      clearExpandAllInTurn: vi.fn(),
      bottomAlignNextUserMessage: mockStoreValues.bottomAlignNextUserMessage ?? new Set(),
      sessionTaskHistory: mockStoreValues.sessionTaskHistory ?? new Map(),
      pendingUserUploads: mockStoreValues.pendingUserUploads ?? new Map(),
      pendingCodexInputs: mockStoreValues.pendingCodexInputs ?? new Map(),
      activeTaskTurnId: mockStoreValues.activeTaskTurnId ?? new Map(),
      setActiveTaskTurnId: mockSetActiveTaskTurnId,
      backgroundAgentNotifs: mockStoreValues.backgroundAgentNotifs ?? new Map(),
      sessionNotifications: mockStoreValues.sessionNotifications ?? new Map(),
      sessionAttentionRecords: mockStoreValues.sessionAttentionRecords ?? new Map(),
      sessionBoards: mockStoreValues.sessionBoards ?? new Map(),
      sessionCompletedBoards: mockStoreValues.sessionCompletedBoards ?? new Map(),
      sessionSearch: mockStoreValues.sessionSearch ?? new Map(),
      quests: mockStoreValues.quests ?? [],
      questDetails: mockStoreValues.questDetails ?? new Map(),
      questDetailEtags: mockStoreValues.questDetailEtags ?? new Map(),
      threadWindows: mockStoreValues.threadWindows ?? new Map(),
      threadWindowMessages: mockStoreValues.threadWindowMessages ?? new Map(),
      threadWindowRefreshRevisions: mockStoreValues.threadWindowRefreshRevisions ?? new Map(),
      threadWindowAppliedRevisions: mockStoreValues.threadWindowAppliedRevisions ?? new Map(),
    };
    return selector(state);
  };
  useStore.getState = () => ({
    questDetails: mockStoreValues.questDetails ?? new Map(),
    questDetailEtags: mockStoreValues.questDetailEtags ?? new Map(),
    upsertQuestDetail: (quest: any, opts?: { etag?: string | null }) => {
      const questDetails = new Map((mockStoreValues.questDetails as Map<string, any> | undefined) ?? []);
      questDetails.set(String(quest.questId).toLowerCase(), quest);
      mockStoreValues.questDetails = questDetails;
      if (opts?.etag) {
        const questDetailEtags = new Map((mockStoreValues.questDetailEtags as Map<string, string> | undefined) ?? []);
        questDetailEtags.set(String(quest.questId).toLowerCase(), opts.etag);
        mockStoreValues.questDetailEtags = questDetailEtags;
      }
    },
    feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
    setFeedScrollPosition: mockSetFeedScrollPosition,
    collapseAllTurnActivity: mockCollapseAllTurnActivity,
    setCollapsibleTurnIds: mockSetCollapsibleTurnIds,
    turnActivityOverrides: mockStoreValues.turnActivityOverrides ?? new Map(),
    autoExpandedTurnIds: mockStoreValues.autoExpandedTurnIds ?? new Map(),
    toggleTurnActivity: mockToggleTurnActivity,
    focusTurn: mockFocusTurn,
    keepTurnExpanded: mockKeepTurnExpanded,
    clearBottomAlignOnNextUserMessage: mockClearBottomAlignOnNextUserMessage,
    setComposerDraft: mockSetComposerDraft,
    requestScrollToMessage: mockRequestScrollToMessage,
    setExpandAllInTurn: mockSetExpandAllInTurn,
    openQuestOverlay: mockOpenQuestOverlay,
    sessionNotifications: mockStoreValues.sessionNotifications ?? new Map(),
    sessionAttentionRecords: mockStoreValues.sessionAttentionRecords ?? new Map(),
    removePendingUserUpload: vi.fn(),
    updatePendingUserUpload: vi.fn(),
    focusComposer: vi.fn(),
  });
  return {
    useStore,
    getSessionSearchState: () => ({
      query: "",
      isOpen: false,
      mode: "strict",
      category: "all",
      matches: [],
      currentMatchIndex: -1,
    }),
  };
});

import { MessageFeed } from "./MessageFeed.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function transitionMarker(
  overrides: Partial<ThreadTransitionMarker> & { id: string; sourceThreadKey: string; threadKey: string },
) {
  return {
    type: "thread_transition_marker" as const,
    timestamp: 1,
    markerKey: `thread-transition:${overrides.sourceThreadKey}->${overrides.threadKey}:0`,
    transitionedAt: 1,
    reason: "route_switch" as const,
    questId: overrides.threadKey,
    sourceQuestId: overrides.sourceThreadKey,
    ...overrides,
  };
}

function crossThreadActivityMarker({
  threadKey,
  questId,
  count,
  firstMessageId,
  summary,
}: {
  threadKey: string;
  questId?: string;
  count: number;
  firstMessageId: string;
  summary?: string;
}) {
  return {
    threadKey,
    ...(questId ? { questId } : {}),
    count,
    firstMessageId,
    lastMessageId: firstMessageId,
    ...(summary ? { summary } : {}),
    startedAt: 1,
    updatedAt: 1,
  };
}

function turnEndEventKey(overrides: { interrupted?: boolean } = {}) {
  return [
    "turn_end",
    "worker-2455",
    "stop",
    "24000",
    "",
    overrides.interrupted ? "true" : "",
    overrides.interrupted ? "system" : "",
    "",
    "",
    "",
    "",
    "",
    "q-1799",
    "q-1799",
    "Bash:2",
    "Work finished.",
    "100",
    "120",
    "",
    "",
    "",
    "",
    "",
    "leader",
  ].join("|");
}

function makeHerdEvent(
  id: string,
  content: string,
  eventKey: string | null,
  threadRef: { threadKey: string; questId: string; source: "explicit" },
): ChatMessage {
  return makeMessage({
    id,
    role: "user",
    content,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    ...(eventKey ? { takodeHerdEventKeys: [eventKey] } : {}),
    metadata: { threadRefs: [threadRef] },
  });
}

function makeThreadStatus(
  messageId: string,
  timestamp: number,
  overrides: {
    kind?: "ready" | "waiting";
    label?: "Thread Ready" | "Thread Waiting";
    questId?: string;
    summary?: string;
    threadKey?: string;
  } = {},
) {
  const kind = overrides.kind ?? "ready";
  return {
    kind,
    label: overrides.label ?? (kind === "ready" ? "Thread Ready" : "Thread Waiting"),
    threadKey: overrides.threadKey ?? "q-1814",
    questId: overrides.questId ?? overrides.threadKey ?? "q-1814",
    summary: overrides.summary ?? "revised Slack draft ready",
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

function setStoreMessages(sessionId: string, msgs: ChatMessage[]) {
  const map = new Map();
  map.set(sessionId, msgs);
  mockStoreValues.messages = map;
}

function setStoreTurnOverrides(sessionId: string, overrides: [string, boolean][]) {
  const map = new Map();
  map.set(sessionId, new Map(overrides));
  mockStoreValues.turnActivityOverrides = map;
}

function setStoreAttentionRecords(sessionId: string, records: SessionAttentionRecord[]) {
  const map = new Map();
  map.set(sessionId, records);
  mockStoreValues.sessionAttentionRecords = map;
}

function resetStore() {
  mockToggleTurnActivity.mockReset();
  mockFocusTurn.mockReset();
  mockClearScrollToTurn.mockReset();
  mockClearScrollToMessage.mockReset();
  mockSetActiveTaskTurnId.mockReset();
  mockKeepTurnExpanded.mockReset();
  mockSetCollapsibleTurnIds.mockReset();
  mockSetFeedScrollPosition.mockReset();
  mockCollapseAllTurnActivity.mockReset();
  mockClearBottomAlignOnNextUserMessage.mockReset();
  mockSetComposerDraft.mockReset();
  mockRequestScrollToMessage.mockReset();
  mockSetExpandAllInTurn.mockReset();
  mockOpenQuestOverlay.mockReset();
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockGetQuestValidated.mockReset();
  mockStoreValues.messages = new Map();
  mockStoreValues.messageFrozenCounts = new Map();
  mockStoreValues.messageFrozenRevisions = new Map();
  mockStoreValues.threadWindows = new Map();
  mockStoreValues.threadWindowMessages = new Map();
  mockStoreValues.threadWindowRefreshRevisions = new Map();
  mockStoreValues.threadWindowAppliedRevisions = new Map();
  mockStoreValues.historyWindows = new Map();
  mockStoreValues.streaming = new Map();
  mockStoreValues.streamingByParentToolUseId = new Map();
  mockStoreValues.streamingStartedAt = new Map();
  mockStoreValues.streamingOutputTokens = new Map();
  mockStoreValues.streamingPausedDuration = new Map();
  mockStoreValues.streamingPauseStartedAt = new Map();
  mockStoreValues.sessionStatus = new Map();
  mockStoreValues.sessions = new Map();
  mockStoreValues.sessionNotifications = new Map();
  mockStoreValues.sessionAttentionRecords = new Map();
  mockStoreValues.sessionBoards = new Map();
  mockStoreValues.sessionCompletedBoards = new Map();
  mockStoreValues.toolProgress = new Map();
  mockStoreValues.toolResults = new Map();
  mockStoreValues.toolStartTimestamps = new Map();
  mockStoreValues.turnActivityOverrides = new Map();
  mockStoreValues.autoExpandedTurnIds = new Map();
  mockStoreValues.backgroundAgentNotifs = new Map();
  mockStoreValues.scrollToTurnId = new Map();
  mockStoreValues.scrollToMessageId = new Map();
  mockStoreValues.expandAllInTurn = new Map();
  mockStoreValues.bottomAlignNextUserMessage = new Set();
  mockStoreValues.sessionTaskHistory = new Map();
  mockStoreValues.pendingCodexInputs = new Map();
  mockStoreValues.activeTaskTurnId = new Map();
  mockStoreValues.sdkSessions = [];
  mockStoreValues.quests = [];
  mockStoreValues.questDetails = new Map();
  mockStoreValues.questDetailEtags = new Map();
}

beforeEach(() => {
  resetStore();
  mockScrollIntoView.mockClear();
  mockScrollTo.mockClear();
});

function seedThreadMarkerTurn(sessionId: string) {
  const handoff = transitionMarker({
    id: "transition-main-q941",
    sourceThreadKey: "main",
    threadKey: "q-941",
    questId: "q-941",
  });
  setStoreMessages(sessionId, [
    makeMessage({ id: "u1", role: "user", content: "Coordinate q-941" }),
    makeMessage({
      id: handoff.id,
      role: "system",
      content: "Work continued from Main to thread:q-941",
      variant: "info",
      metadata: { threadTransitionMarker: handoff },
    }),
    makeMessage({
      id: "activity-q941",
      role: "system",
      content: "1 activity in thread:q-941",
      variant: "info",
      metadata: {
        crossThreadActivityMarker: crossThreadActivityMarker({
          threadKey: "q-941",
          questId: "q-941",
          count: 1,
          firstMessageId: "hidden-q941-1",
          summary: "Synthetic hidden q-941 activity",
        }),
      },
    }),
    makeMessage({
      id: "compact-boundary-thread-detail",
      role: "system",
      content: "Conversation compacted",
      variant: "info",
    }),
    makeMessage({ id: "a1", role: "assistant", content: "q-941 handoff noted" }),
    makeMessage({ id: "u2", role: "user", content: "Next request" }),
  ]);
}

function attentionRecord(overrides: Partial<SessionAttentionRecord> & { id: string }): SessionAttentionRecord {
  const createdAt = overrides.createdAt ?? 1;
  const type = overrides.type ?? "needs_input";
  const priority = overrides.priority ?? (type === "quest_journey_started" ? "created" : "needs_input");
  const actionLabel = overrides.actionLabel ?? (priority === "needs_input" ? "Answer" : "Open");
  const threadKey = overrides.threadKey ?? "q-1268";
  const questId = overrides.questId ?? threadKey;
  const title = overrides.title ?? "approve q-1268 latency instrumentation rework plan";
  return {
    leaderSessionId: "test-leader",
    type,
    source: { kind: type === "needs_input" ? "notification" : "board", id: overrides.id, questId },
    questId,
    threadKey,
    title,
    summary: overrides.summary ?? title,
    actionLabel,
    priority,
    state: overrides.state ?? "resolved",
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    route: { threadKey, questId },
    chipEligible: false,
    ledgerEligible: true,
    dedupeKey: overrides.id,
    ...overrides,
  };
}

function seedAttentionNoticeTurn(sessionId: string) {
  setStoreMessages(sessionId, [
    makeMessage({ id: "u1", role: "user", content: "Coordinate Journey notice cleanup", timestamp: 100 }),
    makeMessage({ id: "a1", role: "assistant", content: "Collapsed turn final response", timestamp: 170 }),
    makeMessage({ id: "u2", role: "user", content: "Next request", timestamp: 300 }),
  ]);
  setStoreAttentionRecords(sessionId, [
    attentionRecord({
      id: "journey-start-q1268",
      type: "quest_journey_started",
      source: { kind: "board", id: "q-1268", questId: "q-1268", signature: "started:110" },
      title: "Journey started",
      summary: "Diagnose and fix slow mobile Safari voice transcription progress",
      priority: "created",
      actionLabel: "Open",
      createdAt: 110,
      state: "resolved",
    }),
    attentionRecord({
      id: "approval-q1268",
      title: "approve q-1268 latency instrumentation rework plan",
      summary: "approve q-1268 latency instrumentation rework plan",
      createdAt: 120,
      state: "resolved",
    }),
    attentionRecord({
      id: "journey-finished-q1268",
      type: "quest_completed_recent",
      source: { kind: "board", id: "q-1268", questId: "q-1268", signature: "finished:130" },
      title: "Journey finished",
      summary: "Diagnose and fix slow mobile Safari voice transcription progress",
      priority: "review",
      actionLabel: "Open",
      createdAt: 130,
      state: "unresolved",
      journeyLifecycleStatus: "completed",
    }),
    attentionRecord({
      id: "approval-q1210",
      questId: "q-1210",
      threadKey: "q-1210",
      source: { kind: "notification", id: "approval-q1210", questId: "q-1210" },
      title: "approve q-1210 thread-title voice context rework plan",
      summary: "approve q-1210 thread-title voice context rework plan",
      createdAt: 140,
      state: "resolved",
    }),
  ]);
}

describe("MessageFeed - collapsed thread-detail markers", () => {
  it("keeps reasoning details out of a collapsed turn and restores them for expanded audit", () => {
    const sid = "test-collapsed-reasoning-detail-hidden";
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Inspect the implementation", timestamp: 100 }),
      makeMessage({
        id: "reasoning-1",
        role: "assistant",
        content: "**Checking the route**\n\nFull provider summary.",
        timestamp: 110,
        metadata: { codexReasoningDetail: { status: "complete" } },
      }),
      makeMessage({ id: "a1", role: "assistant", content: "Final visible response", timestamp: 120 }),
      makeMessage({ id: "u2", role: "user", content: "Next request", timestamp: 200 }),
    ]);

    const view = render(<MessageFeed sessionId={sid} />);
    expect(screen.getByText("Final visible response")).toBeTruthy();
    expect(screen.queryByText("Checking the route")).toBeNull();

    setStoreTurnOverrides(sid, [["u1", true]]);
    view.rerender(<MessageFeed sessionId={sid} />);
    expect(screen.getByText("Checking the route")).toBeTruthy();
    expect(screen.getByTestId("codex-reasoning-detail").hasAttribute("open")).toBe(false);
    fireEvent.click(screen.getByText("Checking the route"));
    expect(screen.getByTestId("codex-reasoning-body").textContent).toBe("Full provider summary.");
  });

  it("hides thread-detail marker rows when their containing turn is collapsed", () => {
    // Thread-routing markers remain in producer-shaped message history, but
    // collapsed turns treat them as audit detail instead of always-visible
    // system rows. Non-thread system rows such as compact markers still render.
    const sid = "test-collapsed-thread-detail-markers-hidden";
    seedThreadMarkerTurn(sid);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Coordinate q-941")).toBeTruthy();
    expect(screen.getByText("Conversation compacted")).toBeTruthy();
    expect(screen.getByText("q-941 handoff noted")).toBeTruthy();
    expect(screen.queryByText(/Work continued from Main to thread:q-941/)).toBeNull();
    expect(screen.queryByText(/1 activity in thread:q-941/)).toBeNull();
    expect(screen.queryByTestId("thread-transition-marker")).toBeNull();
    expect(screen.queryByTestId("cross-thread-activity-marker")).toBeNull();
  });

  it("shows thread-detail marker rows when the same turn is expanded", () => {
    // Expanded inspection remains the audit path: the underlying markers are
    // not deleted or rewritten, and their destination controls still render.
    const sid = "test-expanded-thread-detail-markers-visible";
    seedThreadMarkerTurn(sid);
    setStoreTurnOverrides(sid, [["u1", true]]);

    render(<MessageFeed sessionId={sid} onSelectThread={vi.fn()} />);

    const marker = screen.getByTestId("thread-system-marker-cluster");
    expect(marker.textContent).toContain("Work continued from Main to thread:q-941");
    expect(marker.textContent).toContain("1 activity in thread:q-941");
    expect(within(marker).getAllByRole("button", { name: "thread:q-941" }).length).toBeGreaterThan(0);
  });

  it("projects bidirectional mixed marker clusters without empty or duplicate rows", () => {
    // Mirror the reported q-1752 cluster and include the adjacent attachment
    // and activity shapes that share the thread-system marker renderer.
    const sid = "test-directional-bidirectional-transition-cluster";
    const outbound = transitionMarker({ id: "outbound", sourceThreadKey: "q-1752", threadKey: "q-1742" });
    const inbound = transitionMarker({ id: "inbound", sourceThreadKey: "q-1742", threadKey: "q-1752" });
    setStoreMessages(sid, [
      makeMessage({
        id: "attachment",
        role: "system",
        content: "1 message moved to q-1752",
        metadata: {
          threadAttachmentMarker: {
            type: "thread_attachment_marker",
            id: "attachment",
            timestamp: 1,
            markerKey: "thread-attachment:q-1752:context",
            threadKey: "q-1752",
            questId: "q-1752",
            attachedAt: 1,
            attachedBy: "leader",
            messageIds: ["context"],
            messageIndices: [1],
            ranges: ["1"],
            count: 1,
            firstMessageId: "context",
            firstMessageIndex: 1,
          },
        },
      }),
      makeMessage({
        id: outbound.id,
        role: "system",
        content: "Work continued from thread:q-1752 to thread:q-1742",
        metadata: { threadTransitionMarker: outbound },
      }),
      makeMessage({
        id: inbound.id,
        role: "system",
        content: "Work continued from thread:q-1742 to thread:q-1752",
        metadata: { threadTransitionMarker: inbound },
      }),
      makeMessage({
        id: "activity",
        role: "system",
        content: "1 activity in thread:q-1752",
        metadata: {
          threadKey: "q-1752",
          questId: "q-1752",
          crossThreadActivityMarker: crossThreadActivityMarker({
            threadKey: "q-1752",
            questId: "q-1752",
            count: 1,
            firstMessageId: "activity-source",
            summary: "Useful activity detail",
          }),
        },
      }),
    ]);
    const onSelectThread = vi.fn();

    render(<MessageFeed sessionId={sid} threadKey="q-1752" onSelectThread={onSelectThread} />);

    const marker = screen.getByTestId("thread-system-marker-cluster");
    expect(marker.textContent).toContain("Work continued from thread:q-1752 to thread:q-1742");
    expect(marker.textContent).not.toContain("Work continued from thread:q-1742 to thread:q-1752");
    expect(marker.textContent).toContain("1 activity in thread:q-1752");
    expect(screen.queryByText("1 message moved to q-1752")).toBeNull();
    fireEvent.click(within(marker).getByRole("button", { name: "thread:q-1742" }));
    expect(onSelectThread).toHaveBeenCalledWith("q-1742");
  });

  it("hides approval notice rows but keeps Journey notices when a turn is collapsed", () => {
    // Notification-sourced approval ledger records are collapsed-turn detail,
    // while Journey lifecycle records stay visible as orientation markers.
    const sid = "test-collapsed-approval-notices-hidden";
    seedAttentionNoticeTurn(sid);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Journey started")).toBeTruthy();
    expect(screen.getByText("Journey finished")).toBeTruthy();
    expect(screen.getByText("Collapsed turn final response")).toBeTruthy();
    expect(screen.queryByText("approve q-1268 latency instrumentation rework plan")).toBeNull();
    expect(screen.queryByText("approve q-1210 thread-title voice context rework plan")).toBeNull();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });

  it("shows approval notice rows again when the same turn is expanded", () => {
    // Expanded inspection remains the audit path for the same attention records;
    // the collapsed policy must not delete or globally suppress them.
    const sid = "test-expanded-approval-notices-visible";
    seedAttentionNoticeTurn(sid);
    setStoreTurnOverrides(sid, [["u1", true]]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Journey started")).toBeTruthy();
    expect(screen.getByText("Journey finished")).toBeTruthy();
    expect(screen.getByText("approve q-1268 latency instrumentation rework plan")).toBeTruthy();
    expect(screen.getByText("approve q-1210 thread-title voice context rework plan")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Answer" })).toHaveLength(2);
  });

  it("compacts producer-shaped selected-thread herd and work-board event chips around leader prose", () => {
    // Regression for q-1799 feedback #13/#14: collapsed leader turns should
    // hide chip-style herd/work-board events inside worker activity summaries,
    // while preserving leader prose and real decision UI as visible rows.
    const sid = "test-q1799-selected-thread-producer-herd-events";
    const threadRef = { threadKey: "q-1799", questId: "q-1799", source: "explicit" as const };
    const transition = transitionMarker({
      id: "transition-q1799-q1802",
      sourceThreadKey: "q-1799",
      threadKey: "q-1802",
      questId: "q-1802",
    });
    mockStoreValues.sessions = new Map([[sid, { isOrchestrator: true }]]);
    mockStoreValues.sdkSessions = [{ sessionId: sid, isOrchestrator: true }];
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Resume q-1799", metadata: { threadRefs: [threadRef] } }),
      makeMessage({
        id: "a-align",
        role: "assistant",
        content: "Alignment approved; authorizing focused Work.",
        metadata: { leaderUserMessage: true, threadRefs: [threadRef] },
      }),
      makeHerdEvent(
        "herd-interrupted-1",
        "1 event from 1 session\n\n#2455 | turn_end | interrupted",
        turnEndEventKey({ interrupted: true }),
        threadRef,
      ),
      makeHerdEvent(
        "herd-interrupted-2",
        "1 event from 1 session\n\n#2463 | turn_end | interrupted",
        turnEndEventKey({ interrupted: true }),
        threadRef,
      ),
      makeHerdEvent(
        "herd-interrupted-3",
        "1 event from 1 session\n\n#2455 | turn_end | interrupted",
        turnEndEventKey({ interrupted: true }),
        threadRef,
      ),
      makeMessage({
        id: transition.id,
        role: "system",
        content: "Work continued from thread:q-1799 to thread:q-1802",
        metadata: { threadRefs: [threadRef], threadTransitionMarker: transition },
      }),
      makeMessage({
        id: "a-recovery",
        role: "assistant",
        content: "The worker resumed after recovery and is finishing closure.",
        metadata: { leaderUserMessage: true, threadRefs: [threadRef] },
      }),
      makeHerdEvent(
        "herd-session-error",
        "1 event from 1 session\n\n#2455 | session_error | provider authentication failed",
        null,
        threadRef,
      ),
      makeHerdEvent(
        "herd-board-dispatchable",
        "1 event from work board\n\nWork Board | board_dispatchable | q-1801 Show message times from rail markers | q-1801 can be dispatched now | next: Archive or reuse a reclaimable completed worker",
        null,
        threadRef,
      ),
      makeMessage({
        id: "a-done",
        role: "assistant",
        content: "The screenshot-shaped regression is fixed.",
        metadata: { leaderUserMessage: true, threadRefs: [threadRef] },
      }),
      makeMessage({ id: "u2", role: "user", content: "Move to another task", metadata: { threadRefs: [threadRef] } }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1799" />);

    expect(screen.getByText("Alignment approved; authorizing focused Work.")).toBeTruthy();
    expect(screen.getByText("The worker resumed after recovery and is finishing closure.")).toBeTruthy();
    expect(screen.getByText("The screenshot-shaped regression is fixed.")).toBeTruthy();
    expect(screen.getByText("3 worker events")).toBeTruthy();
    expect(screen.getByText("2 worker events")).toBeTruthy();
    expect(screen.queryByText("#2455")).toBeNull();
    expect(screen.queryByText("turn_end")).toBeNull();
    expect(screen.queryByText("session_error")).toBeNull();
    expect(screen.queryByText("board_dispatchable")).toBeNull();
    expect(screen.queryByText(/1 event from work board/)).toBeNull();
  });

  it("keeps final status-bearing leader prose visible before a routing-reminder resend", () => {
    // Live q-1814 regression: the Thread Ready chip was visible but the final
    // Slack-draft prose was hidden inside the compact activity group. The
    // representative message should be the original user-triggered completion
    // prose, not the reminder-triggered duplicate.
    const sid = "test-leader-status-prose-before-routing-reminder";
    const threadRef = { threadKey: "q-1814", questId: "q-1814", source: "explicit" as const };
    const readyStatus = makeThreadStatus("a-final-draft", 5);
    mockStoreValues.sessions = new Map([
      [sid, { isOrchestrator: true, leaderThreadStatuses: { "q-1814": readyStatus } }],
    ]);
    mockStoreValues.sdkSessions = [{ sessionId: sid, isOrchestrator: true }];
    setStoreMessages(sid, [
      makeMessage({
        id: "u1",
        role: "user",
        content: "Please make the wording more natural and give me both metric tables.",
        metadata: { threadRefs: [threadRef] },
      }),
      makeHerdEvent("h-complete", "#2444 | turn_end | ok | q-1814: in_progress -> done", turnEndEventKey(), threadRef),
      makeMessage({
        id: "a-pulling-draft",
        role: "assistant",
        content: "The revised draft and both metric tables are ready. I’m pulling the exact text for review.",
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "tool_use", id: "quest-feedback", name: "Bash", input: { command: "quest feedback show q-1814 5" } },
        ],
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-final-draft",
        role: "assistant",
        content:
          "Yes. The percentage table is `normalized_score >= 0.5`.\n\n**Recommendation:** use the failure-inclusive average-score table in the main post.\n\n### Message 1\n~~~text\nQuick update on our conversation-seeded synthetic coding-QA pipeline.\n~~~",
        metadata: { threadRefs: [threadRef], threadStatusMarkers: [readyStatus] },
      }),
      makeMessage({
        id: "u-routing-reminder",
        role: "user",
        content: "[Thread routing reminder] Missing thread marker on visible leader text.",
        agentSource: {
          sessionId: THREAD_ROUTING_REMINDER_SOURCE_ID,
          sessionLabel: THREAD_ROUTING_REMINDER_SOURCE_LABEL,
        },
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-reminder-resend",
        role: "assistant",
        content:
          "The percentage table is `normalized_score >= 0.5`.\n\n**Recommendation:** use failure-inclusive average score in the main post.",
        metadata: {
          threadRefs: [threadRef],
          threadStatusMarkers: [makeThreadStatus("a-reminder-resend", 7)],
        },
      }),
      makeMessage({
        id: "u2",
        role: "user",
        content: "Please point me to the chaiflow artifacts.",
        metadata: { threadRefs: [threadRef] },
      }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1814" />);

    expect(screen.getByText(/use the failure-inclusive average-score table/)).toBeTruthy();
    expect(screen.getAllByText("Leader activity").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Thread Ready for thread:q-1814: revised Slack draft ready")).toBeTruthy();
    expect(screen.queryByText(/use failure-inclusive average score in the main post/)).toBeNull();
  });

  it("auto-collapses the latest selected leader turn when its thread becomes Ready", () => {
    // Regression coverage for q-1816: a Ready final turn has no following user
    // boundary yet, but should still use the collapsed representative preview.
    const sid = "test-leader-ready-final-turn-auto-collapse";
    const threadRef = { threadKey: "q-1636", questId: "q-1636", source: "explicit" as const };
    const readyStatus = makeThreadStatus("a-final", 5, {
      questId: "q-1636",
      summary: "Copilot feedback and CI resolved",
      threadKey: "q-1636",
    });
    mockStoreValues.sessions = new Map([
      [sid, { isOrchestrator: true, leaderThreadStatuses: { "q-1636": readyStatus } }],
    ]);
    mockStoreValues.sdkSessions = [{ sessionId: sid, isOrchestrator: true }];
    setStoreMessages(sid, [
      makeMessage({
        id: "u1",
        role: "user",
        content: "Close q-1636",
        metadata: { threadRefs: [threadRef] },
      }),
      makeHerdEvent("h-complete", "#2212 | turn_end | ok | q-1636: in_progress -> done", turnEndEventKey(), threadRef),
      makeMessage({
        id: "a-setup",
        role: "assistant",
        content: "[q-1636](quest:q-1636) is complete. I’m checking final status metadata.",
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "tool_use", id: "quest-status", name: "Bash", input: { command: "quest status q-1636" } },
        ],
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-final",
        role: "assistant",
        content: "[q-1636](quest:q-1636) is complete and off the board.\n\nMemory updated: `a4649cb`.",
        metadata: { threadRefs: [threadRef], threadStatusMarkers: [readyStatus] },
      }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1636" />);

    expect(screen.getByText(/\[q-1636\]\(quest:q-1636\) is complete and off the board/)).toBeTruthy();
    expect(screen.getByLabelText("Thread Ready for thread:q-1636: Copilot feedback and CI resolved")).toBeTruthy();
    expect(screen.getAllByText("Leader activity").length).toBeGreaterThan(0);
    expect(screen.queryByText(/checking final status metadata/)).toBeNull();
    expect(screen.queryByText("quest status q-1636")).toBeNull();

    fireEvent.click(screen.getAllByText("Leader activity")[0]!.closest("button")!);
    expect(mockToggleTurnActivity).toHaveBeenCalledWith(sid, "u1", false);
  });

  it("does not auto-collapse the latest selected leader turn for Waiting status", () => {
    const sid = "test-leader-waiting-final-turn-stays-expanded";
    const threadRef = { threadKey: "q-1636", questId: "q-1636", source: "explicit" as const };
    const waitingStatus = makeThreadStatus("a-final", 5, {
      kind: "waiting",
      label: "Thread Waiting",
      questId: "q-1636",
      summary: "waiting on reviewer pass",
      threadKey: "q-1636",
    });
    mockStoreValues.sessions = new Map([
      [sid, { isOrchestrator: true, leaderThreadStatuses: { "q-1636": waitingStatus } }],
    ]);
    mockStoreValues.sdkSessions = [{ sessionId: sid, isOrchestrator: true }];
    setStoreMessages(sid, [
      makeMessage({
        id: "u1",
        role: "user",
        content: "Continue q-1636",
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-tool",
        role: "assistant",
        content: "",
        contentBlocks: [
          { type: "tool_use", id: "quest-status", name: "Bash", input: { command: "quest status q-1636" } },
        ],
        metadata: { threadRefs: [threadRef] },
      }),
      makeMessage({
        id: "a-final",
        role: "assistant",
        content: "Waiting on reviewer pass before closing q-1636.",
        metadata: { threadRefs: [threadRef], threadStatusMarkers: [waitingStatus] },
      }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1636" />);

    expect(screen.queryByText("Leader activity")).toBeNull();
    expect(screen.getByText("quest status q-1636")).toBeTruthy();
    expect(screen.getByText("Waiting on reviewer pass before closing q-1636.")).toBeTruthy();
    expect(screen.getByLabelText("Thread Waiting for thread:q-1636: waiting on reviewer pass")).toBeTruthy();
  });

  it("renders an asynchronously resolved quest quiz inside a selected thread window", async () => {
    // Regression coverage for quest tabs: selected thread windows can contain
    // the completion message before the frontend has full quest quiz metadata.
    // The hidden directive should fetch detail and then render the inline quiz.
    const sid = "test-thread-window-quest-quiz";
    const threadWindow = {
      thread_key: "q-1652",
      from_item: 0,
      item_count: 1,
      total_items: 1,
      source_history_length: 1,
      section_item_count: 30,
      visible_item_count: 10,
    };
    mockGetQuestValidated.mockResolvedValueOnce({
      status: "fresh",
      etag: '"q-1652-detail"',
      data: {
        id: "q-1652-v3",
        questId: "q-1652",
        version: 3,
        title: "Investigate spurious turn-end events",
        status: "done",
        createdAt: 1,
        quizItems: [
          {
            id: "codex-retry-boundary",
            question: "What boundary caused the misleading turn_end?",
            answer: "The internal Codex retry boundary.",
          },
        ],
      },
    });
    mockStoreValues.sessions = new Map([[sid, { isOrchestrator: true }]]);
    mockStoreValues.sdkSessions = [{ sessionId: sid, isOrchestrator: true }];
    mockStoreValues.quests = [
      {
        preview: true,
        id: "q-1652-v3",
        questId: "q-1652",
        version: 3,
        title: "Investigate spurious turn-end events",
        status: "done",
        createdAt: 1,
      },
    ];
    const completionContent = "[q-1652](quest:q-1652) is complete.\n\n{[(Quest Quiz: q-1652)]}";
    mockStoreValues.threadWindows = new Map([[sid, new Map([["q-1652", threadWindow]])]]);
    mockStoreValues.threadWindowMessages = new Map([
      [
        sid,
        new Map([
          [
            "q-1652",
            [
              makeMessage({
                id: "assistant-q-1652-complete",
                role: "assistant",
                content: completionContent,
                metadata: {
                  threadKey: "q-1652",
                  questId: "q-1652",
                  threadRefs: [{ threadKey: "q-1652", questId: "q-1652", source: "explicit" }],
                },
              }),
            ],
          ],
        ]),
      ],
    ]);

    const view = render(<MessageFeed sessionId={sid} threadKey="q-1652" />);

    expect(screen.queryByText(/Quest Quiz:/i)).toBeNull();
    await waitFor(() => expect(mockGetQuestValidated).toHaveBeenCalledWith("q-1652", null));
    await waitFor(() =>
      expect((mockStoreValues.questDetails as Map<string, unknown> | undefined)?.has("q-1652")).toBe(true),
    );
    mockStoreValues.threadWindowMessages = new Map([
      [
        sid,
        new Map([
          [
            "q-1652",
            [
              makeMessage({
                id: "assistant-q-1652-complete-refreshed",
                role: "assistant",
                content: completionContent,
                metadata: {
                  threadKey: "q-1652",
                  questId: "q-1652",
                  threadRefs: [{ threadKey: "q-1652", questId: "q-1652", source: "explicit" }],
                },
              }),
            ],
          ],
        ]),
      ],
    ]);

    view.rerender(<MessageFeed sessionId={sid} threadKey="q-1652" />);

    expect((await screen.findByTestId("quest-quiz-inline")).textContent).toContain("q-1652");
    expect(screen.getByText("What boundary caused the misleading turn_end?")).toBeTruthy();
  });
});
