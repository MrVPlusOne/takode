// @vitest-environment jsdom
import { fireEvent, render, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";

import {
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../../shared/synced-projection.js";
import type { ChatViewMockStoreState } from "../test-fixtures/chat-view-test-store.js";
import {
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
  type LeaderThreadTabsProjectionValueOverrides,
} from "../test-fixtures/leader-thread-tabs-projection.js";

let mockState: ChatViewMockStoreState;
const mockUnarchiveSession = vi.fn().mockResolvedValue({});
const mockRelaunchSession = vi.fn().mockResolvedValue({});
const mockMarkNotificationDone = vi.fn().mockResolvedValue({});
const mockOpenQuestOverlay = vi.fn();
const mockSendToSession = vi.fn((_sessionId: string, _msg: unknown) => true);
function resetStore(overrides: Partial<ChatViewMockStoreState> = {}) {
  mockState = {
    pendingPermissions: new Map(),
    connectionStatus: new Map([["s1", "connected"]]),
    sessions: new Map([["s1", { backend_state: "connected", backend_error: null }]]),
    cliConnected: new Map([["s1", true]]),
    cliEverConnected: new Map([["s1", true]]),
    cliDisconnectReason: new Map([["s1", null]]),
    serverReachable: true,
    sessionStatus: new Map([["s1", "idle"]]),
    sdkSessions: [{ sessionId: "s1", archived: false }],
    sessionAttention: new Map(),
    sessionNotifications: new Map(),
    sessionAttentionRecords: new Map(),
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    leaderProjections: new Map(),
    syncedProjectionValues: new Map(),
    syncedProjectionKeys: new Set(),
    sessionTaskHistory: new Map(),
    messages: new Map(),
    historyLoading: new Map(),
    threadWindows: new Map(),
    quests: [],
    zoomLevel: 1,
    openQuestOverlay: mockOpenQuestOverlay,
    ...overrides,
  };
}

function leaderTab(
  threadKey: string,
  title: string,
  overrides: Parameters<typeof createLeaderThreadTabsProjectionTab>[1] = {},
) {
  return createLeaderThreadTabsProjectionTab(threadKey, { title, ...overrides });
}

function leaderTabsProjectionState(
  tabs: LeaderThreadTabsProjectionValue["tabs"],
  overrides: Omit<LeaderThreadTabsProjectionValueOverrides, "tabs"> = {},
  sessionId = "s1",
): Pick<ChatViewMockStoreState, "syncedProjectionValues" | "syncedProjectionKeys"> {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, sessionId);
  const value = createLeaderThreadTabsProjectionValue({
    tabState: { version: 1 },
    mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
    threadStatuses: {},
    activePhaseSummary: [],
    ...overrides,
    tabs: [...tabs],
  });
  return {
    syncedProjectionValues: new Map([[entryId, value]]),
    syncedProjectionKeys: new Set([entryId]),
  };
}

function setLeaderTabsProjection(
  tabs: LeaderThreadTabsProjectionValue["tabs"],
  overrides: Omit<LeaderThreadTabsProjectionValueOverrides, "tabs"> = {},
  sessionId = "s1",
): void {
  Object.assign(mockState, leaderTabsProjectionState(tabs, overrides, sessionId));
}

function currentLeaderTabsProjection(sessionId: string): LeaderThreadTabsProjectionValue | null {
  const entryId = syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, sessionId);
  const value = mockState.syncedProjectionValues.get(entryId);
  return value &&
    typeof value === "object" &&
    (value as { currentQuestStateVersion?: number }).currentQuestStateVersion === 1
    ? (value as LeaderThreadTabsProjectionValue)
    : null;
}

vi.mock("../store.js", () => ({
  useStore: (selector: (s: ChatViewMockStoreState) => unknown) => {
    // Simulates the useSyncExternalStore stability check so selectors do not
    // reintroduce fresh empty arrays/objects that can loop in React.
    const selected = selector(mockState);
    const repeated = selector(mockState);
    if (!Object.is(selected, repeated)) {
      throw new Error("Unstable useStore selector result");
    }
    return selected;
  },
  getSessionSearchState: () => ({
    query: "",
    isOpen: false,
    mode: "strict",
    category: "all",
    matches: [],
    currentMatchIndex: -1,
  }),
}));

