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

import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types.js";

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
const mockSetFeedScrollPosition = vi.fn();
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
      composerDrafts: mockStoreValues.composerDrafts ?? new Map(),
      messageFrozenCounts: mockStoreValues.messageFrozenCounts ?? new Map(),
      messageFrozenRevisions: mockStoreValues.messageFrozenRevisions ?? new Map(),
      historyLoading: mockStoreValues.historyLoading ?? new Map(),
      historyWindows: mockStoreValues.historyWindows ?? new Map(),
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
      clearPendingScrollToMessageId: vi.fn(),
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
      syncedProjectionValues: mockStoreValues.syncedProjectionValues ?? new Map(),
      syncedProjectionKeys: mockStoreValues.syncedProjectionKeys ?? new Set(),
      sessionSearch: mockStoreValues.sessionSearch ?? new Map(),
      compactToolActivity: mockStoreValues.compactToolActivity ?? false,
      // A topic conversation reads the leader's boards and windows too.
      sessionBoards: new Map(),
      sessionCompletedBoards: new Map(),
      sessionBoardRowStatuses: new Map(),
      threadWindows: new Map(),
      threadWindowMessages: new Map(),
      threadWindowResponseStates: new Map(),
      quests: [],
      questDetails: new Map(),
    };
    return selector(state);
  };
  useStore.getState = () => ({
    feedScrollPosition: mockStoreValues.feedScrollPosition ?? new Map(),
    setFeedScrollPosition: mockSetFeedScrollPosition,
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

import { MessageFeed } from "./MessageFeed.js";
import { QuestRecordFetchContext } from "./QuestSummaryCard.js";
import { TopicFeedContext } from "./topic-feed.js";

function resetStore() {
  mockToggleTurnActivity.mockReset();
  mockFocusTurn.mockReset();
  mockClearScrollToTurn.mockReset();
  mockClearScrollToMessage.mockReset();
  mockSetActiveTaskTurnId.mockReset();
  mockKeepTurnExpanded.mockReset();
  mockSetFeedScrollPosition.mockReset();
  mockClearBottomAlignOnNextUserMessage.mockReset();
  mockSetComposerDraft.mockReset();
  mockSendToSession.mockReset();
  mockSendToSession.mockReturnValue(true);
  mockStoreValues.messages = new Map();
  mockStoreValues.messageFrozenCounts = new Map();
  mockStoreValues.messageFrozenRevisions = new Map();
  mockStoreValues.historyWindows = new Map();
  mockStoreValues.streamingStartedAt = new Map();
  mockStoreValues.streamingOutputTokens = new Map();
  mockStoreValues.streamingPausedDuration = new Map();
  mockStoreValues.streamingPauseStartedAt = new Map();
  mockStoreValues.sessionStatus = new Map();
  mockStoreValues.sessions = new Map();
  mockStoreValues.syncedProjectionValues = new Map();
  mockStoreValues.syncedProjectionKeys = new Set();
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
  mockStoreValues.compactToolActivity = false;
}

beforeEach(() => {
  resetStore();
});

/**
 * Jiayi: a day divider must never sit between a quest strip and the first message under it; the
 * divider comes first, then the strip, then the message. Checked on the rendered feed of a topic
 * conversation, where strips appear above the turns of each quest.
 */
describe("quest strips and day dividers", () => {
  it("draws the divider above the strip, and keeps later dividers inside the quest's run", () => {
    const sid = "topic-strip-dividers";
    const day1 = new Date("2026-02-25T12:00:00.000Z").getTime();
    const day2 = new Date("2026-02-26T12:00:00.000Z").getTime();
    const human = (id: string, threadKey: string, timestamp: number): ChatMessage => ({
      id,
      role: "user",
      content: id,
      timestamp,
      // As the server sends them: with the views they belong to (the quest and its topic).
      metadata: {
        leaderResponseCoverageVersion: 1,
        threadKey,
        questId: threadKey,
        viewKeys: [threadKey, "topic:aaaaaaaa"],
      },
    });
    mockStoreValues.messages = new Map([
      [sid, [human("u1", "q-3", day1), human("u2", "q-12", day1 + 60_000), human("u3", "q-12", day2)]],
    ]);
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-3", "q-12"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest: vi.fn() }}
        >
          <MessageFeed sessionId={sid} threadKey="topic:aaaaaaaa" projectThreadRoutes />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    // Document order of dividers, strips and the user's messages.
    const order = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="minute-boundary-timestamp"], [data-testid="topic-feed-quest-start"], [data-testid="user-message-bubble"]',
      ),
    ].map((element) =>
      element.dataset.testid === "minute-boundary-timestamp"
        ? "divider"
        : element.dataset.testid === "topic-feed-quest-start"
          ? `strip ${element.dataset.quest}`
          : `message ${element.textContent?.includes("u1") ? "u1" : element.textContent?.includes("u2") ? "u2" : "u3"}`,
    );
    expect(order).toEqual([
      "divider",
      "strip q-3",
      "message u1",
      "strip q-12",
      "message u2",
      // Same quest, a new day: the divider stays between its messages.
      "divider",
      "message u3",
    ]);
    expect(screen.getAllByTestId("minute-boundary-timestamp")).toHaveLength(2);
  });
});

