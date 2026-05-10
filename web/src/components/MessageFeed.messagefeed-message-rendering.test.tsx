// @vitest-environment jsdom

// jsdom does not implement scrollIntoView; polyfill it before any React rendering
const mockScrollIntoView = vi.fn();
const mockScrollTo = vi.fn();
const mediaState = { touchDevice: false };

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
      matches: query === "(hover: none) and (pointer: coarse)" ? mediaState.touchDevice : false,
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

import { render, screen, fireEvent, act, within } from "@testing-library/react";
import type { ChatMessage, SessionNotification } from "../types.js";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";

// Mock react-markdown to avoid ESM issues in tests
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

// Build a mock for the store that returns configurable values per session
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
const mockSendToSession: any = vi.fn(() => true);

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
      sessionSearch: mockStoreValues.sessionSearch ?? new Map(),
    };
    return selector(state);
  };
  useStore.getState = () => ({
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
    removePendingUserUpload: vi.fn(),
    updatePendingUserUpload: vi.fn(),
    focusComposer: vi.fn(),
  });
  return {
    useStore,
    getSessionSearchState: (state: Record<string, unknown>, _sessionId: string) => {
      return { query: "", isOpen: false, mode: "strict", category: "all", matches: [], currentMatchIndex: -1 };
    },
    sessionSearchMessageMatchesCategory: () => true,
  };
});

import {
  MessageFeed,
  ElapsedTimer,
  buildFeedSections,
  findActiveTaskTurnIdForScroll,
  findSectionWindowStartIndexForTarget,
  findVisibleSectionEndIndex,
  findVisibleSectionStartIndex,
} from "./MessageFeed.js";

function makeMessage(overrides: Partial<ChatMessage> & { role: ChatMessage["role"] }): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    content: "",
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeFeedEntryMessage(msg: ChatMessage): FeedEntry {
  return { kind: "message", msg };
}

function makeTurnForSections({
  id,
  userEntry = null,
  systemEntries = [],
  agentEntries = [],
  responseEntry = null,
}: {
  id: string;
  userEntry?: FeedEntry | null;
  systemEntries?: FeedEntry[];
  agentEntries?: FeedEntry[];
  responseEntry?: FeedEntry | null;
}): Turn {
  return {
    id,
    userEntry,
    allEntries: [...systemEntries, ...agentEntries, ...(responseEntry ? [responseEntry] : [])],
    agentEntries,
    systemEntries,
    notificationEntries: [],
    responseEntry,
    subConclusions: [],
    stats: {
      messageCount: 0,
      toolCount: 0,
      subagentCount: 0,
      herdEventCount: 0,
    },
  };
}

function makeSectionTurns(totalTurns: number): Turn[] {
  return Array.from({ length: totalTurns }, (_, index) => {
    const turnNumber = index + 1;
    return makeTurnForSections({
      id: `turn-${turnNumber}`,
      userEntry: makeFeedEntryMessage(
        makeMessage({
          id: `u${turnNumber}`,
          role: "user",
          content: `Turn ${turnNumber}`,
        }),
      ),
    });
  });
}

function makeSectionedMessages(sectionCount: number, turnsPerSection = 50): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let timestamp = 1_700_000_000_000;

  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
    for (let turnIndex = 0; turnIndex < turnsPerSection; turnIndex++) {
      const turnNumber = sectionIndex * turnsPerSection + turnIndex + 1;
      const label =
        turnIndex === 0 ? `Section ${sectionIndex + 1} marker` : `Section ${sectionIndex + 1} turn ${turnIndex + 1}`;
      messages.push(
        makeMessage({
          id: `u${turnNumber}`,
          role: "user",
          content: label,
          timestamp: timestamp++,
        }),
      );
    }
  }

  return messages;
}

function setStoreMessages(sessionId: string, msgs: ChatMessage[]) {
  const map = new Map();
  map.set(sessionId, msgs);
  mockStoreValues.messages = map;
}

