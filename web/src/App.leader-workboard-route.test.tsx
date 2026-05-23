// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import type { SessionState } from "./types.js";

const mockConnectSession = vi.fn();
const mockDisconnectSession = vi.fn();
const mockRefreshSessionGitStatus = vi.fn().mockResolvedValue({ ok: true });

vi.mock("./api.js", () => ({
  api: {
    markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
    listSessions: vi.fn().mockResolvedValue([]),
    listQuests: vi.fn().mockResolvedValue([]),
    refreshSessionGitStatus: (...args: unknown[]) => mockRefreshSessionGitStatus(...args),
    relaunchSession: vi.fn().mockResolvedValue({ ok: true }),
    getSessionNotifications: vi.fn().mockResolvedValue([]),
    fetchNotificationContext: vi.fn().mockResolvedValue(null),
    markNotificationDone: vi.fn().mockResolvedValue({ ok: true }),
    updateLeaderProfilePortrait: vi.fn(),
  },
  checkHealth: vi.fn().mockResolvedValue(true),
}));

vi.mock("./ws.js", () => ({
  connectSession: (...args: unknown[]) => mockConnectSession(...args),
  disconnectSession: (...args: unknown[]) => mockDisconnectSession(...args),
  sendToSession: vi.fn(() => true),
  sendVsCodeSelectionUpdate: vi.fn(),
}));

vi.mock("./session-list-hydration.js", () => ({
  hydrateSessionList: vi.fn(),
  installActiveSessionMetadataRefreshListeners: vi.fn(() => vi.fn()),
}));