/**
 * Jiayi's Formal verification topic: two quests running together alternated their progress
 * updates, each a label, a collapsed activity row and the text, which was hard to follow. A
 * stretch of progress turns that interleaves quests folds into one card with a row per quest,
 * whose latest updates roll like the worker preview; opening a row brings that quest's turns back.
 */
describe("progress of quests running together in a topic", () => {
  const sid = "topic-progress";
  const start = new Date("2026-02-25T12:00:00.000Z").getTime();
  const views = (threadKey: string) => [threadKey, "topic:aaaaaaaa"];
  const human = (id: string, threadKey: string, minute: number): ChatMessage => ({
    id,
    role: "user",
    content: id,
    timestamp: start + minute * 60_000,
    metadata: { leaderResponseCoverageVersion: 1, threadKey, questId: threadKey, viewKeys: views(threadKey) },
  });
  const update = (id: string, threadKey: string, minute: number): ChatMessage => ({
    id,
    role: "assistant",
    content: `update ${id}`,
    timestamp: start + minute * 60_000,
    metadata: { leaderThreadRole: "commentary", threadKey, questId: threadKey, viewKeys: views(threadKey) },
  });
  // The user's request and its first reply, then q-12 and q-3 taking turns: five updates of
  // q-12 (b2 to b10), four of q-3 (a3 to a9).
  const messages = [
    human("ask", "q-3", 0),
    update("a1", "q-3", 1),
    ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => update(`${n % 2 ? "a" : "b"}${n}`, n % 2 ? "q-3" : "q-12", n)),
  ];

  function renderTopic() {
    mockStoreValues.messages = new Map([[sid, messages]]);
    return render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-3", "q-12"], topicKey: "topic:aaaaaaaa", topicName: "Relay", openQuest: vi.fn() }}
        >
          <MessageFeed sessionId={sid} threadKey="topic:aaaaaaaa" projectThreadRoutes />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
  }
  const rowOf = (quest: string) =>
    screen.getAllByTestId("topic-progress-row").find((row) => row.querySelector("a")?.textContent === quest)!;
  // The turns the conversation shows, by their first message (a split part's id ends with it).
  const shownTurns = () =>
    [...document.querySelectorAll<HTMLElement>("[data-turn-id]")].map((turn) => turn.dataset.turnId!.split("-").at(-1));

  it("folds the interleaved updates into one card, a row per quest with its latest updates", () => {
    renderTopic();
    expect(screen.getAllByTestId("topic-progress-card")).toHaveLength(1);
    // Rows in the order the quests first post in the run.
    const rows = screen.getAllByTestId("topic-progress-row");
    expect(rows.map((row) => row.querySelector("a")?.textContent)).toEqual(["q-12", "q-3"]);
    // The rolling window keeps the latest four updates; the fifth, oldest, rolls out.
    const q12 = rowOf("q-12");
    expect(q12.textContent).toContain("+1 earlier");
    expect(q12.textContent).not.toContain("update b2");
    for (const id of ["b4", "b6", "b8", "b10"]) expect(q12.textContent).toContain(`update ${id}`);
    expect(rowOf("q-3").textContent).not.toContain("earlier");
    // The folded turns are out of the conversation, and so are their labels.
    expect(screen.queryAllByTestId("topic-feed-quest-label")).toHaveLength(0);
    expect(shownTurns()).toEqual(["ask"]);
  });

  it("opens a row into that quest's turns under one label, the window giving way to them", () => {
    renderTopic();
    fireEvent.click(rowOf("q-12").querySelector('[data-testid="topic-progress-toggle"]')!);
    expect(shownTurns()).toEqual(["ask", "b2", "b4", "b6", "b8", "b10"]);
    const labels = screen.getAllByTestId("topic-feed-quest-label");
    expect(labels.map((label) => label.dataset.quest)).toEqual(["q-12"]);
    expect(rowOf("q-12").querySelector('[data-testid="topic-progress-updates"]')).toBeNull();
    expect(rowOf("q-12").textContent).toContain("Hide updates");
  });

  it("opens the row of a folded message the feed is asked to jump to", () => {
    mockStoreValues.scrollToMessageId = new Map([[sid, "a5"]]);
    renderTopic();
    expect(shownTurns()).toEqual(["ask", "a3", "a5", "a7", "a9"]);
    expect(rowOf("q-3").textContent).toContain("Hide updates");
  });
});
