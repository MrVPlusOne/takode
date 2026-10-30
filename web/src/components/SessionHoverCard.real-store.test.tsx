// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StrictMode } from "react";
import type { SessionTaskEntry } from "../../server/session-types.js";
import type { QuestmasterTask, SdkSessionInfo } from "../types.js";
import { useStore } from "../store.js";
import { hydrateSessionList } from "../session-list-hydration.js";
import type { SidebarSessionItem as SessionItemType } from "../utils/sidebar-session-item.js";
import { isSessionThreadRoute } from "../utils/routing.js";
import { SessionHoverCard } from "./SessionHoverCard.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "../test-fixtures/leader-thread-tabs-projection.js";

if (typeof globalThis.DOMRect === "undefined") {
  globalThis.DOMRect = class DOMRect {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      this.top = y;
      this.right = x + width;
      this.bottom = y + height;
      this.left = x;
    }

    toJSON() {
      return { x: this.x, y: this.y, width: this.width, height: this.height };
    }
  } as typeof DOMRect;
}

function makeSession(overrides: Partial<SessionItemType> = {}): SessionItemType {
  return {
    id: "worker-session",
    model: "gpt-5.4-mini",
    cwd: "/repo",
    gitBranch: "jiayi",
    isContainerized: false,
    gitAhead: 0,
    gitBehind: 0,
    linesAdded: 0,
    linesRemoved: 0,
    isConnected: true,
    status: "idle",
    sdkState: "connected",
    createdAt: Date.now(),
    archived: false,
    backendType: "codex",
    repoRoot: "/repo",
    permCount: 0,
    sessionNum: 566,
    ...overrides,
  };
}