vi.mock("../hooks/useSessionSearch.js", () => ({
  useSessionSearch: () => {},
}));

vi.mock("./SearchBar.js", () => ({
  SearchBar: () => null,
}));

vi.mock("../api.js", () => ({
  api: {
    relaunchSession: (...args: unknown[]) => mockRelaunchSession(...args),
    unarchiveSession: (...args: unknown[]) => mockUnarchiveSession(...args),
    markNotificationDone: (...args: unknown[]) => mockMarkNotificationDone(...args),
  },
}));

vi.mock("../ws.js", () => ({
  sendToSession: (sessionId: string, msg: unknown) => mockSendToSession(sessionId, msg),
}));

vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({
    sessionId,
    threadKey,
    projectThreadRoutes,
    latestIndicatorMode,
    onSelectThread,
    additionalAttentionRecords = [],
  }: {
    sessionId: string;
    threadKey?: string;
    projectThreadRoutes?: boolean;
    latestIndicatorMode?: string;
    onSelectThread?: (threadKey: string) => void;
    additionalAttentionRecords?: Array<import("../types.js").SessionAttentionRecord>;
  }) => (
    <div
      data-testid="message-feed"
      data-thread-key={threadKey}
      data-project-thread-routes={String(projectThreadRoutes)}
      data-latest-indicator-mode={latestIndicatorMode}
      data-additional-attention-count={additionalAttentionRecords.length}
      data-additional-attention-types={additionalAttentionRecords.map((record) => record.type).join(",")}
    >
      {sessionId}
      {onSelectThread && (
        <button type="button" data-testid="mock-feed-thread-jump" onClick={() => onSelectThread("q-941")}>
          Jump to q-941
        </button>
      )}
    </div>
  ),
}));

vi.mock("./Composer.js", () => ({
  Composer: ({
    threadKey,
    questId,
    transcriptionThreadKey,
  }: {
    threadKey?: string;
    questId?: string;
    transcriptionThreadKey?: string;
  }) => (
    <div
      data-testid="composer"
      data-thread-key={threadKey}
      data-quest-id={questId}
      data-transcription-thread-key={transcriptionThreadKey}
    />
  ),
}));

vi.mock("./PermissionBanner.js", () => ({
  PermissionBanner: () => <div data-testid="permission-banner" />,
  PlanReviewOverlay: () => <div data-testid="plan-review-overlay" />,
  PlanCollapsedChip: () => <div data-testid="plan-collapsed-chip" />,
  PermissionsCollapsedChip: () => <div data-testid="permissions-collapsed-chip" />,
}));

vi.mock("./TaskOutlineBar.js", () => ({
  TaskOutlineBar: ({ sessionId }: { sessionId: string }) => {
    const taskHistory = mockState.sessionTaskHistory.get(sessionId);
    if (!taskHistory || taskHistory.length === 0) return null;
    return <div data-testid="task-outline-bar">{taskHistory[0]?.title}</div>;
  },
}));

vi.mock("./TodoStatusLine.js", () => ({
  TodoStatusLine: () => <div data-testid="todo-status-line" />,
}));

