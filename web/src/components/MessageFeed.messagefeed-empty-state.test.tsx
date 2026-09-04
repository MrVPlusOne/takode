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
import type { ChatMessage } from "../types.js";
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
      pendingUserUploadRestorations: mockStoreValues.pendingUserUploadRestorations ?? new Map(),
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

function setStorePendingUserUploadRestorations(sessionId: string, uploads: Array<Record<string, unknown>>) {
  const map = new Map();
  map.set(sessionId, new Map(uploads.map((upload) => [upload.id, upload])));
  mockStoreValues.pendingUserUploadRestorations = map;
}

function setStoreNotifications(sessionId: string, notifications: Array<Record<string, unknown>>) {
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
  mockStoreValues.pendingUserUploads = new Map();
  mockStoreValues.pendingUserUploadRestorations = new Map();
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

describe("MessageFeed - empty state", () => {
  it("shows empty state when no messages and no streaming", () => {
    const sid = "test-empty";
    setStoreMessages(sid, []);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Start a conversation")).toBeTruthy();
    expect(screen.getByText(/Send a message to begin/)).toBeTruthy();
  });

  it("does not show empty state when there are messages", () => {
    const sid = "test-not-empty";
    setStoreMessages(sid, [makeMessage({ role: "user", content: "Hello" })]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
  });

  it("shows pending Codex inputs instead of the empty state", () => {
    const sid = "test-pending-codex";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Steer the active turn toward auth fixes",
        timestamp: Date.now(),
        cancelable: true,
        draftImages: [],
      },
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Pending delivery")).toBeTruthy();
    expect(screen.getByText(/Steer the active turn toward auth fixes/)).toBeTruthy();
  });

  // Pending delivery follows reliable thread metadata, while unmapped inputs
  // stay visible so the UI does not hide a delivery state it cannot route.
  it("shows routed pending Codex inputs in their owning thread tab", () => {
    const sid = "test-pending-codex-owner-thread";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Continue q-1546 implementation",
        timestamp: Date.now(),
        cancelable: true,
        threadKey: "q-1546",
        questId: "q-1546",
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1546" />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Pending delivery")).toBeTruthy();
    expect(screen.getByText(/Continue q-1546 implementation/)).toBeTruthy();
  });

  it("hides routed pending Codex inputs from unrelated thread tabs", () => {
    const sid = "test-pending-codex-unrelated-thread";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Continue q-1546 implementation",
        timestamp: Date.now(),
        cancelable: true,
        threadKey: "q-1546",
        questId: "q-1546",
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1536" />);

    expect(screen.queryByText("Pending delivery")).toBeNull();
    expect(screen.queryByText(/Continue q-1546 implementation/)).toBeNull();
    expect(screen.getByText("Start a conversation")).toBeTruthy();
  });

  it("hides routed pending Codex inputs from Main when a quest thread owns them", () => {
    const sid = "test-pending-codex-main-thread";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Continue q-1546 implementation",
        timestamp: Date.now(),
        cancelable: true,
        threadKey: "q-1546",
        questId: "q-1546",
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="main" />);

    expect(screen.queryByText("Pending delivery")).toBeNull();
    expect(screen.queryByText(/Continue q-1546 implementation/)).toBeNull();
    expect(screen.getByText("Start a conversation")).toBeTruthy();
  });

  it("keeps routed pending Codex inputs visible in All Threads", () => {
    const sid = "test-pending-codex-all-threads";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Continue q-1546 implementation",
        timestamp: Date.now(),
        cancelable: true,
        threadKey: "q-1546",
        questId: "q-1546",
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="all" />);

    expect(screen.getByText("Pending delivery")).toBeTruthy();
    expect(screen.getByText(/Continue q-1546 implementation/)).toBeTruthy();
  });

  it("keeps unmapped pending Codex inputs visible instead of guessing a thread", () => {
    const sid = "test-pending-codex-unmapped";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [
      {
        id: "pending-1",
        content: "Preserve unknown-route pending input",
        timestamp: Date.now(),
        cancelable: true,
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1536" />);

    expect(screen.getByText("Pending delivery")).toBeTruthy();
    expect(screen.getByText(/Preserve unknown-route pending input/)).toBeTruthy();
  });

  it("keeps pending-upload timing in normal feeds and hides it in Leader feeds", () => {
    // Pending local messages follow the same Leader-only inline timing boundary as persisted messages.
    const sid = "test-pending-upload-inline-timing";
    const timestamp = new Date(2026, 8, 4, 11, 48).getTime();
    setStoreMessages(sid, []);
    setStorePendingUserUploads(sid, [
      {
        id: "pending-upload-timing",
        content: "Pending timing boundary",
        timestamp,
        stage: "delivering",
        images: [],
      },
    ]);

    const normalFeed = render(<MessageFeed sessionId={sid} />);

    expect(screen.getByTestId("message-timestamp").textContent).toContain(
      new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
    );

    normalFeed.unmount();
    setStoreSdkSessionRole(sid, { isOrchestrator: true });
    render(<MessageFeed sessionId={sid} />);

    expect(screen.getByText("Pending timing boundary")).toBeTruthy();
    expect(screen.queryByTestId("message-timestamp")).toBeNull();
  });

  it("renders prepared local messages as pending delivery while awaiting server acknowledgement", () => {
    const sid = "test-pending-local-upload";
    setStoreMessages(sid, []);
    setStorePendingUserUploads(sid, [
      {
        id: "pending-upload-1",
        content: "Inspect this screenshot",
        timestamp: Date.now(),
        stage: "delivering",
        images: [
          {
            id: "draft-image-1",
            name: "attachment-1.png",
            base64: "ZmFrZQ==",
            mediaType: "image/png",
            status: "ready",
            prepared: {
              imageRef: { imageId: "img-1", media_type: "image/png" },
              path: "/tmp/img.png",
            },
          },
        ],
      },
    ]);

    render(<MessageFeed sessionId={sid} />);

    expect(screen.queryByText("Start a conversation")).toBeNull();
    expect(screen.getByText("Pending delivery")).toBeTruthy();
    expect(screen.getByText("Sending…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open image attachment-1.png" }).hasAttribute("disabled")).toBe(false);
    expect(screen.queryByTestId("image-preview-loading-placeholder")).toBeNull();
    const image = screen.getByTestId("image-preview-thumbnail-image") as HTMLImageElement;
    expect(image.src).toContain("data:image/png;base64,ZmFrZQ==");
  });

  it("shows pre-admission rejection as one editable local delivery failure without unsafe retry", () => {
    const sid = "test-local-delivery-failed";
    setStoreMessages(sid, []);
    setStorePendingUserUploads(sid, [
      {
        id: "pending-text-oversized",
        content: "Shorten this oversized request",
        timestamp: Date.now(),
        stage: "failed",
        error: "Codex input is too large to queue safely. The message was not sent to Codex.",
        threadKey: "q-1958",
        questId: "q-1958",
        images: [],
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1958" />);

    expect(screen.getAllByText("Delivery failed")).toHaveLength(1);
    expect(
      screen.getByText("Codex input is too large to queue safely. The message was not sent to Codex."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("retries a failed local Codex owner as an explicit composer message", () => {
    const sid = "test-local-delivery-retry";
    setStoreMessages(sid, []);
    setStorePendingUserUploads(sid, [
      {
        id: "pending-client-retry",
        content: "Retry this exact reply",
        timestamp: Date.now(),
        stage: "failed",
        error: "Connection lost before delivery.",
        replyContext: { messageId: "reply-target", previewText: "Original prompt" },
        threadKey: "q-1958",
        questId: "q-1958",
        images: [],
        prepared: { deliveryContent: "Retry this exact reply", imageRefs: [] },
      },
    ]);

    render(<MessageFeed sessionId={sid} threadKey="q-1958" />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(mockSendToSession).toHaveBeenCalledWith(sid, {
      type: "user_message",
      content: "Retry this exact reply",
      deliveryContent: "Retry this exact reply",
      imageRefs: [],
      replyContext: { messageId: "reply-target", previewText: "Original prompt" },
      threadKey: "q-1958",
      questId: "q-1958",
      session_id: sid,
      client_msg_id: "pending-client-retry",
      inputSource: "composer",
    });
  });

  it("prefers the authoritative Codex pending row over a matching local send card", () => {
    const sid = "test-canonical-pending-image";
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingUserUploads(sid, [
      {
        id: "pending-client-1",
        content: "Inspect this screenshot",
        timestamp: Date.now(),
        stage: "delivering",
        threadKey: "q-1958",
        questId: "q-1958",
        images: [
          {
            id: "draft-image-1",
            name: "attachment-1.png",
            base64: "ZmFrZQ==",
            mediaType: "image/png",
            status: "ready",
            prepared: { imageRef: { imageId: "img-1", media_type: "image/png" }, path: "/tmp/img.png" },
          },
        ],
      },
    ]);
    setStorePendingCodexInputs(sid, [
      {
        id: "server-pending-1",
        clientMsgId: "pending-client-1",
        content: "Inspect this screenshot",
        timestamp: Date.now(),
        cancelable: true,
        threadKey: "q-1958",
        questId: "q-1958",
        imageRefs: ["img-1", "img-2", "img-3", "img-4"].map((imageId) => ({
          imageId,
          media_type: "image/png",
        })),
      },
    ]);
    setStorePendingUserUploadRestorations(sid, [
      {
        id: "pending-client-1",
        content: "Inspect this screenshot",
        timestamp: Date.now(),
        stage: "delivering",
        images: [
          {
            id: "draft-image-1",
            name: "attachment-1.png",
            base64: "ZmFrZQ==",
            mediaType: "image/png",
            status: "ready",
            prepared: { imageRef: { imageId: "img-1", media_type: "image/png" }, path: "/tmp/img.png" },
          },
        ],
      },
    ]);

    const originBrowser = render(<MessageFeed sessionId={sid} threadKey="q-1958" />);

    expect(screen.getAllByText("Pending delivery")).toHaveLength(1);
    expect(screen.getAllByText("Inspect this screenshot")).toHaveLength(1);
    expect(screen.queryByText("Sending…")).toBeNull();
    expect(screen.queryByAltText("attachment-1.png")).toBeNull();
    expect(screen.getByRole("button", { name: "Open image attachment-1.png" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getAllByRole("button", { name: /Loading image img-/ })).toHaveLength(3);
    expect(screen.getAllByTestId("image-preview-thumbnail-image")[0]?.getAttribute("src")).toBe(
      "data:image/png;base64,ZmFrZQ==",
    );

    // A second browser has no origin-local preview state, but the same server
    // snapshot still produces exactly one canonical row with every image slot.
    originBrowser.unmount();
    setStorePendingUserUploads(sid, []);
    setStorePendingUserUploadRestorations(sid, []);
    render(<MessageFeed sessionId={sid} threadKey="q-1958" />);
    expect(screen.getAllByText("Pending delivery")).toHaveLength(1);
    expect(screen.getAllByText("Inspect this screenshot")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Loading image img-/ })).toHaveLength(4);
  });

  it("renders persisted server failure once with exact retry and origin-only edit actions", () => {
    const sid = "test-failed-server-pending";
    const failedInput = {
      id: "server-failed-1",
      clientMsgId: "pending-client-1",
      content: "Inspect this failed screenshot",
      timestamp: Date.now(),
      cancelable: true,
      threadKey: "q-1958",
      questId: "q-1958",
      deliveryState: "failed",
      failureReason: "nonrecoverable_turn_start",
      failureMessage: "Codex rejected this input before delivery.",
      failedAt: Date.now(),
    };
    setStoreMessages(sid, []);
    setStoreSessionBackend(sid, "codex");
    setStorePendingCodexInputs(sid, [failedInput]);
    setStorePendingUserUploadRestorations(sid, [
      {
        id: "pending-client-1",
        content: failedInput.content,
        timestamp: failedInput.timestamp,
        stage: "delivering",
        threadKey: "q-1958",
        questId: "q-1958",
        images: [],
      },
    ]);

    const originBrowser = render(<MessageFeed sessionId={sid} threadKey="q-1958" />);

    expect(screen.getAllByText("Delivery failed")).toHaveLength(1);
    expect(screen.getByText("Codex rejected this input before delivery.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mockSendToSession).toHaveBeenCalledWith(sid, { type: "retry_pending_codex_input", id: failedInput.id });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(mockSendToSession).toHaveBeenCalledWith(sid, { type: "cancel_pending_codex_input", id: failedInput.id });

    // A non-origin browser receives the same authoritative failed row but does
    // not invent editable local attachment state.
    originBrowser.unmount();
    setStorePendingUserUploadRestorations(sid, []);
    render(<MessageFeed sessionId={sid} threadKey="q-1958" />);
    expect(screen.getAllByText("Delivery failed")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mockSendToSession).toHaveBeenCalledWith(sid, { type: "cancel_pending_codex_input", id: failedInput.id });
  });

  it("scopes prepared local delivery state to its owning quest thread", () => {
    const sid = "test-local-pending-owner-thread";
    setStoreMessages(sid, []);
    setStorePendingUserUploads(sid, [
      {
        id: "pending-client-1",
        content: "Only q-1958 should show this",
        timestamp: Date.now(),
        stage: "delivering",
        threadKey: "q-1958",
        questId: "q-1958",
        images: [],
      },
    ]);

    const { rerender } = render(<MessageFeed sessionId={sid} threadKey="q-1958" />);
    expect(screen.getByText("Only q-1958 should show this")).toBeTruthy();

    rerender(<MessageFeed sessionId={sid} threadKey="q-1952" />);
    expect(screen.queryByText("Only q-1958 should show this")).toBeNull();
    expect(screen.queryByText("Pending delivery")).toBeNull();
    expect(screen.getByText("Start a conversation")).toBeTruthy();
  });
});
