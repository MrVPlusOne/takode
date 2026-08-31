// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useSyncExternalStore, type ReactNode } from "react";
import { persistLeaderSelectedThreadKey, readLeaderSelectedThreadKey } from "../utils/thread-viewport.js";
import { parseHash, threadRouteFromHash } from "../utils/routing.js";
import { needsInputNotification, threadMessage } from "./chat-view-leader-tabs-fixtures.js";
import { installChatViewLeaderProjection } from "../test-fixtures/chat-view-leader-projection.js";

const QUEST_ID = "q-1944";
const LEADER_SESSION_ID = "leader-a";
const OTHER_SESSION_ID = "leader-b";

let mockState: ReturnType<typeof createMockState>;
const mockSendToSession = vi.fn((_sessionId: string, _message: unknown) => true);

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

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (state: typeof mockState) => unknown) => selector(mockState), {
    getState: () => mockState,
  }),
  countUserPermissions: (permissions: Map<string, unknown> | undefined) => permissions?.size ?? 0,
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
  Composer: ({ threadKey }: { threadKey?: string }) => <div data-testid="composer" data-thread-key={threadKey} />,
}));
vi.mock("./PermissionBanner.js", () => ({
  PermissionBanner: () => null,
  PlanReviewOverlay: () => null,
  PlanCollapsedChip: () => null,
  PermissionsCollapsedChip: () => null,
}));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({ sessionId, threadKey }: { sessionId: string; threadKey?: string }) => (
    <div data-testid="message-feed" data-session-id={sessionId} data-thread-key={threadKey} />
  ),
}));
vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    currentThreadKey,
    onSelectThread,
    openThreadKeys = [],
    threadRows = [],
  }: {
    currentThreadKey?: string;
    onSelectThread?: (threadKey: string) => void;
    openThreadKeys?: string[];
    threadRows?: Array<{ threadKey: string; title: string }>;
  }) => (
    <div data-testid="work-board-bar" data-current-thread-key={currentThreadKey}>
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
vi.mock("./GlobalNeedsInputMenu.js", () => ({ GlobalNeedsInputMenu: () => null }));
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
  mockState = createMockState();
  installChatViewLeaderProjection(mockState, LEADER_SESSION_ID, [QUEST_ID]);
  installChatViewLeaderProjection(mockState, OTHER_SESSION_ID, []);
  mockSendToSession.mockClear();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  history.replaceState(null, "", `#/session/${LEADER_SESSION_ID}?thread=${QUEST_ID}`);
});

describe("ChatView passive leader-session returns", () => {
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