vi.mock("./components/Sidebar.js", () => ({
  Sidebar: () => <div data-testid="sidebar" />,
}));
vi.mock("./components/TaskPanel.js", () => ({
  TaskPanel: () => <div data-testid="task-panel" />,
}));
vi.mock("./components/DiffPanel.js", () => ({
  DiffPanel: ({ sessionId }: { sessionId: string }) => <div data-testid="diff-panel" data-session-id={sessionId} />,
}));
vi.mock("./components/EmptyState.js", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}));
vi.mock("./components/Playground.js", () => ({
  Playground: () => <div data-testid="playground" />,
}));
vi.mock("./components/SettingsPage.js", () => ({
  SettingsPage: () => <div data-testid="settings-page" />,
}));
vi.mock("./components/LogsPage.js", () => ({
  LogsPage: () => <div data-testid="logs-page" />,
}));
vi.mock("./components/EnvManager.js", () => ({
  EnvManager: () => <div data-testid="env-manager" />,
}));
vi.mock("./components/ActiveTimersPage.js", () => ({
  ActiveTimersPage: () => <div data-testid="active-timers-page" />,
}));
vi.mock("./components/MemoryPage.js", () => ({
  MemoryPage: () => <div data-testid="memory-page" />,
}));
vi.mock("./components/TerminalPage.js", () => ({
  TerminalPage: () => <div data-testid="terminal-page" />,
}));
vi.mock("./components/SessionCreationView.js", () => ({
  SessionCreationView: () => <div data-testid="session-creation-view" />,
}));
vi.mock("./components/NewSessionModal.js", () => ({
  NewSessionModal: () => null,
}));
vi.mock("./components/QuestmasterPage.js", () => ({
  QuestmasterPage: () => <div data-testid="questmaster-page" />,
}));
vi.mock("./components/QuestDetailPanel.js", () => ({
  QuestDetailPanel: () => null,
}));
vi.mock("./components/UniversalSearchOverlay.js", () => ({
  UniversalSearchOverlay: () => null,
}));
vi.mock("./components/SessionInfoPopover.js", () => ({
  SessionInfoPopover: () => <div data-testid="session-info-popover" />,
}));
vi.mock("./components/SearchBar.js", () => ({ SearchBar: () => null }));
vi.mock("./components/TaskOutlineBar.js", () => ({ TaskOutlineBar: () => null }));
vi.mock("./components/TodoStatusLine.js", () => ({ TodoStatusLine: () => null }));
vi.mock("./components/Composer.js", () => ({
  Composer: ({ threadKey }: { threadKey?: string }) => <div data-testid="composer" data-thread-key={threadKey} />,
}));
vi.mock("./components/PermissionBanner.js", () => ({
  PermissionBanner: () => null,
  PlanReviewOverlay: () => null,
  PlanCollapsedChip: () => null,
  PermissionsCollapsedChip: () => null,
}));
vi.mock("./components/MessageFeed.js", () => ({
  MessageFeed: ({ sessionId, threadKey }: { sessionId: string; threadKey?: string }) => (
    <div data-testid="message-feed" data-session-id={sessionId} data-thread-key={threadKey} />
  ),
}));
vi.mock("./components/QuestInlineLink.js", () => ({
  QuestInlineLink: ({ questId, children }: { questId: string; children?: ReactNode }) => (
    <span>{children ?? questId}</span>
  ),
}));
vi.mock("./components/SessionInlineLink.js", () => ({
  SessionInlineLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./components/CatIcons.js", () => ({ PowerPlugDot: () => null, YarnBallDot: () => null }));
vi.mock("./components/session-participant-status.js", () => ({ useParticipantSessionStatusDotProps: () => ({}) }));
vi.mock("./utils/vscode-context.js", () => ({
  announceVsCodeReady: vi.fn(),
  maybeReadVsCodeSelectionContext: vi.fn(() => undefined),
}));
vi.mock("./utils/vscode-bridge.js", () => ({
  ensureVsCodeEditorPreference: vi.fn().mockResolvedValue(undefined),
}));

import App from "./App.js";
import { useStore } from "./store.js";
import { resetSessionGitStatusAutoRefreshForTest } from "./utils/session-git-status-auto-refresh.js";

const SESSION_ID = "playground-board-bar";

function seedLeaderRouteFixture({ sdkLeaderSession = true }: { sdkLeaderSession?: boolean } = {}) {
  const now = Date.now();
  useStore.setState({
    currentSessionId: null,
    sdkSessions: sdkLeaderSession
      ? [
          {
            sessionId: SESSION_ID,
            createdAt: now,
            archived: false,
            cwd: "/mock/playground",
            isOrchestrator: true,
            name: "Leader Route Fixture",
            sessionNum: 402,
            state: "connected",
          },
          {
            sessionId: "playground-worker",
            createdAt: now - 50_000,
            archived: false,
            cwd: "/mock/worker",
            name: "Quest Worker",
            sessionNum: 403,
            state: "connected",
          },
        ]
      : [],
    sessions: new Map([
      [
        SESSION_ID,
        {
          session_id: SESSION_ID,
          id: SESSION_ID,
          cwd: "/mock/playground",
          backend_state: "connected",
          backend_error: null,
          isOrchestrator: true,
          name: "Leader Route Fixture",
          sessionNum: 402,
        } as Partial<SessionState> as SessionState,
      ],
      [
        "playground-worker",
        {
          session_id: "playground-worker",
          id: "playground-worker",
          cwd: "/mock/worker",
          backend_state: "connected",
          backend_error: null,
          name: "Quest Worker",
          sessionNum: 403,
        } as Partial<SessionState> as SessionState,
      ],
    ]),
    sessionNames: new Map([[SESSION_ID, "Leader Route Fixture"]]),
    cliConnected: new Map([[SESSION_ID, true]]),
    cliEverConnected: new Map([[SESSION_ID, true]]),
    connectionStatus: new Map([[SESSION_ID, "connected"]]),
    sessionStatus: new Map([[SESSION_ID, "idle"]]),
    sessionBoards: new Map([
      [
        SESSION_ID,
        [
          {
            questId: "q-42",
            title: "Fix mobile sidebar overflow",
            worker: "playground-worker",
            workerNum: 403,
            status: "IMPLEMENTING",
            updatedAt: now - 1_000,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "implement", "code-review"],
              currentPhaseId: "implement",
            },
          },
        ],
      ],
    ]),
    sessionCompletedBoards: new Map([
      [
        SESSION_ID,
        [
          {
            questId: "q-41",
            title: "Completed quest",
            status: "DONE",
            updatedAt: now - 10_000,
            completedAt: now - 5_000,
          },
        ],
      ],
    ]),
    sessionBoardRowStatuses: new Map(),
    messages: new Map([
      [
        SESSION_ID,
        [
          {
            id: "m-q-42",
            role: "assistant",
            content: "q-42 update",
            timestamp: now,
            metadata: { threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }] },
          },
        ],
      ],
    ]),
    quests: [
      {
        id: "q-42-v1",
        questId: "q-42",
        version: 1,
        title: "Fix mobile sidebar overflow",
        status: "in_progress",
        description: "Keep narrow mobile layouts from clipping the primary shell.",
        createdAt: now - 60_000,
        sessionId: "playground-worker",
        claimedAt: now - 30_000,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetSessionGitStatusAutoRefreshForTest();
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  useStore.getState().reset();
  seedLeaderRouteFixture();
  window.location.hash = `#/session/${SESSION_ID}?thread=q-42`;
});

it("keeps the explicit leader quest-thread route stable while title-bar shortcuts open panels in place", async () => {
  render(<App />);

  await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-42"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);
  expect(screen.getByTestId("topbar-workboard-shortcut")).toHaveTextContent("1 Implement");
  expect(screen.getByTestId("topbar-workboard-shortcut")).not.toHaveTextContent("Workboard");

  fireEvent.click(screen.getByTestId("topbar-workboard-shortcut"));

  await waitFor(() => expect(screen.getByTestId("workboard-panel")).toHaveAttribute("data-view", "active"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);

  fireEvent.click(screen.getByTestId("topbar-workboard-shortcut"));

  await waitFor(() => expect(screen.queryByTestId("workboard-panel")).not.toBeInTheDocument());
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);
  expect(screen.getByTestId("topbar-completed-shortcut")).toHaveTextContent("1Completed");

  fireEvent.click(screen.getByTestId("topbar-completed-shortcut"));

  await waitFor(() => expect(screen.getByTestId("workboard-panel")).toHaveAttribute("data-view", "completed"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);

  fireEvent.click(screen.getByTestId("topbar-completed-shortcut"));

  await waitFor(() => expect(screen.queryByTestId("workboard-panel")).not.toBeInTheDocument());
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);
});

it("renders title-bar panels on a quest-thread route when leader metadata comes from session state", async () => {
  seedLeaderRouteFixture({ sdkLeaderSession: false });

  render(<App />);

  await waitFor(() => expect(screen.getByTestId("message-feed")).toHaveAttribute("data-thread-key", "q-42"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);
  expect(screen.getByTestId("topbar-workboard-shortcut")).toHaveTextContent("1 Implement");

  fireEvent.click(screen.getByTestId("topbar-workboard-shortcut"));

  await waitFor(() => expect(screen.getByTestId("workboard-panel")).toHaveAttribute("data-view", "active"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);

  fireEvent.click(screen.getByTestId("topbar-completed-shortcut"));

  await waitFor(() => expect(screen.getByTestId("workboard-panel")).toHaveAttribute("data-view", "completed"));
  expect(window.location.hash).toBe(`#/session/${SESSION_ID}?thread=q-42`);
});

it("targets the leader diff from the Main thread in a leader session", async () => {
  useStore.setState({ activeTab: "diff" });
  window.location.hash = `#/session/${SESSION_ID}?thread=main`;

  render(<App />);

  await waitFor(() => expect(screen.getByTestId("diff-panel")).toHaveAttribute("data-session-id", SESSION_ID));
});

it("targets the quest worker diff from a leader quest thread", async () => {
  useStore.setState({ activeTab: "diff" });

  render(<App />);

  await waitFor(() => expect(screen.getByTestId("diff-panel")).toHaveAttribute("data-session-id", "playground-worker"));
  expect(screen.getByTestId("diff-target-banner")).toHaveTextContent("q-42 worker diff");
});

it("shows an explicit unavailable state for quest threads without workers", async () => {
  useStore.setState({
    activeTab: "diff",
    sessionBoards: new Map([
      [
        SESSION_ID,
        [{ questId: "q-42", title: "Fix mobile sidebar overflow", status: "QUEUED", updatedAt: Date.now() }],
      ],
    ]),
    sessionBoardRowStatuses: new Map(),
    quests: [],
  });

  render(<App />);

  await waitFor(() => expect(screen.getByTestId("diff-target-unavailable")).toBeInTheDocument());
  expect(screen.getByText("No worker session is assigned to q-42.")).toBeInTheDocument();
  expect(screen.queryByTestId("diff-panel")).not.toBeInTheDocument();
});