vi.mock("./WorkBoardBar.js", () => ({
  WorkBoardBar: ({
    sessionId,
    currentThreadKey,
    currentThreadLabel,
    onReturnToMain,
    onSelectThread,
    openThreadKeys = [],
    onCloseThreadTab,
  }: {
    sessionId: string;
    currentThreadKey?: string;
    currentThreadLabel?: string;
    onReturnToMain?: () => void;
    onSelectThread?: (threadKey: string) => void;
    openThreadKeys?: string[];
    onCloseThreadTab?: (threadKey: string, nextThreadKey?: string) => void;
  }) => {
    const projection = currentLeaderTabsProjection(sessionId);
    const projectedRows =
      projection?.tabs.map((tab) => ({
        threadKey: tab.threadKey,
        questId: tab.questId ?? undefined,
        title: tab.title ?? tab.questId ?? tab.threadKey,
      })) ?? [];
    const projectedAttentionCount = [
      ...(projection ? [projection.mainAttention] : []),
      ...(projection?.tabs.map((tab) => tab.attention) ?? []),
    ].filter((attention) => attention.needsInput || attention.mutedNeedsInput || attention.reviewUnread).length;
    return (
      <div
        data-testid="work-board-bar"
        data-current-thread-key={currentThreadKey}
        data-current-thread-label={currentThreadLabel}
        data-attention-count={projectedAttentionCount}
        data-open-thread-keys={openThreadKeys.join(",")}
      >
        {onSelectThread && (
          <>
            <button type="button" data-testid="mock-workboard-main" onClick={() => onSelectThread("main")}>
              Main
            </button>
            <button type="button" data-testid="mock-workboard-all" onClick={() => onSelectThread("all")}>
              All Threads
            </button>
            {projectedRows.map((row) => (
              <button
                type="button"
                key={row.threadKey}
                data-testid="mock-workboard-thread"
                data-thread-key={row.threadKey}
                onClick={() => onSelectThread(row.threadKey)}
              >
                {row.questId ?? row.threadKey} {row.title}
              </button>
            ))}
          </>
        )}
        {onCloseThreadTab &&
          openThreadKeys.map((threadKey, index) => (
            <button
              type="button"
              key={`close-${threadKey}`}
              data-testid="mock-workboard-close-tab"
              data-thread-key={threadKey}
              onClick={() => onCloseThreadTab(threadKey, openThreadKeys[index + 1])}
            >
              Close {threadKey}
            </button>
          ))}
        {onReturnToMain && (
          <button type="button" onClick={onReturnToMain}>
            Return to Main
          </button>
        )}
      </div>
    );
  },
}));

vi.mock("./CatIcons.js", () => ({
  YarnBallDot: () => <span data-testid="yarnball-dot" />,
}));

vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({
    questId,
    children,
    className,
    stopPropagation,
  }: {
    questId: string;
    children?: ReactNode;
    className?: string;
    stopPropagation?: boolean;
  }) => (
    <a href={`#quest-${questId}`} className={className} onClick={(event) => stopPropagation && event.stopPropagation()}>
      {children ?? questId}
    </a>
  ),
}));

vi.mock("./SessionInlineLink.js", () => ({
  SessionInlineLink: ({
    sessionNum,
    children,
    className,
    dataTestId,
    ariaLabel,
    title,
    threadKey,
    stopPropagation,
  }: {
    sessionNum?: number | null;
    children: ReactNode;
    className?: string;
    dataTestId?: string;
    ariaLabel?: string;
    title?: string;
    threadKey?: string | null;
    stopPropagation?: boolean;
  }) => (
    <a
      href={`#session-${sessionNum ?? "unknown"}${threadKey ? `?thread=${threadKey}` : ""}`}
      className={className}
      data-testid={dataTestId}
      aria-label={ariaLabel}
      title={title}
      onClick={(event) => stopPropagation && event.stopPropagation()}
    >
      {children}
    </a>
  ),
}));

vi.mock("./SessionStatusDot.js", () => ({
  SessionStatusDot: ({
    isConnected,
    sdkState,
    status,
    archived,
  }: {
    isConnected: boolean;
    sdkState?: string | null;
    status?: string | null;
    archived?: boolean;
  }) => {
    const visualStatus = archived
      ? "archived"
      : !isConnected && sdkState !== "starting"
        ? "disconnected"
        : status || "idle";
    return <span data-testid="session-status-dot" data-status={visualStatus} />;
  },
}));

