// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useSyncExternalStore, type ReactNode } from "react";
import {
  persistLeaderSelectedThreadKey,
  readDisplayedLeaderThreadKey,
  readLeaderSelectedThreadKey,
} from "../utils/thread-viewport.js";
import { navigateToSessionThread, parseHash, threadRouteFromHash } from "../utils/routing.js";
import { needsInputNotification, threadMessage } from "./chat-view-leader-tabs-fixtures.js";
import { installChatViewLeaderProjection } from "../test-fixtures/chat-view-leader-projection.js";

const QUEST_ID = "q-1944";
const LEADER_SESSION_ID = "leader-a";
const OTHER_SESSION_ID = "leader-b";

let mockState: ReturnType<typeof createMockState>;
const mockSendToSession = vi.fn((_sessionId: string, _message: unknown) => true);
const mockViewportHandoffGates = vi.hoisted(() => ({
  session: vi.fn(),
  thread: vi.fn(),
}));

function createMockState() {
  const sessions = new Map([
    [
      LEADER_SESSION_ID,
      {
        backend_state: "connected" as const,
        backend_error: null,
        isOrchestrator: true,
      },
    ],
    [
      OTHER_SESSION_ID,
      {
        backend_state: "connected" as const,
        backend_error: null,
        isOrchestrator: true,
      },
    ],
  ]);
  return {
    currentSessionId: LEADER_SESSION_ID,
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    setSessionInfoOpenSessionId: vi.fn(),
    activeTab: "chat" as const,
    setActiveTab: vi.fn(),
    changedFiles: new Map(),
    diffFileStats: new Map(),
    threadWindows: new Map(),
    pendingPermissions: new Map(),
    connectionStatus: new Map([
      [LEADER_SESSION_ID, "connected" as const],
      [OTHER_SESSION_ID, "connected" as const],
    ]),
    sessions,
    cliConnected: new Map([
      [LEADER_SESSION_ID, true],
      [OTHER_SESSION_ID, true],
    ]),
    cliEverConnected: new Map([
      [LEADER_SESSION_ID, true],
      [OTHER_SESSION_ID, true],
    ]),
    cliDisconnectReason: new Map([
      [LEADER_SESSION_ID, null],
      [OTHER_SESSION_ID, null],
    ]),
    sessionStatus: new Map([
      [LEADER_SESSION_ID, "idle" as const],
      [OTHER_SESSION_ID, "idle" as const],
    ]),
    serverReachable: true,
    sdkSessions: [
      { sessionId: LEADER_SESSION_ID, archived: false, isOrchestrator: true },
      { sessionId: OTHER_SESSION_ID, archived: false, isOrchestrator: true },
    ],
    sessionNotifications: new Map(),
    sessionAttention: new Map(),
    sessionAttentionRecords: new Map(),
    sessionBoards: new Map<string, unknown[]>([[LEADER_SESSION_ID, []]]),
    sessionCompletedBoards: new Map<string, unknown[]>([[LEADER_SESSION_ID, []]]),
    sessionBoardRowStatuses: new Map(),
    leaderProjections: new Map(),
    syncedProjectionValues: new Map<string, unknown>(),
    syncedProjectionKeys: new Set<string>(),
    messages: new Map([
      [LEADER_SESSION_ID, [threadMessage(QUEST_ID, 10)]],
      [OTHER_SESSION_ID, []],
    ]),
    feedScrollPosition: new Map(),
    historyLoading: new Map([
      [LEADER_SESSION_ID, false],
      [OTHER_SESSION_ID, false],
    ]),
    quests: [{ questId: QUEST_ID, title: QUEST_ID, status: "done" }],
    questDetails: new Map(),
    questTitlePreviews: new Map(),
    hydrateQuestTitles: vi.fn().mockResolvedValue(undefined),
    sessionNames: new Map([
      [LEADER_SESSION_ID, "Desktop Main"],
      [OTHER_SESSION_ID, "Other session"],
    ]),
    questNamedSessions: new Set(),
    refreshQuests: vi.fn().mockResolvedValue(undefined),
    refreshQuestSummary: vi.fn().mockResolvedValue(undefined),
    leaderWorkboardViews: new Map(),
    setLeaderWorkboardView: vi.fn(),
    shortcutSettings: { enabled: false, preset: "standard" as const, overrides: {} },
    zoomLevel: 1,
  };
}

