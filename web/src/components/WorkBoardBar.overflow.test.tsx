// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRowData } from "./BoardTable.js";
import type { SessionState } from "../types.js";
import { getQuestJourneyPhaseForState } from "../../shared/quest-journey.js";

interface MockStoreState {
  sessionBoards: Map<string, BoardRowData[]>;
  sessionBoardRowStatuses: Map<string, Record<string, import("../types.js").BoardRowSessionStatus>>;
  sessionCompletedBoards: Map<string, BoardRowData[]>;
  sdkSessions: Array<{ sessionId: string; isOrchestrator?: boolean }>;
  sessions: Map<string, SessionState>;
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  sessionTaskHistory: Map<string, unknown[]>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  cliConnected: Map<string, boolean>;
  askPermission: Map<string, boolean>;
  cliDisconnectReason: Map<string, "idle_limit" | "broken" | null>;
  quests: [];
  sessionStatus: Map<string, "idle" | "running" | "compacting" | "reverting" | null>;
  activeTurnRoutes: Map<string, import("../types.js").ActiveTurnRoute | null>;
}

let mockState: MockStoreState;

function resetStore(overrides: Partial<MockStoreState> = {}) {
  mockState = {
    sessionBoards: new Map(),
    sessionBoardRowStatuses: new Map(),
    sessionCompletedBoards: new Map(),
    sdkSessions: [{ sessionId: "s1", isOrchestrator: true }],
    sessions: new Map(),
    sessionNames: new Map(),
    sessionPreviews: new Map(),
    sessionTaskHistory: new Map(),
    pendingPermissions: new Map(),
    cliConnected: new Map(),
    askPermission: new Map(),
    cliDisconnectReason: new Map(),
    quests: [],
    sessionStatus: new Map(),
    activeTurnRoutes: new Map(),
    ...overrides,
  };
}

vi.mock("../store.js", () => ({
  useStore: Object.assign((selector: (s: MockStoreState) => unknown) => selector(mockState), {
    getState: () => ({
      requestScrollToMessage: vi.fn(),
      setExpandAllInTurn: vi.fn(),
    }),
  }),
}));

vi.mock("./BoardTable.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./BoardTable.js")>();
  return {
    ...actual,
    BoardTable: () => <div data-testid="board-table" />,
  };
});

const { WorkBoardBar, buildCompactThreadTabPartition } = await import("./WorkBoardBar.js");

function setMeasuredRailWidth(width: number) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: width,
        bottom: 24,
        width,
        height: 24,
        toJSON: () => ({}),
      }) as DOMRect,
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width } } as ResizeObserverEntry], this);
      }
      disconnect() {}
      unobserve() {}
    },
  );
}

const THREAD_ROWS = Array.from({ length: 5 }, (_, index) => {
  const questNumber = index + 1;
  return {
    threadKey: `q-${questNumber}`,
    questId: `q-${questNumber}`,
    title: `Quest ${questNumber} thread`,
    messageCount: questNumber,
  };
});

