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

import { render, screen, within } from "@testing-library/react";
import type { ChatMessage, ThreadTransitionMarker } from "../types.js";

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

describe("MessageFeed - collapsed thread-detail markers", () => {
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
});