vi.mock("./QuestJourneyTimeline.js", () => ({
  isCompletedJourneyPresentationStatus: (status?: string | null) => {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized === "done" || normalized === "completed" || normalized === "needs_verification";
  },
  QuestJourneyPreviewCard: ({
    quest,
    journey,
  }: {
    quest?: { questId: string; title?: string };
    journey?: { currentPhaseId?: string; phaseNotes?: Record<string, string> };
  }) => {
    const notes = Object.values(journey?.phaseNotes ?? {}).filter((note) => note.trim()).length;
    return (
      <div data-testid="quest-journey-preview-card">
        {quest?.questId} {quest?.title} {journey?.currentPhaseId ?? "journey"}{" "}
        {notes > 0 ? `${notes} note${notes === 1 ? "" : "s"}` : ""}
      </div>
    );
  },
  QuestJourneyTimeline: ({
    journey,
    status,
    compact,
    className,
    showNotes = true,
  }: {
    journey?: { currentPhaseId?: string; phaseIds?: string[]; phaseNotes?: Record<string, string> };
    status?: string | null;
    compact?: boolean;
    className?: string;
    showNotes?: boolean;
  }) => {
    const normalized = (status ?? "").trim().toLowerCase();
    const completed = normalized === "done" || normalized === "completed" || normalized === "needs_verification";
    const notes = Object.values(journey?.phaseNotes ?? {}).filter((note) => note.trim()).length;
    const phaseCount = journey?.phaseIds?.length ?? 0;
    return (
      <div
        data-testid={compact ? "quest-journey-compact-summary" : "quest-journey-timeline"}
        data-journey-mode={completed ? "completed" : "active"}
        className={className}
      >
        {completed
          ? `Completed ${phaseCount} phases${showNotes && notes > 0 ? ` ${notes} note${notes === 1 ? "" : "s"}` : ""}`
          : (journey?.currentPhaseId ?? "journey")}
      </div>
    );
  },
}));

import { ChatView } from "./ChatView.js";
import { persistLeaderSelectedThreadKey, SAVE_THREAD_VIEWPORT_EVENT } from "../utils/thread-viewport.js";
import { clearFrontendPerfEntries } from "../utils/frontend-perf-recorder.js";
import { runCachedWarmThreadNavigationRegression } from "./chat-view-warm-navigation-regression.js";

beforeEach(() => {
  resetStore();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  window.location.hash = "#/session/s1";
  mockUnarchiveSession.mockClear();
  mockRelaunchSession.mockClear();
  mockMarkNotificationDone.mockClear();
  mockOpenQuestOverlay.mockClear();
  mockSendToSession.mockClear();
  clearFrontendPerfEntries();
});