describe("WorkBoardBar overflow tabs", () => {
  beforeEach(() => {
    resetStore();
    setMeasuredRailWidth(392);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("pins the selected tab into the compact strip without mutating source order", () => {
    const sourceTabs = THREAD_ROWS.map((row) => ({ threadKey: row.threadKey }));
    // The selected tab is visually pinned into the compact strip, but the source order must stay server-owned.
    const partition = buildCompactThreadTabPartition({
      tabs: sourceTabs,
      currentThreadKey: "q-5",
      railWidth: 392,
    });

    expect(partition.visibleThreadKeys).toEqual(["q-1", "q-2", "q-5"]);
    expect(partition.hiddenThreadKeys).toEqual(["q-3", "q-4"]);
    expect(sourceTabs.map((tab) => tab.threadKey)).toEqual(["q-1", "q-2", "q-3", "q-4", "q-5"]);
  });

  it("uses wider desktop tab packing so readable labels overflow into More earlier", () => {
    const sourceTabs = Array.from({ length: 12 }, (_, index) => ({ threadKey: `q-${index + 1}` }));
    // The approved desktop case has enough physical room for many 68px tabs, but those labels are not useful.
    const partition = buildCompactThreadTabPartition({
      tabs: sourceTabs,
      currentThreadKey: "q-12",
      railWidth: 1880,
    });

    expect(partition.visibleThreadKeys).toEqual([
      "q-1",
      "q-2",
      "q-3",
      "q-4",
      "q-5",
      "q-6",
      "q-7",
      "q-8",
      "q-9",
      "q-12",
    ]);
    expect(partition.hiddenThreadKeys).toEqual(["q-10", "q-11"]);
    expect(sourceTabs.map((tab) => tab.threadKey)).toEqual([
      "q-1",
      "q-2",
      "q-3",
      "q-4",
      "q-5",
      "q-6",
      "q-7",
      "q-8",
      "q-9",
      "q-10",
      "q-11",
      "q-12",
    ]);
  });

  it("shows More tabs with hidden status aggregation and selects hidden rows from the list", async () => {
    const onSelectThread = vi.fn();
    // Hidden q-3 owns needs-input state and hidden q-4 owns active output, so the More button must aggregate both.
    resetStore({
      sessionStatus: new Map([["s1", "running"]]),
      activeTurnRoutes: new Map([["s1", { threadKey: "q-4", questId: "q-4" }]]),
      sessionBoards: new Map([
        ["s1", [{ questId: "q-3", title: "Quest 3 thread", status: "WAITING", updatedAt: 3, waitForInput: ["user"] }]],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        onSelectThread={onSelectThread}
        threadRows={THREAD_ROWS}
      />,
    );

    const visibleTabs = await screen.findAllByTestId("thread-tab");
    expect(visibleTabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2", "q-5"]);
    const moreButton = screen.getByTestId("thread-tabs-more-button");
    expect(screen.getByTestId("thread-tab-rail")).toHaveAttribute("data-overflow", "more-tabs-list");
    expect(moreButton).toHaveAttribute("data-hidden-count", "2");
    expect(moreButton).toHaveAttribute("data-has-active-output", "true");
    expect(moreButton).toHaveAttribute("data-has-needs-input", "true");
    expect(visibleTabs.every((tab) => tab.getAttribute("data-reorderable") === "false")).toBe(true);

    fireEvent.click(moreButton);
    const rows = screen.getAllByTestId("thread-tabs-more-row");
    expect(rows.map((row) => row.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2", "q-3", "q-4", "q-5"]);
    expect(rows.find((row) => row.getAttribute("data-thread-key") === "q-3")).toHaveAttribute("data-hidden", "true");
    expect(rows.find((row) => row.getAttribute("data-thread-key") === "q-4")).toHaveAttribute(
      "data-active-output",
      "true",
    );

    fireEvent.click(
      within(rows.find((row) => row.getAttribute("data-thread-key") === "q-4")!).getByTestId(
        "thread-tabs-more-row-select",
      ),
    );
    expect(onSelectThread).toHaveBeenCalledWith("q-4");
    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
  });

  it("uses muted completed color for completed hidden rows in the More tabs list", async () => {
    resetStore({
      sessionCompletedBoards: new Map([
        [
          "s1",
          [
            {
              questId: "q-4",
              title: "Finished hidden thread",
              status: "PORTING",
              updatedAt: 4,
              completedAt: 4,
              journey: {
                presetId: "full-code",
                phaseIds: ["alignment", "implement", "code-review", "port"],
                currentPhaseId: "port",
              },
            },
          ],
        ],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        threadRows={THREAD_ROWS}
      />,
    );

    fireEvent.click(await screen.findByTestId("thread-tabs-more-button"));
    const completedRow = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;
    const completedTitle = within(completedRow).getByTestId("thread-tabs-more-row-title");
    expect(completedTitle).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(completedTitle).not.toHaveStyle({
      color: getQuestJourneyPhaseForState("PORTING")?.color.accent,
    });
  });

  it("keeps hidden tab close affordances in the More tabs list", async () => {
    const onCloseThreadTab = vi.fn();
    // Close fallback should still use the full ordered tab list, even when the closed tab is hidden in More.
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={THREAD_ROWS}
      />,
    );

    fireEvent.click(await screen.findByTestId("thread-tabs-more-button"));
    const q4Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;
    fireEvent.click(within(q4Row).getByLabelText("Close q-4"));

    expect(onCloseThreadTab).toHaveBeenCalledWith("q-4", "q-5");
    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
  });

  it("persists overflow reorder only through the explicit More tabs reorder mode", async () => {
    const onSelectThread = vi.fn();
    const onReorderThreadTabs = vi.fn();

    // Reorder mode disables row selection and persists through the same server-owned order callback as rail drag.
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        onSelectThread={onSelectThread}
        onReorderThreadTabs={onReorderThreadTabs}
        threadRows={THREAD_ROWS}
      />,
    );

    fireEvent.click(await screen.findByTestId("thread-tabs-more-button"));
    fireEvent.click(screen.getByTestId("thread-tabs-more-reorder-toggle"));

    const q5Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-5")!;
    expect(q5Row).toHaveAttribute("data-reorderable", "true");
    fireEvent.click(within(q5Row).getByTestId("thread-tabs-more-row-select"));
    expect(onSelectThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Move q-5 up"));
    fireEvent.click(screen.getByText("Done"));

    expect(onReorderThreadTabs).toHaveBeenCalledWith(["q-1", "q-2", "q-3", "q-5", "q-4"]);
    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
  });
});
