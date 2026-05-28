// @vitest-environment jsdom
import { render, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";

interface MockStoreState {
  pendingPermissions: Map<string, Map<string, { tool_name?: string; request_id?: string }>>;
  connectionStatus: Map<string, "connecting" | "connected" | "disconnected">;
  sessions: Map<
    string,
    {
      backend_state?: "connected" | "disconnected";
      backend_error?: string | null;
      isOrchestrator?: boolean;
      claimedQuestId?: string | null;
      claimedQuestTitle?: string | null;
      claimedQuestStatus?: string | null;
      claimedQuestLeaderSessionId?: string | null;
    }
  >;
  cliConnected: Map<string, boolean>;
  cliEverConnected: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | "recovery_suppressed" | null>;
  serverReachable: boolean;
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  sdkSessions: Array<{
    sessionId: string;
    archived?: boolean;
    isOrchestrator?: boolean;
    sessionNum?: number;
    herdedBy?: string;
  }>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  sessionNotifications: Map<string, import("../types.js").SessionNotification[]>;
  sessionAttentionRecords: Map<string, import("../types.js").SessionAttentionRecord[]>;
  sessionBoards: Map<string, unknown[]>;
  sessionCompletedBoards: Map<string, unknown[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  leaderProjections: Map<string, import("../types.js").LeaderProjectionSnapshot>;
  sessionTaskHistory: Map<string, Array<{ title: string; triggerMessageId: string }>>;
  messages: Map<string, unknown[]>;
  historyLoading: Map<string, boolean>;
  quests: Array<Record<string, unknown> & { questId: string; title: string; status: string; createdAt: number }>;
  zoomLevel: number;
  openQuestOverlay: (questId: string) => void;
}

let mockState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
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
    sessionTaskHistory: new Map(),
    messages: new Map(),
    historyLoading: new Map(),
    quests: [],
    zoomLevel: 1,
    openQuestOverlay: vi.fn(),
    ...overrides,
  };
}

vi.mock("../store.js", () => {
  const useStore = (selector: (s: MockStoreState) => unknown) => selector(mockState);
  useStore.getState = () => mockState;
  return { useStore };
});

