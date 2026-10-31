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

import { fireEvent, render, screen, within } from "@testing-library/react";
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
import { seedLeaderTopics } from "../utils/leader-topics.js";

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
  it("draws the divider above the strip, and restates the strip on a new day", () => {
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
      // Same quest, a new day: the divider, then the quest's strip again for the day's track.
      "divider",
      "strip q-12",
      "message u3",
    ]);
    expect(screen.getAllByTestId("minute-boundary-timestamp")).toHaveLength(2);
  });
});

/**
 * Jiayi (T7 run topic): a request asked in the topic and handed off to a quest sat under the
 * topic's strip with a "Continued in" row, and the quest's strip came only after the leader's
 * filing note. As in Main, the quest's strip now sits above the request, which reads as the
 * quest's start, and the strip makes the "Continued in" row redundant.
 */
describe("a request in a topic that continued in a quest", () => {
  it("sits under its quest's strip, after the day divider, without a Continued in row", () => {
    const sid = "topic-request-strip";
    const day1 = new Date("2026-02-25T12:00:00.000Z").getTime();
    const day2 = new Date("2026-02-26T12:00:00.000Z").getTime();
    const topic = "topic:aaaaaaaa";
    mockStoreValues.messages = new Map([
      [
        sid,
        [
          {
            id: "earlier",
            role: "user",
            content: "earlier",
            timestamp: day1,
            metadata: { leaderResponseCoverageVersion: 1, threadKey: topic, viewKeys: [topic] },
          },
          {
            // Asked in the topic, then handed off to q-12: its newest attachment is the quest.
            id: "ask",
            role: "user",
            content: "ask",
            timestamp: day2,
            metadata: {
              leaderResponseCoverageVersion: 1,
              threadKey: topic,
              threadRefs: [
                { threadKey: topic, source: "explicit", attachedAt: day2 },
                { threadKey: "q-12", questId: "q-12", source: "explicit", attachedAt: day2 + 30_000 },
              ],
              viewKeys: [topic, "q-12"],
            },
          },
        ] as ChatMessage[],
      ],
    ]);
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-12"], topicKey: topic, topicName: "Relay", openQuest: vi.fn() }}
        >
          <MessageFeed sessionId={sid} threadKey={topic} projectThreadRoutes onSelectThread={vi.fn()} />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    const order = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-testid="minute-boundary-timestamp"], [data-testid="topic-feed-quest-start"], [data-testid="user-message-bubble"]',
      ),
    ].map((element) =>
      element.dataset.testid === "minute-boundary-timestamp"
        ? "divider"
        : element.dataset.testid === "topic-feed-quest-start"
          ? `strip ${element.dataset.quest || "topic"}`
          : `message ${element.textContent?.includes("earlier") ? "earlier" : "ask"}`,
    );
    expect(order).toEqual(["divider", "strip topic", "message earlier", "divider", "strip q-12", "message ask"]);
    expect(screen.queryByTestId("continued-in-links")).toBeNull();
  });
});

describe("a request in a topic moved to a quest of another topic", () => {
  it("gets that quest's strip, naming the other topic, without the leader's routing note", () => {
    // Jiayi (Chat feed topic): a request handed off to a quest filed under another topic still sat
    // under this topic's strip, with only a small label naming the other topic.
    const sid = "topic-request-elsewhere";
    const at = new Date("2026-02-25T12:00:00.000Z").getTime();
    const topic = "topic:aaaaaaaa";
    seedLeaderTopics(sid, { "q-99": { id: "bbbbbbbb-0000", name: "Library" } });
    mockStoreValues.messages = new Map([
      [
        sid,
        [
          {
            id: "ask",
            role: "user",
            content: "ask",
            timestamp: at,
            metadata: {
              leaderResponseCoverageVersion: 1,
              threadKey: topic,
              threadRefs: [
                { threadKey: topic, source: "explicit", attachedAt: at },
                { threadKey: "q-99", questId: "q-99", source: "explicit", attachedAt: at + 30_000 },
              ],
              viewKeys: [topic, "q-99"],
            },
          },
          {
            id: "moved",
            role: "assistant",
            content: "Moved to q-99",
            timestamp: at + 40_000,
            metadata: { leaderThreadRole: "commentary", threadKey: topic, viewKeys: [topic] },
          },
        ] as ChatMessage[],
      ],
    ]);
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-12"], topicKey: topic, topicName: "Chat feed", openQuest: vi.fn() }}
        >
          <MessageFeed sessionId={sid} threadKey={topic} projectThreadRoutes />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    const strips = screen.getAllByTestId("topic-feed-quest-start");
    expect(strips.map((strip) => strip.dataset.quest)).toEqual(["q-99"]);
    expect(within(strips[0]!).getByTestId("topic-feed-quest-topic").textContent).toContain("Library");
    expect(screen.queryAllByTestId("topic-feed-quest-label")).toHaveLength(0);
    expect(document.querySelectorAll("[data-turn-id]")).toHaveLength(1);
  });
});