function setStoreStreaming(sessionId: string, text: string | undefined) {
  const map = new Map();
  if (text !== undefined) map.set(sessionId, text);
  mockStoreValues.streaming = map;
}

function setStoreThinking(sessionId: string, text: string | undefined) {
  const map = new Map();
  if (text !== undefined) map.set(sessionId, text);
  mockStoreValues.streamingThinking = map;
}

function setStorePendingCodexInputs(sessionId: string, inputs: Array<Record<string, unknown>>) {
  const map = new Map();
  map.set(sessionId, inputs);
  mockStoreValues.pendingCodexInputs = map;
}

function setStorePendingUserUploads(sessionId: string, uploads: Array<Record<string, unknown>>) {
  const map = new Map();
  map.set(sessionId, uploads);
  mockStoreValues.pendingUserUploads = map;
}

function setStoreNotifications(sessionId: string, notifications: Array<Record<string, unknown> | SessionNotification>) {
  const map = new Map();
  map.set(sessionId, notifications);
  mockStoreValues.sessionNotifications = map;
}

function setStoreHistoryLoading(sessionId: string, loading: boolean) {
  const map = new Map();
  if (loading) map.set(sessionId, true);
  mockStoreValues.historyLoading = map;
}

function setStoreFeedScrollPosition(
  sessionId: string,
  pos: {
    scrollTop: number;
    scrollHeight: number;
    isAtBottom: boolean;
    anchorTurnId?: string | null;
    anchorOffsetTop?: number;
    lastSeenContentBottom?: number | null;
  },
) {
  const map = new Map();
  map.set(sessionId, pos);
  mockStoreValues.feedScrollPosition = map;
}

function setStoreParentStreaming(sessionId: string, entries: Record<string, string>) {
  const map = new Map();
  map.set(sessionId, new Map(Object.entries(entries)));
  mockStoreValues.streamingByParentToolUseId = map;
}

function setStoreParentThinking(sessionId: string, entries: Record<string, string>) {
  const map = new Map();
  map.set(sessionId, new Map(Object.entries(entries)));
  mockStoreValues.streamingThinkingByParentToolUseId = map;
}

function setStoreStatus(sessionId: string, status: string | null) {
  const statusMap = new Map();
  if (status) statusMap.set(sessionId, status);
  mockStoreValues.sessionStatus = statusMap;
}

function setStoreSessionBackend(sessionId: string, backend: "claude" | "codex") {
  const map = new Map();
  map.set(sessionId, { backend_type: backend });
  mockStoreValues.sessions = map;
}

function setStoreSessionState(sessionId: string, session: Record<string, unknown>) {
  const map = new Map();
  map.set(sessionId, session);
  mockStoreValues.sessions = map;
}

function setStoreStreamingStartedAt(sessionId: string, startedAt: number | undefined) {
  const map = new Map();
  if (startedAt !== undefined) map.set(sessionId, startedAt);
  mockStoreValues.streamingStartedAt = map;
}

function setStoreStreamingOutputTokens(sessionId: string, tokens: number | undefined) {
  const map = new Map();
  if (tokens !== undefined) map.set(sessionId, tokens);
  mockStoreValues.streamingOutputTokens = map;
}

function setStoreToolProgress(
  sessionId: string,
  entries: Array<{ toolUseId: string; toolName: string; elapsedSeconds: number; output?: string }>,
) {
  const toolProgressMap = new Map();
  const sessionProgress = new Map();
  for (const entry of entries) {
    sessionProgress.set(entry.toolUseId, {
      toolName: entry.toolName,
      elapsedSeconds: entry.elapsedSeconds,
      ...(entry.output ? { output: entry.output } : {}),
    });
  }
  toolProgressMap.set(sessionId, sessionProgress);
  mockStoreValues.toolProgress = toolProgressMap;
}

function setStoreToolStartTimestamps(sessionId: string, timestamps: Record<string, number>) {
  const map = new Map();
  map.set(sessionId, new Map(Object.entries(timestamps)));
  mockStoreValues.toolStartTimestamps = map;
}