vi.mock("./ViewportHandoffEntryGate.js", () => ({
  ViewportHandoffThreadEntryGate: ({ children, entryId, sessionId, threadKey }: any) => {
    mockViewportHandoffGates.thread({ entryId, sessionId, threadKey });
    return children;
  },
  ViewportHandoffSessionEntryGate: ({ children, entryId, sessionId }: any) => {
    mockViewportHandoffGates.session({ entryId, sessionId });
    return children;
  },
}));

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (state: typeof mockState) => unknown) => selector(mockState), {
    getState: () => mockState,
  }),
  getSessionSearchState: () => ({ query: "", isOpen: false, mode: "strict", category: "all", matches: [] }),
}));

vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: () => {} }));
vi.mock("../api.js", () => ({
  api: {
    relaunchSession: vi.fn(),
    unarchiveSession: vi.fn(),
    acknowledgeModelProvenanceMigration: vi.fn(),
    markNotificationDone: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../ws.js", () => ({
  connectSession: vi.fn(),
  sendToSession: (sessionId: string, message: unknown) => mockSendToSession(sessionId, message),
}));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./TaskOutlineBar.js", () => ({ TaskOutlineBar: () => null }));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./Composer.js", () => ({
  Composer: ({ threadKey, topicName }: { threadKey?: string; topicName?: string }) => (
    <div data-testid="composer" data-thread-key={threadKey} data-topic-name={topicName} />
  ),
}));
vi.mock("./PermissionBanner.js", () => ({
  PermissionBanner: () => null,
  PlanReviewOverlay: () => <div data-testid="plan-review-overlay" />,
  PlanCollapsedChip: () => null,
  PermissionsCollapsedChip: () => null,
}));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({
    sessionId,
    threadKey,
    questChips,
  }: {
    sessionId: string;
    threadKey?: string;
    questChips?: ReactNode;
  }) => (
    <div data-testid="message-feed" data-session-id={sessionId} data-thread-key={threadKey}>
      {questChips}
    </div>
  ),
}));
// A topic leader's Main is its Home, drawn instead of a feed; it stands in for the Main view here,
// since these tests are about which place is selected, not what the place shows.
vi.mock("./LeaderHomePage.js", () => ({
  LeaderHomePage: ({ leaderId }: { leaderId: string }) => (
    <div data-testid="message-feed" data-session-id={leaderId} data-thread-key="main" data-home="true" />
  ),
  NewThreadComposer: () => <div data-testid="new-thread-composer" />,
}));
vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    currentThreadKey,
    onSelectThread,
    openThreadKeys = [],
    threadRows = [],
    onMoveHomeToSide,
  }: {
    currentThreadKey?: string;
    onSelectThread?: (threadKey: string) => void;
    openThreadKeys?: string[];
    threadRows?: Array<{ threadKey: string; title: string }>;
    onMoveHomeToSide?: (keepHere: boolean) => void;
  }) => (
    <div data-testid="work-board-bar" data-current-thread-key={currentThreadKey}>
      {onMoveHomeToSide && (
        <button type="button" data-testid="home-move-to-side" onClick={(event) => onMoveHomeToSide(event.shiftKey)}>
          Move Home
        </button>
      )}
      <button type="button" onClick={() => onSelectThread?.("main")}>
        Main
      </button>
      {openThreadKeys.map((threadKey) => (
        <button
          type="button"
          key={threadKey}
          data-testid={`thread-button-${threadKey}`}
          onClick={() => onSelectThread?.(threadKey)}
        >
          {threadKey}
          <span data-testid={`thread-title-${threadKey}`}>
            {threadRows.find((row) => row.threadKey === threadKey)?.title}
          </span>
        </button>
      ))}
    </div>
  ),
}));
vi.mock("./SideChatPanel.js", () => ({ SideChatPanel: () => null }));
vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./SessionInlineLink.js", () => ({
  SessionInlineLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./SessionStatusDot.js", () => ({ SessionStatusDot: () => null }));
vi.mock("../hooks/useGlobalNeedsInputEntries.js", () => ({
  useGlobalNeedsInputEntries: () => ({ entries: [], mutedEntries: [], sdkSessions: [] }),
}));
vi.mock("./CatIcons.js", () => ({ YarnBallDot: () => null }));
vi.mock("./QuestJourneyTimeline.js", () => ({
  isCompletedJourneyPresentationStatus: (status?: string) => ["completed", "done"].includes(status ?? ""),
  QuestJourneyPreviewCard: () => null,
  QuestJourneyTimeline: () => null,
}));
vi.mock("./QuestCommitDiffView.js", () => ({
  useQuestCodeCommitShas: () => ({ commitShas: [], loading: false }),
}));
vi.mock("./ModelProvenanceMigrationBanner.js", () => ({ ModelProvenanceMigrationBanner: () => null }));
vi.mock("./session-participant-status.js", () => ({ useParticipantSessionStatusDotProps: () => ({}) }));