describe("SessionHoverCard with the real store", () => {
  afterEach(() => {
    useStore.setState({
      sdkSessions: [],
      sessionBoards: new Map(),
      quests: [],
      zoomLevel: 1,
    });
    vi.restoreAllMocks();
    window.location.hash = "";
  });

  it("mounts non-leader hovers without update-depth loops", () => {
    // Regression coverage for worker/reviewer hovers: the store selector used
    // for leader board rows must return a stable snapshot for non-leaders.
    const now = Date.now();
    const sdkSessions: SdkSessionInfo[] = [
      {
        sessionId: "leader-session",
        sessionNum: 565,
        state: "running",
        cwd: "/repo",
        createdAt: now - 120_000,
        backendType: "codex",
        model: "gpt-5.4",
        cliConnected: true,
        isOrchestrator: true,
      },
      {
        sessionId: "worker-session",
        sessionNum: 566,
        state: "running",
        cwd: "/repo",
        createdAt: now - 60_000,
        backendType: "codex",
        model: "gpt-5.4-mini",
        cliConnected: true,
        herdedBy: "leader-session",
        claimedQuestId: "q-501",
        claimedQuestTitle: "Worker active quest still renders",
        claimedQuestStatus: "in_progress",
        name: "Worker Hover Demo",
      },
    ];
    const quests: QuestmasterTask[] = [
      {
        id: "q-501-v1",
        questId: "q-501",
        version: 1,
        title: "Worker active quest still renders",
        status: "in_progress",
        description: "",
        createdAt: now - 90_000,
        updatedAt: now - 30_000,
        sessionId: "worker-session",
        claimedAt: now - 80_000,
      },
    ];
    const taskHistory: SessionTaskEntry[] = [
      {
        title: "Worker task history still renders",
        action: "name",
        timestamp: now - 10_000,
        triggerMessageId: "worker-task-message",
      },
    ];
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    useStore.setState({
      sdkSessions,
      sessionBoards: new Map(),
      quests,
      zoomLevel: 1,
    });

    expect(() =>
      render(
        <StrictMode>
          <SessionHoverCard
            session={makeSession({ herdedBy: "leader-session" })}
            sessionName="Worker Hover Demo"
            sessionPreview="Worker is implementing the active quest hover fixture"
            taskHistory={taskHistory}
            cliSessionId="cli-worker-hover"
            anchorRect={new DOMRect(120, 80, 200, 40)}
            onMouseEnter={() => {}}
            onMouseLeave={() => {}}
          />
        </StrictMode>,
      ),
    ).not.toThrow();

    expect(screen.getByText("Herded by")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#565" })).toBeInTheDocument();
    expect(screen.getByText("Active quest")).toBeInTheDocument();
    expect(screen.getByText("Worker active quest still renders")).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("Worker task history still renders")).toBeInTheDocument();
    expect(screen.queryByTestId("session-hover-active-quests")).toBeNull();

    const reactErrors = consoleError.mock.calls.flat().join("\n");
    expect(reactErrors).not.toContain("Maximum update depth");
    expect(reactErrors).not.toContain("getSnapshot");
  });

  it("renders leader active quest rows after session-list hydration", () => {
    // Regression coverage for q-1455: sidebar snapshots can show leader phase
    // counts before a leader chat is opened, and the hover must still have the
    // exact board rows/titles needed for the active quest section.
    const now = Date.now();
    hydrateSessionList([
      {
        sessionId: "leader-session",
        sessionNum: 565,
        state: "connected",
        cwd: "/repo",
        createdAt: now - 120_000,
        backendType: "codex",
        model: "gpt-5.5",
        cliConnected: true,
        isOrchestrator: true,
        name: "Leader Hover Demo",
        leaderActivePhaseSummary: [{ label: "Implement", count: 1, tone: "phase", color: "#4ade80" }],
        leaderActiveBoardRows: [
          {
            questId: "q-1455",
            title: "Restore active quest rows in leader session hover",
            status: "IMPLEMENTING",
            createdAt: now - 90_000,
            updatedAt: now - 30_000,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "implement", "code-review"],
              currentPhaseId: "implement",
            },
          },
        ],
      },
    ]);

    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "leader-session",
        value: createLeaderThreadTabsProjectionValue({
          tabState: {
            version: 1,
            orderedOpenThreadKeys: ["q-1455"],
            closedThreadTombstones: [],
            updatedAt: now,
          },
          tabs: [
            {
              ...createLeaderThreadTabsProjectionValue().tabs[0]!,
              threadKey: "q-1455",
              questId: "q-1455",
              title: "Restore active quest rows in leader session hover",
              boardStatus: "IMPLEMENTING",
              journey: {
                mode: "active",
                phaseIds: ["alignment", "implement", "code-review"],
                currentPhaseId: "implement",
                activePhaseIndex: 1,
                phaseCount: 3,
                durationSummary: null,
              },
              active: true,
              completed: false,
            },
          ],
          activePhaseSummary: [{ label: "Implement", count: 1, tone: "phase", color: "#4ade80" }],
        }),
      }),
    );

    render(
      <StrictMode>
        <SessionHoverCard
          session={makeSession({
            id: "leader-session",
            isOrchestrator: true,
            sessionNum: 565,
            model: "gpt-5.5",
            backendType: "codex",
          })}
          sessionName="Leader Session"
          sessionPreview="Latest leader coordination update"
          taskHistory={[
            {
              title: "Legacy leader task that should not render",
              action: "name",
              timestamp: now - 20_000,
              triggerMessageId: "leader-task",
            },
          ]}
          cliSessionId="cli-leader"
          anchorRect={new DOMRect(120, 80, 200, 40)}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
        />
      </StrictMode>,
    );

    const section = screen.getByTestId("session-hover-active-quests");
    expect(within(section).getByText("Active quests")).toBeInTheDocument();
    const row = within(section).getByTestId("session-hover-active-quest-row");
    expect(row).toHaveAttribute("data-quest-id", "q-1455");
    expect(row).toHaveAttribute("data-title-color", "normal");
    expect(within(row).getByTestId("session-hover-active-quest-phase")).toHaveTextContent("Implement");
    expect(within(row).getByTestId("session-hover-active-quest-title")).toHaveTextContent(
      "Restore active quest rows in leader session hover",
    );
    expect(screen.queryByText("Herding")).toBeNull();
    expect(screen.queryByText("Tasks")).toBeNull();
    expect(screen.getByText("Last message")).toBeInTheDocument();
    expect(screen.getByText("Latest leader coordination update")).toBeInTheDocument();
  });

  it("opens a leader's active quest thread from its row and closes the card", () => {
    // The Active quests rows are another way into the leader's quest threads, like the Working on
    // list: a click routes to that quest's thread in the hovered leader (by its session number) and
    // dismisses the card, even when another session is on screen.
    const now = Date.now();
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "clickable-leader",
          sessionNum: 565,
          state: "connected",
          cwd: "/repo",
          createdAt: now - 120_000,
          backendType: "codex",
          isOrchestrator: true,
        },
      ],
    });
    useStore.getState().applySyncedProjectionSnapshot(
      createLeaderThreadTabsProjectionEnvelope({
        key: "clickable-leader",
        value: createLeaderThreadTabsProjectionValue({
          tabs: [
            {
              ...createLeaderThreadTabsProjectionValue().tabs[0]!,
              threadKey: "q-77",
              questId: "q-77",
              title: "Clickable active quest",
              boardStatus: "WORKING",
              active: true,
              completed: false,
            },
          ],
        }),
      }),
    );
    window.location.hash = "#/session/9";
    const onMouseLeave = vi.fn();

    render(
      <SessionHoverCard
        session={makeSession({
          id: "clickable-leader",
          isOrchestrator: true,
          sessionNum: 565,
        })}
        sessionName="Leader Session"
        sessionPreview={undefined}
        taskHistory={undefined}
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={onMouseLeave}
      />,
    );

    fireEvent.click(screen.getByTestId("session-hover-active-quest-row"));

    expect(window.location.hash).toContain("#/session/565");
    expect(isSessionThreadRoute(window.location.hash, "clickable-leader", "q-77")).toBe(true);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
  });

  it("opens a worker's active quest in its leader's thread, or its details without a leader", () => {
    // A worker's quest thread lives in the leader herding it, so the worker card's Active quest goes
    // there; a session no leader herds has no quest thread, so its quest opens in Questmaster.
    const now = Date.now();
    const quest: QuestmasterTask = {
      id: "q-88-v1",
      questId: "q-88",
      version: 1,
      title: "Worker quest",
      status: "in_progress",
      description: "",
      createdAt: now - 90_000,
      updatedAt: now - 30_000,
      sessionId: "worker-session",
      claimedAt: now - 80_000,
    };
    const worker = {
      sessionId: "worker-session",
      sessionNum: 566,
      state: "running" as const,
      cwd: "/repo",
      createdAt: now - 60_000,
      backendType: "codex" as const,
      claimedQuestId: "q-88",
      claimedQuestTitle: "Worker quest",
      claimedQuestStatus: "in_progress",
    };
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "leader-session",
          sessionNum: 565,
          state: "connected",
          cwd: "/repo",
          createdAt: now,
          isOrchestrator: true,
        },
        { ...worker, herdedBy: "leader-session" },
      ],
      quests: [quest],
    });
    window.location.hash = "#/session/566";
    const onMouseLeave = vi.fn();
    const card = render(
      <SessionHoverCard
        session={makeSession({ herdedBy: "leader-session" })}
        sessionName="Worker"
        sessionPreview={undefined}
        taskHistory={undefined}
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={onMouseLeave}
      />,
    );

    fireEvent.click(screen.getByTestId("session-hover-active-quest-open"));
    expect(isSessionThreadRoute(window.location.hash, "leader-session", "q-88")).toBe(true);
    expect(onMouseLeave).toHaveBeenCalledTimes(1);
    card.unmount();

    useStore.setState({ sdkSessions: [worker], questOverlayId: null });
    window.location.hash = "#/session/566";
    render(
      <SessionHoverCard
        session={makeSession()}
        sessionName="Worker"
        sessionPreview={undefined}
        taskHistory={undefined}
        anchorRect={new DOMRect(120, 80, 200, 40)}
        onMouseEnter={() => {}}
        onMouseLeave={onMouseLeave}
      />,
    );

    fireEvent.click(screen.getByTestId("session-hover-active-quest-open"));
    expect(useStore.getState().questOverlayId).toBe("q-88");
    expect(window.location.hash).toBe("#/session/566");
    expect(onMouseLeave).toHaveBeenCalledTimes(2);
  });
});