function setStoreToolResults(
  sessionId: string,
  results: Record<string, { content: string; is_truncated: boolean; duration_seconds?: number; is_error?: boolean }>,
) {
  const map = new Map();
  map.set(sessionId, new Map(Object.entries(results)));
  mockStoreValues.toolResults = map;
}

function setStoreSdkSessionRole(sessionId: string, overrides: { isOrchestrator?: boolean; herdedBy?: string } = {}) {
  mockStoreValues.sdkSessions = [
    {
      sessionId,
      state: "connected",
      cwd: "/test",
      createdAt: Date.now(),
      ...(overrides.isOrchestrator ? { isOrchestrator: true } : {}),
      ...(overrides.herdedBy ? { herdedBy: overrides.herdedBy } : {}),
    },
  ];
}

function setStoreScrollToTurn(sessionId: string, turnId: string) {
  const map = new Map();
  map.set(sessionId, turnId);
  mockStoreValues.scrollToTurnId = map;
}

function setStoreScrollToMessage(sessionId: string, messageId: string) {
  const map = new Map();
  map.set(sessionId, messageId);
  mockStoreValues.scrollToMessageId = map;
}

function setStoreBottomAlignNextUserMessage(sessionId: string, enabled = true) {
  const set = new Set<string>();
  if (enabled) set.add(sessionId);
  mockStoreValues.bottomAlignNextUserMessage = set;
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
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockStoreValues.messages = new Map();
  mockStoreValues.messageFrozenCounts = new Map();
  mockStoreValues.messageFrozenRevisions = new Map();
  mockStoreValues.historyWindows = new Map();
  mockStoreValues.streaming = new Map();
  mockStoreValues.streamingByParentToolUseId = new Map();
  mockStoreValues.streamingStartedAt = new Map();
  mockStoreValues.streamingOutputTokens = new Map();
  mockStoreValues.streamingPausedDuration = new Map();
  mockStoreValues.streamingPauseStartedAt = new Map();
  mockStoreValues.sessionStatus = new Map();
  mockStoreValues.sessions = new Map();
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
}

/** Set explicit overrides for turn activity expansion per session.
 *  Each entry: [turnId, expanded: boolean]. */
function setStoreTurnOverrides(sessionId: string, overrides: [string, boolean][]) {
  const map = new Map();
  map.set(sessionId, new Map(overrides));
  mockStoreValues.turnActivityOverrides = map;
}

function setStoreAutoExpandedTurns(sessionId: string, turnIds: string[]) {
  const map = new Map();
  map.set(sessionId, new Set(turnIds));
  mockStoreValues.autoExpandedTurnIds = map;
}

async function flushFeedObservers() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setElementOffsetMetrics(element: HTMLElement, offsetTop: number, offsetHeight: number) {
  Object.defineProperty(element, "offsetTop", {
    configurable: true,
    get() {
      return offsetTop;
    },
  });
  Object.defineProperty(element, "offsetHeight", {
    configurable: true,
    get() {
      return offsetHeight;
    },
  });
}

function setElementClientSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    get() {
      return width;
    },
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get() {
      return height;
    },
  });
}

beforeEach(() => {
  resetStore();
  mockScrollIntoView.mockClear();
  mockScrollTo.mockClear();
  mediaState.touchDevice = false;
});