vi.mock("../hooks/useSessionSearch.js", () => ({ useSessionSearch: () => {} }));
vi.mock("../api.js", () => ({
  api: {
    relaunchSession: vi.fn(),
    unarchiveSession: vi.fn(),
    markNotificationDone: vi.fn(),
  },
}));
vi.mock("../ws.js", () => ({ sendToSession: vi.fn() }));
vi.mock("./SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./MessageFeed.js", () => ({
  MessageFeed: ({ sessionId, threadKey }: { sessionId: string; threadKey?: string }) => (
    <div data-testid="message-feed" data-thread-key={threadKey}>
      {sessionId}
    </div>
  ),
}));
vi.mock("./Composer.js", () => ({
  Composer: ({ threadKey, questId }: { threadKey?: string; questId?: string }) => (
    <div data-testid="composer" data-thread-key={threadKey} data-quest-id={questId} />
  ),
}));
vi.mock("./PermissionBanner.js", () => ({
  PermissionBanner: () => null,
  PlanReviewOverlay: () => null,
  PlanCollapsedChip: () => null,
  PermissionsCollapsedChip: () => null,
}));
vi.mock("./TaskOutlineBar.js", () => ({
  TaskOutlineBar: ({ sessionId }: { sessionId: string }) => {
    const taskHistory = mockState.sessionTaskHistory.get(sessionId);
    if (!taskHistory?.length) return null;
    return <div data-testid="task-outline-bar">{taskHistory[0].title}</div>;
  },
}));
vi.mock("./TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./WorkBoardBar.js", () => ({ WorkBoardBar: () => <div data-testid="work-board-bar" /> }));
vi.mock("./CatIcons.js", () => ({ YarnBallDot: () => null }));
vi.mock("./QuestInlineLink.js", () => ({
  QuestInlineLink: ({
    questId,
    children,
    className,
  }: {
    questId: string;
    children?: ReactNode;
    className?: string;
  }) => (
    <a href={`#quest-${questId}`} className={className}>
      {children ?? questId}
    </a>
  ),
}));
vi.mock("./SessionInlineLink.js", () => ({
  SessionInlineLink: ({
    sessionNum,
    children,
    ariaLabel,
    threadKey,
  }: {
    sessionNum?: number | null;
    children: ReactNode;
    ariaLabel?: string;
    threadKey?: string | null;
  }) => (
    <a href={`#session-${sessionNum ?? "unknown"}${threadKey ? `?thread=${threadKey}` : ""}`} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));
vi.mock("./SessionStatusDot.js", () => ({ SessionStatusDot: () => null }));
vi.mock("./QuestJourneyTimeline.js", () => ({
  isCompletedJourneyPresentationStatus: (status?: string | null) => {
    const normalized = (status ?? "").trim().toLowerCase();
    return normalized === "done" || normalized === "completed" || normalized === "needs_verification";
  },
  QuestJourneyPreviewCard: () => <div data-testid="quest-journey-preview-card" />,
  QuestJourneyTimeline: ({ journey }: { journey?: { currentPhaseId?: string } }) => (
    <div data-testid="quest-journey-compact-summary">{journey?.currentPhaseId ?? "journey"}</div>
  ),
}));

import { ChatView } from "./ChatView.js";

beforeEach(() => {
  resetStore();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
});

describe("ChatView session quest context", () => {
  it("uses persisted Journey assignment for a worker whose quest owner is an earlier session", () => {
    resetStore({
      sdkSessions: [
        { sessionId: "s1", archived: false, sessionNum: 1946, herdedBy: "leader-1450" },
        { sessionId: "leader-1450", archived: false, isOrchestrator: true, sessionNum: 1563 },
      ],
      sessionTaskHistory: new Map([["s1", [{ title: "review", triggerMessageId: "m1" }]]]),
      quests: [
        {
          questId: "q-1450",
          title: "Reassess Takode non-leader Codex auto-compact setting",
          status: "in_progress",
          sessionId: "earlier-owner",
          leaderSessionId: "leader-1450",
          createdAt: 1,
          journeyRuns: [
            {
              runId: "run-1450",
              leaderSessionId: "leader-1450",
              workerSessionId: "s1",
              workerSessionNum: 1946,
              source: "board",
              phaseIds: ["alignment", "implement", "port"],
              status: "active",
              createdAt: 1,
              updatedAt: 10,
              phaseOccurrences: [
                {
                  occurrenceId: "run-1450:p2",
                  phaseId: "implement",
                  phaseIndex: 1,
                  phasePosition: 2,
                  phaseOccurrence: 1,
                  status: "active",
                  boardState: "IMPLEMENTING",
                  assigneeSessionId: "s1",
                  assigneeSessionNum: 1946,
                },
              ],
            },
          ],
        },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    const banner = scope.getByTestId("quest-thread-banner");
    expect(banner).toHaveAttribute("data-variant", "session");
    expect(banner).toHaveTextContent("q-1450");
    expect(banner).toHaveTextContent("Reassess Takode non-leader Codex auto-compact setting");
    expect(scope.getByTestId("quest-journey-compact-summary")).toHaveTextContent("implement");
    expect(scope.getByLabelText("Leader #1563")).toHaveAttribute("href", "#session-1563?thread=q-1450");
    expect(scope.queryByTestId("task-outline-bar")).not.toBeInTheDocument();
  });

  it("uses active board reviewer assignment as session quest context", () => {
    resetStore({
      sdkSessions: [
        { sessionId: "s1", archived: false, sessionNum: 1947, herdedBy: "leader-1450" },
        { sessionId: "leader-1450", archived: false, isOrchestrator: true, sessionNum: 1563 },
      ],
      sessionTaskHistory: new Map([["s1", [{ title: "skip", triggerMessageId: "m1" }]]]),
      sessionBoards: new Map([
        [
          "leader-1450",
          [
            {
              questId: "q-1450",
              title: "Reassess Takode non-leader Codex auto-compact setting",
              worker: "worker-1450",
              workerNum: 1946,
              status: "CODE_REVIEWING",
              updatedAt: 10,
              createdAt: 1,
              journey: { mode: "active", phaseIds: ["implement", "code-review"], currentPhaseId: "code-review" },
            },
          ],
        ],
      ]),
      sessionBoardRowStatuses: new Map([
        [
          "leader-1450",
          {
            "q-1450": {
              worker: { sessionId: "worker-1450", sessionNum: 1946, status: "idle" },
              reviewer: { sessionId: "s1", sessionNum: 1947, status: "running" },
            },
          },
        ],
      ]),
      quests: [
        {
          questId: "q-1450",
          title: "Reassess Takode non-leader Codex auto-compact setting",
          status: "in_progress",
          sessionId: "earlier-owner",
          leaderSessionId: "leader-1450",
          createdAt: 1,
        },
      ],
    });

    const view = render(<ChatView sessionId="s1" />);
    const scope = within(view.container);

    const banner = scope.getByTestId("quest-thread-banner");
    expect(banner).toHaveTextContent("q-1450");
    expect(scope.getByLabelText("Leader #1563")).toHaveAttribute("href", "#session-1563?thread=q-1450");
    expect(scope.getByTestId("quest-journey-compact-summary")).toHaveTextContent("code-review");
    expect(scope.queryByTestId("task-outline-bar")).not.toBeInTheDocument();
  });
});