describe("the leader's reply in the topic right after a request it moved to a quest", () => {
  it("joins the request's quest, so nothing of the topic interrupts the quest's start", () => {
    // The filing note ("Filed as q-12 …") is routed to the topic, where the request was asked. In
    // the same turn it reads as part of what the leader did with the request, as under a Main strip.
    const sid = "topic-request-fold";
    const at = new Date("2026-02-25T12:00:00.000Z").getTime();
    const topic = "topic:aaaaaaaa";
    mockStoreValues.messages = new Map([
      [
        sid,
        [
          {
            id: "ask",
            role: "user",
            content: "ask",
            timestamp: at,
            metadata: {
              leaderResponseCoverageVersion: 1,
              threadKey: topic,
              threadRefs: [
                { threadKey: topic, source: "explicit", attachedAt: at },
                { threadKey: "q-12", questId: "q-12", source: "explicit", attachedAt: at + 30_000 },
              ],
              viewKeys: [topic, "q-12"],
            },
          },
          {
            id: "filed",
            role: "assistant",
            content: "Filed as q-12",
            timestamp: at + 40_000,
            metadata: { leaderThreadRole: "commentary", threadKey: topic, viewKeys: [topic] },
          },
          {
            id: "started",
            role: "assistant",
            content: "Worker started",
            timestamp: at + 50_000,
            metadata: { leaderThreadRole: "commentary", threadKey: "q-12", questId: "q-12", viewKeys: ["q-12", topic] },
          },
        ] as ChatMessage[],
      ],
    ]);
    render(
      <QuestRecordFetchContext.Provider value={false}>
        <TopicFeedContext.Provider
          value={{ questIds: ["q-12"], topicKey: topic, topicName: "Relay", openQuest: vi.fn() }}
        >
          <MessageFeed sessionId={sid} threadKey={topic} projectThreadRoutes />
        </TopicFeedContext.Provider>
      </QuestRecordFetchContext.Provider>,
    );
    expect(screen.getAllByTestId("topic-feed-quest-start").map((strip) => strip.dataset.quest)).toEqual(["q-12"]);
    // One turn: the request; the leader's notes are working steps, left to the quest's thread.
    expect(document.querySelectorAll("[data-turn-id]")).toHaveLength(1);
    expect(screen.queryByText("Filed as q-12")).toBeNull();
    expect(screen.queryByText("Worker started")).toBeNull();
  });
});

/**
 * Jiayi: parallel quests in one topic interleaved their requests, progress and results, and the
 * leader's working steps buried what to read. The topic now shows the user's messages, answers and
 * results only, each quest's day as one track that starts at its request.
 */
describe("quests running together in a topic", () => {
  const sid = "topic-parallel";
  const start = new Date("2026-02-25T12:00:00.000Z").getTime();
  const views = (threadKey: string) => [threadKey, "topic:aaaaaaaa"];
  const human = (id: string, threadKey: string, minute: number): ChatMessage => ({
    id,
    role: "user",
    content: id,
    timestamp: start + minute * 60_000,
    metadata: { leaderResponseCoverageVersion: 1, threadKey, questId: threadKey, viewKeys: views(threadKey) },
  });
  const leader = (id: string, threadKey: string, minute: number, role: "answer" | "commentary"): ChatMessage => ({
    id,
    role: "assistant",
    content: `${role} ${id}`,
    timestamp: start + minute * 60_000,
    metadata: { leaderThreadRole: role, threadKey, questId: threadKey, viewKeys: views(threadKey) },
  });
  // In time order: both requests, then updates and results of the two quests taking turns.
  const messages = [
    human("ask3", "q-3", 0),
    leader("note3", "q-3", 1, "commentary"),
    human("ask12", "q-12", 2),
    leader("note12", "q-12", 3, "commentary"),
    leader("done3", "q-3", 4, "answer"),
    leader("done12", "q-12", 5, "answer"),
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
  // The messages the conversation shows, in document order, by their text.
  const shown = () =>
    messages
      .map((message) => ({ id: message.id, element: screen.queryByText(message.content as string) }))
      .filter((item) => item.element)
      .sort((a, b) => (a.element!.compareDocumentPosition(b.element!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
      .map((item) => item.id);

  it("shows each request followed by its quest's result, and none of the working steps", () => {
    renderTopic();
    expect(shown()).toEqual(["ask3", "done3", "ask12", "done12"]);
    expect(screen.getAllByTestId("topic-feed-quest-start").map((strip) => strip.dataset.quest)).toEqual([
      "q-3",
      "q-12",
    ]);
  });

  it("shows a working step the feed is asked to jump to, in its quest's track", () => {
    mockStoreValues.scrollToMessageId = new Map([[sid, "note12"]]);
    renderTopic();
    expect(shown()).toEqual(["ask3", "done3", "ask12", "note12", "done12"]);
  });
});