function makeDomRect(height: number, width = 0): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    bottom: height,
    right: width,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("MessageFeed - message rendering", () => {
  it("renders user and assistant messages", () => {
    const sid = "test-render-msgs";
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "What is 2+2?" }),
      makeMessage({ id: "a1", role: "assistant", content: "The answer is 4." }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("What is 2+2?")).toBeTruthy();
    // The assistant message goes through the mocked Markdown component
    expect(screen.getByText("The answer is 4.")).toBeTruthy();
  });

  it("skips empty assistant messages without blocking later feed entries", () => {
    const sid = "test-empty-assistant-skip";
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Before empty row" }),
      // Some Codex retained histories contain assistant rows with no text,
      // blocks, or notification. FeedEntries must advance past them.
      makeMessage({ id: "empty-a1", role: "assistant", content: "" }),
      makeMessage({ id: "a2", role: "assistant", content: "After empty row" }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Before empty row")).toBeTruthy();
    expect(screen.getByText("After empty row")).toBeTruthy();
  });

  it("renders marker-only thread status messages as compact chips without raw marker text", () => {
    const sid = "test-thread-status-chip";
    const status = {
      kind: "waiting" as const,
      label: "Thread Waiting" as const,
      threadKey: "q-941",
      questId: "q-941",
      summary: "waiting on reviewer pass",
      messageId: "status-a1",
      timestamp: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    setStoreSessionState(sid, { leaderThreadStatuses: { "q-941": status } });
    setStoreMessages(sid, [
      makeMessage({
        id: "status-a1",
        role: "assistant",
        content: "",
        metadata: {
          threadStatusMarkers: [status],
          threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
        },
      }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-941" />);

    expect(screen.getByLabelText("Thread Waiting for thread:q-941: waiting on reviewer pass")).toBeTruthy();
    expect(screen.queryByText(/\{\[\(Thread Waiting:/)).toBeNull();
  });

  it("renders only the current thread status at its latest anchor", () => {
    const sid = "test-thread-status-latest-anchor";
    const oldStatus = {
      kind: "waiting" as const,
      label: "Thread Waiting" as const,
      threadKey: "q-941",
      questId: "q-941",
      summary: "waiting on reviewer pass",
      messageId: "status-old",
      timestamp: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const currentStatus = {
      kind: "ready" as const,
      label: "Thread Ready" as const,
      threadKey: "q-941",
      questId: "q-941",
      summary: "review accepted",
      messageId: "status-new",
      timestamp: 1_700_000_010_000,
      updatedAt: 1_700_000_010_000,
    };
    setStoreSessionState(sid, { leaderThreadStatuses: { "q-941": currentStatus } });
    setStoreMessages(sid, [
      makeMessage({
        id: "status-old",
        role: "assistant",
        content: "",
        metadata: {
          threadStatusMarkers: [oldStatus],
          threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
        },
      }),
      makeMessage({
        id: "status-new",
        role: "assistant",
        content: "",
        metadata: {
          threadStatusMarkers: [currentStatus],
          threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
        },
      }),
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-941" />);

    expect(screen.queryByLabelText("Thread Waiting for thread:q-941: waiting on reviewer pass")).toBeNull();
    expect(screen.getByLabelText("Thread Ready for thread:q-941: review accepted")).toBeTruthy();
  });

  it("keeps Main needs-input UI on the source message while projecting cross-thread status only", () => {
    const sid = "test-thread-status-does-not-route-notification";
    const status = {
      kind: "waiting" as const,
      label: "Thread Waiting" as const,
      threadKey: "q-1262",
      questId: "q-1262",
      summary: "rework Implement queued to worker",
      messageId: "main-prompt",
      timestamp: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    };
    const notification: SessionNotification = {
      id: "n-140",
      category: "needs-input",
      summary: "confirm restart-prep reliability quest and dispatch plan",
      suggestedAnswers: ["approve", "revise scope"],
      timestamp: 1_700_000_000_000,
      messageId: "main-prompt",
      threadKey: "main",
      done: false,
    };
    setStoreSessionState(sid, { leaderThreadStatuses: { "q-1262": status } });
    setStoreNotifications(sid, [notification]);
    setStoreMessages(sid, [
      makeMessage({
        id: "main-prompt",
        role: "assistant",
        content: "Waiting on your confirmation for the restart-prep reliability quest proposal.",
        notification,
        metadata: {
          threadStatusMarkers: [status],
        },
      }),
    ]);

    const mainRender = render(<MessageFeed sessionId={sid} threadKey="main" />);
    expect(
      screen.getByText("Waiting on your confirmation for the restart-prep reliability quest proposal."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Use suggested answer: approve")).toBeTruthy();
    expect(screen.getByLabelText("Use suggested answer: revise scope")).toBeTruthy();
    expect(screen.queryByLabelText("Thread Waiting for thread:q-1262: rework Implement queued to worker")).toBeNull();

    mainRender.unmount();

    render(<MessageFeed sessionId={sid} threadKey="q-1262" />);
    expect(
      screen.queryByText("Waiting on your confirmation for the restart-prep reliability quest proposal."),
    ).toBeNull();
    expect(screen.queryByLabelText("Use suggested answer: approve")).toBeNull();
    expect(screen.queryByLabelText("Use suggested answer: revise scope")).toBeNull();
    expect(screen.getByLabelText("Thread Waiting for thread:q-1262: rework Implement queued to worker")).toBeTruthy();
  });

  it("renders system messages in the feed", () => {
    const sid = "test-system-msg";
    setStoreMessages(sid, [
      makeMessage({ id: "s1", role: "system", content: "Session restored" }),
      makeMessage({ id: "u1", role: "user", content: "Continue" }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Session restored")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("shows model-responding stage while Codex is streaming an image-backed request", () => {
    const sid = "test-responding-image-stage";
    setStoreSessionState(sid, { backend_type: "codex", codex_image_send_stage: "responding" });
    setStoreStatus(sid, "running");
    setStoreStreaming(sid, "Inspecting the uploaded image");
    setStoreStreamingStartedAt(sid, Date.now() - 4_000);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Purring...")).toBeTruthy();
    expect(screen.queryByText("Model responding")).toBeNull();
  });

  it("shows only a date marker for same-day messages, no minute marks", () => {
    // Same-day minute marks were removed (q-249) -- only date-change markers remain.
    // The first message in a session always gets a date marker.
    const sid = "test-smart-timestamps-same-minute";
    const base = new Date("2026-02-25T10:00:00.000Z").getTime();
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "First", timestamp: base + 5_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "Second", timestamp: base + 25_000 }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    // Only the initial date marker, no per-minute markers
    expect(screen.getAllByTestId("minute-boundary-timestamp")).toHaveLength(1);
  });

  it("does not add extra markers when minute changes on same day", () => {
    // Same-day minute marks were removed (q-249) -- minute changes don't add markers.
    // Only the initial date marker appears.
    const sid = "test-smart-timestamps-minute-boundary";
    const base = new Date("2026-02-25T10:00:00.000Z").getTime();
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "M0", timestamp: base + 5_000 }),
      makeMessage({ id: "a1", role: "assistant", content: "M0 response", timestamp: base + 25_000 }),
      makeMessage({ id: "u2", role: "user", content: "M1", timestamp: base + 65_000 }),
      makeMessage({ id: "a2", role: "assistant", content: "M1 response", timestamp: base + 85_000 }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    // Only 1 marker (the initial date), not 2 (would have been 2 with minute marks)
    expect(screen.getAllByTestId("minute-boundary-timestamp")).toHaveLength(1);
  });

  it("shows a date marker when messages cross a day boundary", () => {
    const sid = "test-cross-day-boundary";
    // Use dates far apart to avoid timezone edge cases
    const day1 = new Date("2026-02-25T12:00:00.000Z").getTime();
    const day2 = new Date("2026-02-26T12:00:00.000Z").getTime();
    setStoreMessages(sid, [
      makeMessage({ id: "u1", role: "user", content: "Day one", timestamp: day1 }),
      makeMessage({ id: "a1", role: "assistant", content: "Day two", timestamp: day2 }),
    ]);

    render(<MessageFeed sessionId={sid} />);

    // 2 date markers: one for Feb 25, one for Feb 26
    expect(screen.getAllByTestId("minute-boundary-timestamp")).toHaveLength(2);
  });
});
