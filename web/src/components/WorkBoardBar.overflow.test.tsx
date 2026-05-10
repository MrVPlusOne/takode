// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardRowData } from "./BoardTable.js";
import type { QuestmasterTask, SessionAttentionRecord, SessionState } from "../types.js";
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
  quests: QuestmasterTask[];
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

function reviewAttentionRecord(threadKey: string): SessionAttentionRecord {
  return {
    id: `review:${threadKey}`,
    leaderSessionId: "s1",
    type: "review_ready",
    source: { kind: "notification", id: `n-${threadKey}`, questId: threadKey },
    questId: threadKey,
    threadKey,
    title: `${threadKey} ready for review`,
    summary: `Review ${threadKey}`,
    actionLabel: "Review",
    priority: "review",
    state: "unresolved",
    createdAt: 100,
    updatedAt: 100,
    route: { threadKey, questId: threadKey },
    chipEligible: true,
    ledgerEligible: true,
    dedupeKey: `review:${threadKey}`,
  };
}

function expectNoNotificationSurfaceTone(element: HTMLElement) {
  expect(element.className).not.toContain("border-amber-400/35");
  expect(element.className).not.toContain("bg-amber-400/10");
  expect(element.className).not.toContain("text-amber-100");
  expect(element.className).not.toContain("border-blue-400/35");
  expect(element.className).not.toContain("bg-blue-400/10");
  expect(element.className).not.toContain("text-blue-100");
}

