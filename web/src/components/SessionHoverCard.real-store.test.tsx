// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StrictMode } from "react";
import type { SessionTaskEntry } from "../../server/session-types.js";
import type { QuestmasterTask, SdkSessionInfo } from "../types.js";
import { useStore } from "../store.js";
import { hydrateSessionList } from "../session-list-hydration.js";
import type { SidebarSessionItem as SessionItemType } from "../utils/sidebar-session-item.js";
import { SessionHoverCard } from "./SessionHoverCard.js";

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
      sessionNames: new Map(),
      sessionBoards: new Map(),
      quests: [],
      zoomLevel: 1,
    });
    vi.restoreAllMocks();
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
      sessionNames: new Map([
        ["leader-session", "Leader Hover Demo"],
        ["worker-session", "Worker Hover Demo"],
      ]),
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
            sessionState={undefined}
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

    expect(useStore.getState().sdkSessions[0]?.leaderActivePhaseSummary).toEqual([
      { label: "Implement", count: 1, tone: "phase", color: "#4ade80" },
    ]);

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
          sessionState={undefined}
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
});
