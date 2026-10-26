// Mocked store, socket and API plus DOM helpers shared by the MessageFeed section-windowing
// test files. Vitest hoists vi.mock per test file, so each file declares its own mocks and
// points the factories here; they all share mockStoreValues and the vi.fn() instances.
import { act } from "@testing-library/react";
import type { ChatMessage } from "../types.js";
import {
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../../shared/history-window.js";

export const mockScrollIntoView = vi.fn();
export const mockScrollTo = vi.fn();
export const mediaState = { touchDevice: false };

// Build a mock for the store that returns configurable values per session
export const mockStoreValues: Record<string, unknown> = {};
export const mockToggleTurnActivity = vi.fn();
export const mockFocusTurn = vi.fn();
export const mockClearScrollToTurn = vi.fn();
export const mockClearScrollToMessage = vi.fn();
export const mockClearPendingScrollToMessageId = vi.fn();
export const mockSetActiveTaskTurnId = vi.fn();
export const mockKeepTurnExpanded = vi.fn();
export const mockSetCollapsibleTurnIds = vi.fn();
export const mockSetFeedScrollPosition = vi.fn();
export const mockCollapseAllTurnActivity = vi.fn();
export const mockClearBottomAlignOnNextUserMessage = vi.fn();
export const mockSetComposerDraft = vi.fn();
export const mockSendToSession: any = vi.fn(() => true);
export const mockSearchSessionMessages = vi.fn();

export function mockWsModule() {
  return {
    sendToSession: (sessionId: string, msg: any) => mockSendToSession(sessionId, msg),
  };
}

export function mockApiModule() {
  return {
    api: {
      searchSessionMessages: (...args: unknown[]) => mockSearchSessionMessages(...args),
    },
  };
}

export function mockStoreModule() {
  const useStore: any = (selector: (state: Record<string, unknown>) => unknown) => {
    const state = {
      messages: mockStoreValues.messages ?? new Map(),
      composerDrafts: mockStoreValues.composerDrafts ?? new Map(),
      messageFrozenCounts: mockStoreValues.messageFrozenCounts ?? new Map(),
      messageFrozenRevisions: mockStoreValues.messageFrozenRevisions ?? new Map(),
      historyLoading: mockStoreValues.historyLoading ?? new Map(),
      historyWindows: mockStoreValues.historyWindows ?? new Map(),
      streamingStartedAt: mockStoreValues.streamingStartedAt ?? new Map(),
      streamingOutputTokens: mockStoreValues.streamingOutputTokens ?? new Map(),
      streamingPausedDuration: mockStoreValues.streamingPausedDuration ?? new Map(),
      streamingPauseStartedAt: mockStoreValues.streamingPauseStartedAt ?? new Map(),
      connectionStatus: mockStoreValues.connectionStatus ?? new Map(),
      sessionStatus: mockStoreValues.sessionStatus ?? new Map(),
      sessionStuck: mockStoreValues.sessionStuck ?? new Map(),
      sessions: mockStoreValues.sessions ?? new Map(),
      toolProgress: mockStoreValues.toolProgress ?? new Map(),
      toolResults: mockStoreValues.toolResults ?? new Map(),
      toolStartTimestamps: mockStoreValues.toolStartTimestamps ?? new Map(),
      sdkSessions: mockStoreValues.sdkSessions ?? [],
      threadWindows: mockStoreValues.threadWindows ?? new Map(),
      threadWindowMessages: mockStoreValues.threadWindowMessages ?? new Map(),
      threadWindowRefreshRevisions: mockStoreValues.threadWindowRefreshRevisions ?? new Map(),
      threadWindowAppliedRevisions: mockStoreValues.threadWindowAppliedRevisions ?? new Map(),
      pendingThreadWindowRequests: mockStoreValues.pendingThreadWindowRequests ?? new Map(),
      feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
      turnActivityOverrides: mockStoreValues.turnActivityOverrides ?? new Map(),
      autoExpandedTurnIds: mockStoreValues.autoExpandedTurnIds ?? new Map(),
      toggleTurnActivity: mockToggleTurnActivity,
      scrollToTurnId: mockStoreValues.scrollToTurnId ?? new Map(),
      clearScrollToTurn: mockClearScrollToTurn,
      scrollToMessageId: mockStoreValues.scrollToMessageId ?? new Map(),
      pendingScrollToMessageId: mockStoreValues.pendingScrollToMessageId ?? new Map(),
      clearScrollToMessage: mockClearScrollToMessage,
      clearPendingScrollToMessageId: mockClearPendingScrollToMessageId,
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
    pendingThreadWindowRequests: mockStoreValues.pendingThreadWindowRequests ?? new Map(),
    setPendingThreadWindowRequest: (sessionId: string, threadKey: string | null) => {
      const pending = new Map((mockStoreValues.pendingThreadWindowRequests as Map<string, string>) ?? []);
      if (threadKey) pending.set(sessionId, threadKey);
      else pending.delete(sessionId);
      mockStoreValues.pendingThreadWindowRequests = pending;
    },
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
}

export function setStoreMessages(sessionId: string, msgs: ChatMessage[]) {
  const map = new Map();
  map.set(sessionId, msgs);
  mockStoreValues.messages = map;
}

export function setStoreHistoryLoading(sessionId: string, loading: boolean) {
  const map = new Map();
  if (loading) map.set(sessionId, true);
  mockStoreValues.historyLoading = map;
}

export function setStoreConnectionStatus(sessionId: string, status: "connecting" | "connected" | "disconnected") {
  mockStoreValues.connectionStatus = new Map([[sessionId, status]]);
}

export function setStoreHistoryWindow(sessionId: string) {
  mockStoreValues.historyWindows = new Map([
    [
      sessionId,
      {
        from_turn: 7,
        turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT * HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
        total_turns: 37,
        has_older_items: true,
        has_newer_items: false,
        start_index: 7,
        section_turn_count: HISTORY_WINDOW_SECTION_TURN_COUNT,
        visible_section_count: HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
      },
    ],
  ]);
}

export function setStoreFeedScrollPosition(
  sessionId: string,
  pos: {
    scrollTop: number;
    scrollHeight: number;
    isAtBottom: boolean;
    anchorMessageId?: string | null;
    anchorTurnId?: string | null;
    anchorOffsetTop?: number;
    lastSeenContentBottom?: number | null;
  },
  threadKey = "main",
) {
  const map = new Map();
  map.set(sessionId, pos);
  map.set(`${sessionId}:thread:${threadKey}`, pos);
  mockStoreValues.feedScrollPosition = map;
}

export function setStoreThreadReadingPosition(sessionId: string, threadKey: string, messageId: string) {
  setStoreFeedScrollPosition(
    sessionId,
    {
      scrollTop: 0,
      scrollHeight: 1,
      isAtBottom: false,
      anchorMessageId: messageId,
    },
    threadKey,
  );
}

export function setStoreSessionState(sessionId: string, session: Record<string, unknown>) {
  const map = new Map();
  map.set(sessionId, session);
  mockStoreValues.sessions = map;
}

export function setStoreSdkSessionRole(
  sessionId: string,
  overrides: { isOrchestrator?: boolean; herdedBy?: string } = {},
) {
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

export function setStoreScrollToTurn(sessionId: string, turnId: string) {
  const map = new Map();
  map.set(sessionId, turnId);
  mockStoreValues.scrollToTurnId = map;
}

export function setStoreScrollToMessage(sessionId: string, messageId: string) {
  const map = new Map();
  map.set(sessionId, messageId);
  mockStoreValues.scrollToMessageId = map;
}

export function getDefaultSearchMessages(sessionId: string, options: { scope?: string; threadKey?: string | null }) {
  if (options.scope === "current_thread" && options.threadKey) {
    const threadMessages = mockStoreValues.threadWindowMessages as Map<string, Map<string, ChatMessage[]>> | undefined;
    return threadMessages?.get(sessionId)?.get(options.threadKey) ?? [];
  }
  const messages = mockStoreValues.messages as Map<string, ChatMessage[]> | undefined;
  return messages?.get(sessionId) ?? [];
}

export function buildMessageSearchResponse(
  sessionId: string,
  options: { scope?: string; threadKey?: string | null } = {},
  messages = getDefaultSearchMessages(sessionId, options),
) {
  const results = messages
    .filter((message) => message.role === "user" || message.metadata?.leaderUserMessage === true)
    .map((message, index) => ({
      id: `${sessionId}:${message.id}`,
      sessionId,
      sessionNum: null,
      messageId: message.id,
      historyIndex: message.historyIndex ?? index,
      role: message.role,
      category: "user",
      timestamp: message.timestamp,
      snippet: message.content,
      fullText: message.content,
      ...(options.threadKey ? { routeThreadKey: options.threadKey, sourceThreadKey: options.threadKey } : {}),
    }));

  return {
    sessionId,
    sessionNum: null,
    query: "",
    scope:
      options.scope === "current_thread"
        ? { kind: "current_thread", threadKey: options.threadKey ?? "main", label: "Current thread" }
        : { kind: "session", label: "Session" },
    filters: { user: true, assistant: true, event: false },
    totalMatches: results.length,
    results,
    nextOffset: null,
    hasMore: false,
    tookMs: 1,
  };
}

function resetStore() {
  mockToggleTurnActivity.mockReset();
  mockFocusTurn.mockReset();
  mockClearScrollToTurn.mockReset();
  mockClearScrollToMessage.mockReset();
  mockClearPendingScrollToMessageId.mockReset();
  mockSetActiveTaskTurnId.mockReset();
  mockKeepTurnExpanded.mockReset();
  mockSetCollapsibleTurnIds.mockReset();
  mockSetFeedScrollPosition.mockReset();
  mockCollapseAllTurnActivity.mockReset();
  mockClearBottomAlignOnNextUserMessage.mockReset();
  mockSetComposerDraft.mockReset();
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockSearchSessionMessages.mockReset();
  mockSearchSessionMessages.mockImplementation((sessionId: string, options = {}) =>
    Promise.resolve(buildMessageSearchResponse(sessionId, options as { scope?: string; threadKey?: string | null })),
  );
  mockStoreValues.messages = new Map();
  mockStoreValues.messageFrozenCounts = new Map();
  mockStoreValues.messageFrozenRevisions = new Map();
  mockStoreValues.historyWindows = new Map();
  mockStoreValues.streamingStartedAt = new Map();
  mockStoreValues.streamingOutputTokens = new Map();
  mockStoreValues.streamingPausedDuration = new Map();
  mockStoreValues.streamingPauseStartedAt = new Map();
  mockStoreValues.connectionStatus = new Map();
  mockStoreValues.sessionStatus = new Map();
  mockStoreValues.sessions = new Map();
  mockStoreValues.threadWindows = new Map();
  mockStoreValues.threadWindowMessages = new Map();
  mockStoreValues.threadWindowRefreshRevisions = new Map();
  mockStoreValues.threadWindowAppliedRevisions = new Map();
  mockStoreValues.feedScrollPosition = new Map();
  mockStoreValues.toolProgress = new Map();
  mockStoreValues.toolResults = new Map();
  mockStoreValues.toolStartTimestamps = new Map();
  mockStoreValues.turnActivityOverrides = new Map();
  mockStoreValues.autoExpandedTurnIds = new Map();
  mockStoreValues.backgroundAgentNotifs = new Map();
  mockStoreValues.scrollToTurnId = new Map();
  mockStoreValues.scrollToMessageId = new Map();
  mockStoreValues.pendingScrollToMessageId = new Map();
  mockStoreValues.expandAllInTurn = new Map();
  mockStoreValues.bottomAlignNextUserMessage = new Set();
  mockStoreValues.sessionTaskHistory = new Map();
  mockStoreValues.pendingCodexInputs = new Map();
  mockStoreValues.activeTaskTurnId = new Map();
  mockStoreValues.sdkSessions = [];
  localStorage.clear();
}

export function setStoreSelectedThreadWindow({
  sessionId,
  threadKey,
  fromItem,
  itemCount,
  totalItems,
  sectionItemCount,
  visibleItemCount,
  hasOlderItems,
  hasNewerItems,
  partial,
  messages,
}: {
  sessionId: string;
  threadKey: string;
  fromItem: number;
  itemCount: number;
  totalItems: number;
  sectionItemCount: number;
  visibleItemCount: number;
  hasOlderItems?: boolean;
  hasNewerItems?: boolean;
  /** The first, partial window of a message jump. */
  partial?: boolean;
  messages: ChatMessage[];
}) {
  mockStoreValues.threadWindows = new Map([
    [
      sessionId,
      new Map([
        [
          threadKey,
          {
            thread_key: threadKey,
            from_item: fromItem,
            item_count: itemCount,
            total_items: totalItems,
            has_older_items: hasOlderItems ?? fromItem > 0,
            has_newer_items: hasNewerItems ?? fromItem + itemCount < totalItems,
            source_history_length: totalItems,
            section_item_count: sectionItemCount,
            visible_item_count: visibleItemCount,
            ...(partial ? { partial } : {}),
          },
        ],
      ]),
    ],
  ]);
  mockStoreValues.threadWindowMessages = new Map([[sessionId, new Map([[threadKey, messages]])]]);
}

export function setStoreThreadWindowRevisions({
  sessionId,
  threadKey,
  refreshRevision,
  appliedRevision,
}: {
  sessionId: string;
  threadKey: string;
  refreshRevision: number;
  appliedRevision: number;
}) {
  mockStoreValues.threadWindowRefreshRevisions = new Map([[sessionId, refreshRevision]]);
  mockStoreValues.threadWindowAppliedRevisions = new Map([[sessionId, new Map([[threadKey, appliedRevision]])]]);
}

export async function flushFeedObservers() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

export function setElementScrollMetrics(
  element: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    get() {
      return clientHeight;
    },
  });
  element.scrollTop = scrollTop;
}

export function getScrollContainer(container: HTMLElement): HTMLElement {
  const scrollContainer = container.querySelector<HTMLElement>('[data-testid="message-feed-scroll-container"]');
  if (!scrollContainer) throw new Error("Message feed scroll container missing");
  return scrollContainer;
}

export function makeDomRect(height: number, width = 0): DOMRect {
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

export function makePositionedDomRect(top: number, bottom: number): DOMRect {
  return {
    ...makeDomRect(bottom - top),
    top,
    bottom,
  } as DOMRect;
}

/** Installs the jsdom polyfills and the per-test store reset. */
export function installSectionWindowingTestHooks() {
  // jsdom does not implement scrollIntoView; polyfill it before any React rendering
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

  beforeEach(() => {
    resetStore();
    mockScrollIntoView.mockClear();
    mockScrollTo.mockClear();
    mediaState.touchDevice = false;
  });
}