function setMeasuredRailWidth(width: number, threadTabWidth = width) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const measuredWidth =
      this.getAttribute("data-testid") === "thread-tab-strip" ||
      this.getAttribute("data-testid") === "thread-tabs-more-button"
        ? width
        : this.getAttribute("data-thread-tab-width-source") === "true"
          ? threadTabWidth
          : width;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: measuredWidth,
      bottom: 24,
      width: measuredWidth,
      height: 24,
      toJSON: () => ({}),
    } as DOMRect;
  });
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

  it("freezes visible tab widths while the mouse remains over the tab strip after a close", () => {
    setMeasuredRailWidth(960, 180);

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1", "q-2", "q-3"]}
        threadRows={THREAD_ROWS.slice(0, 3)}
      />,
    );

    const strip = view.getByTestId("thread-tab-strip");
    fireEvent.pointerEnter(strip, { pointerType: "mouse" });

    expect(strip).toHaveAttribute("data-close-target-width-frozen", "true");
    expect(strip).toHaveAttribute("data-frozen-thread-tab-width", "180");
    expect(strip.getAttribute("style") ?? "").toContain("--thread-tab-frozen-width: 180px");
    for (const tab of view.getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("w-[var(--thread-tab-frozen-width)]", "flex-none");
    }

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-2"
        openThreadKeys={["q-2", "q-3"]}
        threadRows={THREAD_ROWS.slice(0, 3)}
      />,
    );

    const frozenStrip = view.getByTestId("thread-tab-strip");
    expect(frozenStrip).toHaveAttribute("data-close-target-width-frozen", "true");
    expect(view.getAllByTestId("thread-tab").map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-2", "q-3"]);
    for (const tab of view.getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("w-[var(--thread-tab-frozen-width)]", "flex-none");
    }

    fireEvent.pointerLeave(frozenStrip, { pointerType: "mouse" });

    expect(view.getByTestId("thread-tab-strip")).toHaveAttribute("data-close-target-width-frozen", "false");
    for (const tab of view.getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("min-w-[var(--thread-tab-width)]", "flex-[1_1_var(--thread-tab-width)]");
      expect(tab).not.toHaveClass("flex-none");
    }
  });

  it("does not freeze tab widths for touch entry", () => {
    setMeasuredRailWidth(960, 180);

    const { getByTestId, getAllByTestId } = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1", "q-2"]}
        threadRows={THREAD_ROWS.slice(0, 2)}
      />,
    );

    fireEvent.pointerEnter(getByTestId("thread-tab-strip"), { pointerType: "touch" });

    expect(getByTestId("thread-tab-strip")).toHaveAttribute("data-close-target-width-frozen", "false");
    expect(getByTestId("thread-tab-strip").getAttribute("style") ?? "").not.toContain("--thread-tab-frozen-width");
    for (const tab of getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("min-w-[var(--thread-tab-width)]", "flex-[1_1_var(--thread-tab-width)]");
      expect(tab).not.toHaveClass("flex-none");
    }
  });

  it("releases frozen tab widths when the More menu is dismissed or closed from a hidden row", async () => {
    setMeasuredRailWidth(392, 76);
    const onCloseThreadTab = vi.fn();

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        onCloseThreadTab={onCloseThreadTab}
        threadRows={THREAD_ROWS}
      />,
    );

    const strip = screen.getByTestId("thread-tab-strip");
    fireEvent.pointerEnter(strip, { pointerType: "mouse" });
    expect(strip).toHaveAttribute("data-close-target-width-frozen", "true");
    expect(strip.getAttribute("style") ?? "").toContain("--thread-tab-frozen-width: 76px");

    fireEvent.click(await screen.findByTestId("thread-tabs-more-button"));
    expect(screen.getByTestId("thread-tabs-more-list")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
    expect(strip).toHaveAttribute("data-close-target-width-frozen", "false");
    expect(strip.getAttribute("style") ?? "").not.toContain("--thread-tab-frozen-width");

    fireEvent.pointerEnter(strip, { pointerType: "mouse" });
    fireEvent.click(screen.getByTestId("thread-tabs-more-button"));
    const q4Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;

    fireEvent.click(within(q4Row).getByLabelText("Close q-4"));

    expect(onCloseThreadTab).toHaveBeenCalledWith("q-4", "q-5");
    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
    expect(strip).toHaveAttribute("data-close-target-width-frozen", "false");
    expect(strip.getAttribute("style") ?? "").not.toContain("--thread-tab-frozen-width");
  });

  it("keeps frozen tab widths when the last hidden tab leaves More during a visible close", () => {
    // At 472px, five tabs need a More menu with one hidden tab, while four tabs fit without More.
    // Closing a visible tab should promote the final hidden tab without releasing the mouse close-target freeze.
    setMeasuredRailWidth(472, 76);

    const view = render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        threadRows={THREAD_ROWS}
      />,
    );

    expect(view.getByTestId("thread-tabs-more-button")).toHaveAttribute("data-hidden-count", "1");
    expect(view.getAllByTestId("thread-tab").map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-1",
      "q-2",
      "q-3",
      "q-5",
    ]);

    const strip = view.getByTestId("thread-tab-strip");
    fireEvent.pointerEnter(strip, { pointerType: "mouse" });

    expect(strip).toHaveAttribute("data-close-target-width-frozen", "true");
    expect(strip.getAttribute("style") ?? "").toContain("--thread-tab-frozen-width: 76px");

    view.rerender(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-4", "q-5"]}
        threadRows={THREAD_ROWS}
      />,
    );

    const promotedStrip = view.getByTestId("thread-tab-strip");
    expect(view.queryByTestId("thread-tabs-more-button")).not.toBeInTheDocument();
    expect(view.getAllByTestId("thread-tab").map((tab) => tab.getAttribute("data-thread-key"))).toEqual([
      "q-1",
      "q-2",
      "q-4",
      "q-5",
    ]);
    expect(promotedStrip).toHaveAttribute("data-close-target-width-frozen", "true");
    expect(promotedStrip.getAttribute("style") ?? "").toContain("--thread-tab-frozen-width: 76px");
    for (const tab of view.getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("w-[var(--thread-tab-frozen-width)]", "flex-none");
      expect(tab).not.toHaveClass("flex-[1_1_var(--thread-tab-width)]");
    }

    fireEvent.pointerLeave(promotedStrip, { pointerType: "mouse" });

    expect(view.getByTestId("thread-tab-strip")).toHaveAttribute("data-close-target-width-frozen", "false");
    expect(view.getByTestId("thread-tab-strip").getAttribute("style") ?? "").not.toContain("--thread-tab-frozen-width");
    for (const tab of view.getAllByTestId("thread-tab")) {
      expect(tab).toHaveClass("min-w-[var(--thread-tab-width)]", "flex-[1_1_var(--thread-tab-width)]");
      expect(tab).not.toHaveClass("flex-none");
    }
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
    const onReorderThreadTabs = vi.fn();
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
        onReorderThreadTabs={onReorderThreadTabs}
        threadRows={THREAD_ROWS}
      />,
    );

    const visibleTabs = await screen.findAllByTestId("thread-tab");
    expect(visibleTabs.map((tab) => tab.getAttribute("data-thread-key"))).toEqual(["q-1", "q-2", "q-5"]);
    expect(visibleTabs.every((tab) => tab.getAttribute("data-reorderable") === "true")).toBe(true);
    expect(
      visibleTabs.every(
        (tab) => within(tab).getByTestId("thread-tab-select").getAttribute("aria-roledescription") === "sortable",
      ),
    ).toBe(true);
    const moreButton = screen.getByTestId("thread-tabs-more-button");
    expect(screen.getByTestId("thread-tab-rail")).toHaveAttribute("data-overflow", "more-tabs-list");
    expect(moreButton).toHaveAttribute("data-hidden-count", "2");
    expect(moreButton).toHaveAttribute("data-has-active-output", "true");
    expect(moreButton).toHaveAttribute("data-has-needs-input", "true");
    expect(visibleTabs.every((tab) => tab.getAttribute("data-reorderable") === "true")).toBe(true);
    expect(screen.getByTestId("thread-main-tab")).not.toHaveAttribute("data-reorderable", "true");
    expect(moreButton).not.toHaveAttribute("aria-roledescription", "sortable");

    fireEvent.click(moreButton);
    const rows = screen.getAllByTestId("thread-tabs-more-row");
    expect(rows.map((row) => row.getAttribute("data-thread-key"))).toEqual(["q-3", "q-4"]);
    expect(rows.every((row) => row.getAttribute("data-hidden") === "true")).toBe(true);
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

  it("aggregates hidden blue notification nudges without treating More itself as viewing the notification", async () => {
    const onSelectThread = vi.fn();

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        onSelectThread={onSelectThread}
        threadRows={THREAD_ROWS}
        attentionRecords={[reviewAttentionRecord("q-4")]}
      />,
    );

    const moreButton = await screen.findByTestId("thread-tabs-more-button");
    expect(moreButton).toHaveAttribute("data-has-blue-notification", "true");
    expectNoNotificationSurfaceTone(moreButton);
    expect(within(moreButton).getByTestId("thread-tab-blue-notification-bell")).toHaveClass("text-blue-400");

    fireEvent.click(moreButton);
    expect(onSelectThread).not.toHaveBeenCalled();

    const q4Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;
    expect(q4Row).toHaveAttribute("data-hidden", "true");
    expect(q4Row).toHaveAttribute("data-blue-notification", "true");
    expect(within(q4Row).getByTestId("thread-tab-blue-notification-bell")).toBeInTheDocument();

    fireEvent.click(within(q4Row).getByTestId("thread-tabs-more-row-select"));
    expect(onSelectThread).toHaveBeenCalledWith("q-4");
  });

  it("aggregates hidden amber needs-input nudges without tinting the More button surface", async () => {
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-4", title: "Quest 4 thread", status: "WAITING", updatedAt: 4, waitForInput: ["user"] }]],
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

    const moreButton = await screen.findByTestId("thread-tabs-more-button");
    expect(moreButton).toHaveAttribute("data-has-needs-input", "true");
    expectNoNotificationSurfaceTone(moreButton);
    expect(within(moreButton).getByTestId("thread-tab-needs-input-bell")).toHaveClass("text-amber-400");
  });

  it("prioritizes hidden amber over blue on More and hidden rows", async () => {
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-4", title: "Quest 4 thread", status: "WAITING", updatedAt: 4, waitForInput: ["user"] }]],
      ]),
    });

    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-5"
        openThreadKeys={["q-1", "q-2", "q-3", "q-4", "q-5"]}
        threadRows={THREAD_ROWS}
        attentionRecords={[reviewAttentionRecord("q-4")]}
      />,
    );

    const moreButton = await screen.findByTestId("thread-tabs-more-button");
    expect(moreButton).toHaveAttribute("data-has-needs-input", "true");
    expect(moreButton).toHaveAttribute("data-has-blue-notification", "true");
    expectNoNotificationSurfaceTone(moreButton);
    expect(within(moreButton).getByTestId("thread-tab-needs-input-bell")).toHaveClass("text-amber-400");
    expect(within(moreButton).queryByTestId("thread-tab-blue-notification-bell")).not.toBeInTheDocument();

    fireEvent.click(moreButton);
    const q4Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;
    expect(q4Row).toHaveAttribute("data-hidden", "true");
    expect(q4Row).toHaveAttribute("data-needs-input", "true");
    expect(q4Row).toHaveAttribute("data-blue-notification", "true");
    expect(within(q4Row).getByTestId("thread-tab-needs-input-bell")).toHaveClass("text-amber-400");
    expect(within(q4Row).queryByTestId("thread-tab-blue-notification-bell")).not.toBeInTheDocument();
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

  it("keeps unfinished off-board quest tab titles unmuted and closable", async () => {
    render(
      <WorkBoardBar
        sessionId="s1"
        currentThreadKey="q-1"
        openThreadKeys={["q-1"]}
        onCloseThreadTab={vi.fn()}
        threadRows={[
          {
            threadKey: "q-1",
            questId: "q-1",
            title: "Unfinished off-board thread",
            status: "in_progress",
            messageCount: 2,
            section: "done",
          },
        ]}
      />,
    );

    const tab = await screen.findByTestId("thread-tab");
    expect(tab).toHaveAttribute("data-closable", "true");
    expect(within(tab).getByTestId("thread-tab-title")).toHaveAttribute("data-title-color", "");
  });

  it("lets completed quest status override stale active board phase color on selected open tabs", async () => {
    resetStore({
      sessionBoards: new Map([
        ["s1", [{ questId: "q-1259", title: "Completed but stale active row", status: "PORTING", updatedAt: 10 }]],
      ]),
      quests: [
        {
          id: "q-1259",
          questId: "q-1259",
          version: 1,
          title: "Completed but stale active row",
          description: "",
          status: "done",
          tags: [],
          createdAt: 1,
          updatedAt: 10,
          statusChangedAt: 10,
          completedAt: 10,
          verificationItems: [],
        },
      ],
    });

    render(<WorkBoardBar sessionId="s1" currentThreadKey="q-1259" openThreadKeys={["q-1259"]} threadRows={[]} />);

    const tab = await screen.findByTestId("thread-tab");
    const title = within(tab).getByTestId("thread-tab-title");
    expect(within(tab).getByTestId("thread-tab-select")).toHaveAttribute("aria-pressed", "true");
    expect(title).toHaveAttribute("data-title-color", "var(--color-cc-muted)");
    expect(title).not.toHaveStyle({
      color: getQuestJourneyPhaseForState("PORTING")?.color.accent,
    });
    expectNoNotificationSurfaceTone(tab);
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

    const q4Row = screen
      .getAllByTestId("thread-tabs-more-row")
      .find((row) => row.getAttribute("data-thread-key") === "q-4")!;
    expect(q4Row).toHaveAttribute("data-reorderable", "true");
    fireEvent.click(within(q4Row).getByTestId("thread-tabs-more-row-select"));
    expect(onSelectThread).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Move q-4 up"));
    fireEvent.click(screen.getByText("Done"));

    expect(onReorderThreadTabs).toHaveBeenCalledWith(["q-1", "q-2", "q-4", "q-3", "q-5"]);
    expect(screen.queryByTestId("thread-tabs-more-list")).not.toBeInTheDocument();
  });
});