import { ChatView } from "./ChatView.js";
import { topicApi } from "../api/topics.js";
import { resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { getViewHistory } from "../utils/view-history.js";

import { topicViewKey } from "../../shared/topic-thread-key.js";

function RouteAwareChatView() {
  const hash = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      return () => window.removeEventListener("hashchange", onChange);
    },
    () => window.location.hash,
  );
  const route = parseHash(hash);
  if (route.page !== "session") return null;
  const threadRoute = threadRouteFromHash(hash);
  return (
    <ChatView
      key={route.sessionId}
      sessionId={route.sessionId}
      hasThreadRoute={threadRoute.hasThreadParam}
      routeThreadKey={threadRoute.threadKey}
    />
  );
}

function navigate(hash: string) {
  act(() => {
    history.pushState(null, "", hash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

beforeEach(() => {
  // Topics are module state: a leader whose topics an earlier test loaded would keep them, and so
  // would the topic routes an earlier test mocked (a leader with topics shows Home for Main).
  vi.restoreAllMocks();
  resetLeaderTopicsForTest();
  mockState = createMockState();
  installChatViewLeaderProjection(mockState, LEADER_SESSION_ID, [QUEST_ID]);
  installChatViewLeaderProjection(mockState, OTHER_SESSION_ID, []);
  mockSendToSession.mockClear();
  mockViewportHandoffGates.session.mockClear();
  mockViewportHandoffGates.thread.mockClear();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  history.replaceState(null, "", `#/session/${LEADER_SESSION_ID}?thread=${QUEST_ID}`);
});

/** The leader's topic t1 ("Library") holding QUEST_ID, as the topic routes answer. */
function mockLibraryTopic() {
  const library = { id: "t1", name: "Library", questIds: [QUEST_ID, "q-1945"], activityAt: 1 };
  vi.spyOn(topicApi, "questMap").mockResolvedValue({
    enabled: true,
    map: { [QUEST_ID]: { id: "t1", name: "Library" } },
    topics: { t1: library },
  });
  vi.spyOn(topicApi, "list").mockResolvedValue({
    topics: [library],
    changes: [],
    leaders: [],
    spaces: [],
    suggestions: [],
  } as never);
  vi.spyOn(topicApi, "threads").mockResolvedValue({ threads: [] } as never);
}

function latestViewportThreadEntryId(sessionId: string, threadKey: string): string | undefined {
  const calls = mockViewportHandoffGates.thread.mock.calls
    .map(([value]) => value as { entryId?: string; sessionId?: string; threadKey?: string })
    .filter((value) => value.sessionId === sessionId && value.threadKey === threadKey);
  return calls.at(-1)?.entryId;
}

describe("ChatView passive leader-session returns", () => {
  it("reuses one thread entry across a plan overlay but refreshes a true quest to Home to quest return", async () => {
    persistLeaderSelectedThreadKey(LEADER_SESSION_ID, "main");
    history.replaceState(null, "", `#/session/${LEADER_SESSION_ID}`);
    const view = render(
      <ChatView sessionId={LEADER_SESSION_ID} viewportHandoffThreadEntryScopeId="session-entry-scope" />,
    );
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-home", "true"));
    fireEvent.click(screen.getByTestId(`thread-button-${QUEST_ID}`));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    const firstEntryId = latestViewportThreadEntryId(LEADER_SESSION_ID, QUEST_ID);
    expect(firstEntryId).toBeTruthy();

    mockState.pendingPermissions = new Map([
      [LEADER_SESSION_ID, new Map([["plan-1", { request_id: "plan-1", tool_name: "ExitPlanMode" }]])],
    ]);
    view.rerender(<ChatView sessionId={LEADER_SESSION_ID} viewportHandoffThreadEntryScopeId="session-entry-scope" />);
    await waitFor(() => expect(screen.getByTestId("plan-review-overlay")).toBeInTheDocument());

    mockState.pendingPermissions = new Map();
    view.rerender(<ChatView sessionId={LEADER_SESSION_ID} viewportHandoffThreadEntryScopeId="session-entry-scope" />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    expect(latestViewportThreadEntryId(LEADER_SESSION_ID, QUEST_ID)).toBe(firstEntryId);

    // Leaving for the leader's Home and coming back is a true return: a fresh entry.
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-home", "true"));
    fireEvent.click(screen.getByTestId(`thread-button-${QUEST_ID}`));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    expect(latestViewportThreadEntryId(LEADER_SESSION_ID, QUEST_ID)).not.toBe(firstEntryId);
  });
  it("checkpoints the actual Main selection across A to B to A and ignores late completed-thread hydration", async () => {
    // Regression: a completed quest tab stays server-open for inspection. If a
    // stale local writer races after the user chooses Main, leaving the session
    // must checkpoint the mounted ChatView's actual selection rather than let
    // the stale quest value drive a passive return.
    const view = render(<RouteAwareChatView />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe("main");

    // Model the stale persisted q-1944 value observed in the reopened desktop
    // reproduction after Main was already visibly selected.
    persistLeaderSelectedThreadKey(LEADER_SESSION_ID, QUEST_ID);
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe(QUEST_ID);
    // Reconnects and handoff refetches ask for the thread on screen, not the stale value.
    expect(readDisplayedLeaderThreadKey(LEADER_SESSION_ID)).toBe("main");

    mockState.currentSessionId = OTHER_SESSION_ID;
    navigate(`#/session/${OTHER_SESSION_ID}`);
    await waitFor(() =>
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-session-id", OTHER_SESSION_ID),
    );
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe("main");

    mockState.currentSessionId = LEADER_SESSION_ID;
    navigate(`#/session/${LEADER_SESSION_ID}`);
    await waitFor(() =>
      expect(screen.getByTestId("message-feed")).toHaveAttribute("data-session-id", LEADER_SESSION_ID),
    );
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");

    // Persistence is only a passive-return fallback. A same-origin stale write
    // after the return must not become fresh navigation intent during later
    // metadata effects in this browser tab.
    persistLeaderSelectedThreadKey(LEADER_SESSION_ID, QUEST_ID);

    // Producer-shaped completion, attention, and canonical-title data can
    // arrive after the keyed return. None is navigation intent, so Main must
    // remain selected after all related effects settle.
    mockState.sessionCompletedBoards = new Map([
      [
        LEADER_SESSION_ID,
        [
          {
            questId: QUEST_ID,
            title: "Late completed quest title",
            status: "DONE",
            updatedAt: 130,
            completedAt: 117,
          },
        ],
      ],
    ]);
    mockState.sessionNotifications = new Map([[LEADER_SESSION_ID, [needsInputNotification(QUEST_ID, 140)]]]);
    mockState.questTitlePreviews = new Map([
      [
        QUEST_ID,
        {
          questId: QUEST_ID,
          title: "Late canonical q-1944 title",
          version: 2,
          updatedAt: 150,
        },
      ],
    ]);
    view.rerender(<RouteAwareChatView />);

    await waitFor(() =>
      expect(screen.getByTestId(`thread-title-${QUEST_ID}`)).toHaveTextContent("Late canonical q-1944 title"),
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");
    view.unmount();
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe("main");
    expect(readDisplayedLeaderThreadKey(LEADER_SESSION_ID)).toBeNull();
  });

  it("still lets an explicit route or tab click select the completed open quest", async () => {
    persistLeaderSelectedThreadKey(LEADER_SESSION_ID, "main");
    const view = render(<RouteAwareChatView />);

    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe(QUEST_ID);

    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    fireEvent.click(screen.getByTestId(`thread-button-${QUEST_ID}`));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    expect(readLeaderSelectedThreadKey(LEADER_SESSION_ID)).toBe(QUEST_ID);
    expect(window.location.hash).toBe(`#/session/${LEADER_SESSION_ID}?thread=${QUEST_ID}`);

    view.unmount();
  });
});

describe("ChatView topics as tags", () => {
  it("opens the address of a topic's former conversation as Home, with the topic's page beside", async () => {
    // Topics are tags nobody writes in: a link or history entry naming a topic's conversation
    // (`topic:<handle>` of a topic, not a thread) leads to the leader's Home and the topic's page.
    mockLibraryTopic();
    useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
    navigate(`#/session/${LEADER_SESSION_ID}?thread=${topicViewKey("t1")}`);
    render(<RouteAwareChatView />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-home", "true"));
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "topic", topicId: "t1", leaderId: LEADER_SESSION_ID }),
    ]);
  });

  it("keeps a quest's strip to its name and actions, its state in the feed's chips", async () => {
    // Topics stay off the strip (no room); the quest's phase and worker float in its feed, since a
    // thread is no longer tied to one quest or worker. No × either: threads don't close.
    mockLibraryTopic();
    const view = render(<RouteAwareChatView />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    const strip = screen.getByTestId("quest-thread-banner");
    expect(strip.querySelector('[data-testid="quest-thread-meta-strip"]')).toBeNull();
    expect(screen.queryByTestId("thread-topic-tag")).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to Home" })).toBeNull();
    expect(screen.getByTestId("message-feed").querySelector('[data-testid="quest-thread-feed-chips"]')).not.toBeNull();
    view.unmount();
  });

  it("moves a quest's thread to the side column, mirroring the side's move-to-main", async () => {
    // Desktop (jsdom's 1024 px): the thread goes into the side column and the main view goes Home;
    // its tab stays (no close operation is sent).
    useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
    const view = render(<RouteAwareChatView />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    fireEvent.click(screen.getByTestId("thread-move-to-side"));
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: QUEST_ID, leaderId: LEADER_SESSION_ID }),
    ]);
    // The main view is Home; the side column (beside every conversation, in App) shows the quest's.
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    expect(mockSendToSession).not.toHaveBeenCalledWith(
      LEADER_SESSION_ID,
      expect.objectContaining({ operation: expect.objectContaining({ type: "close" }) }),
    );
    // Home moves there too (Jiayi, Nov 1), and the main view goes back to the thread it showed.
    fireEvent.click(await screen.findByTestId("home-move-to-side"));
    expect(useSideColumnStore.getState().items[0]).toEqual(
      expect.objectContaining({ kind: "home", leaderId: LEADER_SESSION_ID }),
    );
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    view.unmount();
    useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
  });

  it("keeps the thread in the main view too on the other-column click (Shift by default) of move-to-side", async () => {
    // Jiayi (Nov 4): the same chat in two views, so each can be scrolled to a different place.
    // Shift-click opens it in the side column and the main view keeps showing it; Home likewise.
    useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
    const view = render(<RouteAwareChatView />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID));
    fireEvent.click(screen.getByTestId("thread-move-to-side"), { shiftKey: true });
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "conversation", threadKey: QUEST_ID, leaderId: LEADER_SESSION_ID }),
    ]);
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", QUEST_ID);
    // A plain click on Home's button moves it; a Shift-click leaves Home on screen.
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main"));
    fireEvent.click(await screen.findByTestId("home-move-to-side"), { shiftKey: true });
    expect(useSideColumnStore.getState().items[0]).toEqual(
      expect.objectContaining({ kind: "home", leaderId: LEADER_SESSION_ID }),
    );
    expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "main");
    view.unmount();
    useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
  });

  it("opens a thread the Scribe joined onto another as that conversation", async () => {
    // A joined thread leaves the lists; its address (an old link, the side column) opens the
    // earlier conversation it continues, and its messages read there.
    mockLibraryTopic();
    vi.spyOn(topicApi, "threads").mockResolvedValue({
      threads: [
        {
          id: "aa11",
          key: "topic:aa11",
          name: "Composer height",
          leaderId: LEADER_SESSION_ID,
          createdAt: 1,
          activityAt: 1,
        },
        {
          id: "bb22",
          key: "topic:bb22",
          name: "Composer a bit high",
          leaderId: LEADER_SESSION_ID,
          createdAt: 2,
          activityAt: 2,
          joinedInto: "topic:aa11",
        },
      ],
    } as never);
    navigate(`#/session/${LEADER_SESSION_ID}?thread=topic:bb22`);
    render(<RouteAwareChatView />);
    await waitFor(() => expect(threadRouteFromHash(window.location.hash).threadKey).toBe("topic:aa11"));
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "topic:aa11"));
  });
});

describe("ChatView Home and leader log", () => {
  it("shows a topic leader's Home for Main, and its message boxes start threads there and in the log", async () => {
    // Jiayi (threads checkpoint, option A): Home replaces Main's conversation, Main's own messages are
    // read only in the leader log, and writing in either starts a new thread.
    mockLibraryTopic();
    navigate(`#/session/${LEADER_SESSION_ID}?thread=main`);
    render(<RouteAwareChatView />);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-home", "true"));
    // Home brings its own message box (tested with the page); Main's is gone.
    expect(screen.queryByTestId("composer")).toBeNull();

    navigate(`#/session/${LEADER_SESSION_ID}?thread=all`);
    await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "all"));
    expect(screen.getByTestId("message-feed")).not.toHaveAttribute("data-home");
    expect(screen.getByTestId("new-thread-composer")).toBeTruthy();
    expect(screen.queryByTestId("composer")).toBeNull();

    // A quest keeps its own message box.
    navigate(`#/session/${LEADER_SESSION_ID}?thread=${QUEST_ID}`);
    await waitFor(() => expect(screen.getByTestId("composer")).toHaveAttribute("data-thread-key", QUEST_ID));
    expect(screen.queryByTestId("new-thread-composer")).toBeNull();
  });
});