describe("ChatView archived banner", () => {
  it("renders archived banner and triggers unarchive action", () => {
    // Validates that archived-session state is surfaced directly in chat
    // and that the banner action sends the unarchive API request.
    resetStore({
      sdkSessions: [{ sessionId: "s1", archived: true }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    expect(scope.getByText("This session is archived. History is read-only.")).toBeInTheDocument();
    fireEvent.click(scope.getByRole("button", { name: "Unarchive" }));
    expect(mockUnarchiveSession).toHaveBeenCalledWith("s1");
  });

  it("does not render archived banner for active sessions", () => {
    // Guards against false positives: non-archived sessions should keep
    // the existing chat chrome without the archival warning banner.
    resetStore({
      sdkSessions: [{ sessionId: "s1", archived: false }],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.queryByText("This session is archived. History is read-only.")).not.toBeInTheDocument();
  });
});

describe("ChatView backend banners", () => {
  function expectLiveBannerBetweenFeedAndComposer(container: HTMLElement) {
    const feed = within(container).getByTestId("message-feed");
    const banner = within(container).getByTestId("live-connection-status-banner");
    const composer = within(container).getByTestId("composer");

    expect(feed.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(banner.compareDocumentPosition(composer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  it("shows the startup banner for a freshly launched session even without explicit backend_state", () => {
    // Claude/SDK sessions do not always populate backend_state during startup,
    // so the live chat-surface banner still needs to key off the first-connect path.
    resetStore({
      sessions: new Map([["s1", { backend_state: "disconnected", backend_error: null }]]),
      sdkSessions: [{ sessionId: "s1", state: "starting", archived: false }],
      cliConnected: new Map([["s1", false]]),
      cliEverConnected: new Map(),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByText("Starting session...")).toBeInTheDocument();
    expectLiveBannerBetweenFeedAndComposer(view.container);
  });

  it("shows the broken-session banner and relaunch action", () => {
    // Broken Codex sessions should stay visibly broken until the user relaunches,
    // rather than falling back to the generic disconnected banner.
    resetStore({
      sessions: new Map([
        ["s1", { backend_state: "broken", backend_error: "Codex initialization failed: Transport closed" }],
      ]),
      cliConnected: new Map([["s1", false]]),
      cliEverConnected: new Map([["s1", true]]),
      cliDisconnectReason: new Map([["s1", "broken"]]),
      sessionStatus: new Map([["s1", null]]),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByText("Codex initialization failed: Transport closed")).toBeInTheDocument();
    expectLiveBannerBetweenFeedAndComposer(view.container);
    fireEvent.click(scope.getByRole("button", { name: "Relaunch" }));
    expect(mockRelaunchSession).toHaveBeenCalledWith("s1");
  });

  it("does not show a full-width banner for recoverable auto-relaunch", () => {
    resetStore({
      sessions: new Map([["s1", { backend_state: "recovering", backend_error: null }]]),
      cliConnected: new Map([["s1", false]]),
      cliEverConnected: new Map([["s1", true]]),
      cliDisconnectReason: new Map([["s1", null]]),
      sessionStatus: new Map([["s1", null]]),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.queryByTestId("live-connection-status-banner")).not.toBeInTheDocument();
    expect(scope.getByTestId("message-feed")).toBeInTheDocument();
    expect(scope.getByTestId("composer")).toBeInTheDocument();
    expect(scope.queryByText("Session disconnected")).not.toBeInTheDocument();
  });

  it("shows the recovery-suppressed banner and fresh-cycle reconnect action", () => {
    resetStore({
      sessions: new Map([
        ["s1", { backend_state: "recovery_suppressed", backend_error: "Automatic recovery failed after 5 attempts." }],
      ]),
      cliConnected: new Map([["s1", false]]),
      cliEverConnected: new Map([["s1", true]]),
      cliDisconnectReason: new Map([["s1", "recovery_suppressed"]]),
      sessionStatus: new Map([["s1", null]]),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByText("Automatic recovery failed after 5 attempts.")).toBeInTheDocument();
    expectLiveBannerBetweenFeedAndComposer(view.container);
    fireEvent.click(scope.getByRole("button", { name: "Reconnect" }));
    expect(mockRelaunchSession).toHaveBeenCalledWith("s1");
  });

  it("keeps ordinary backend disconnects out of the prominent banner path", () => {
    resetStore({
      sessions: new Map([["s1", { backend_state: "disconnected", backend_error: null }]]),
      sdkSessions: [{ sessionId: "s1", state: "exited", archived: false }],
      cliConnected: new Map([["s1", false]]),
      cliEverConnected: new Map(),
      cliDisconnectReason: new Map([["s1", null]]),
      sessionStatus: new Map([["s1", null]]),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.queryByTestId("live-connection-status-banner")).not.toBeInTheDocument();
    expect(scope.queryByText("Starting session...")).not.toBeInTheDocument();
    expect(scope.getByTestId("message-feed")).toBeInTheDocument();
    expect(scope.getByTestId("composer")).toBeInTheDocument();
  });

  it("renders the WebSocket reconnect banner near the composer", () => {
    resetStore({
      connectionStatus: new Map([["s1", "disconnected"]]),
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByText("Reconnecting to session...")).toBeInTheDocument();
    expectLiveBannerBetweenFeedAndComposer(view.container);
  });

  it("renders the server unreachable banner inside the chat surface near the composer", () => {
    resetStore({
      serverReachable: false,
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);
    expect(scope.getByText("Server unreachable")).toBeInTheDocument();
    expectLiveBannerBetweenFeedAndComposer(view.container);
  });

  it("surfaces server unreachable inside search preview chat even without composer controls", () => {
    // Search preview mode intentionally suppresses live controls, but server
    // reachability is still live app state and must not disappear entirely.
    resetStore({
      serverReachable: false,
    });

    const view = render(<ChatView sessionId="s1" preview />);
    const scope = within(view.container);
    const feed = scope.getByTestId("message-feed");
    const banner = scope.getByTestId("live-connection-status-banner");

    expect(scope.getByText("Previewing search result. Press Enter to select this conversation.")).toBeInTheDocument();
    expect(scope.getByText("Server unreachable")).toBeInTheDocument();
    expect(scope.queryByTestId("composer")).not.toBeInTheDocument();
    expect(feed.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
