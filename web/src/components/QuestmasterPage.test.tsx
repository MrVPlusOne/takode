// @vitest-environment jsdom
import { act, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestmasterTask } from "../types.js";
import {
  buildVerificationQuest,
  installQuestmasterPageTestHooks,
  mockClipboardWriteText,
  mockGetSettings,
  mockListQuestPage,
  mockState,
  resetState,
  sessionRow,
  settleLatestQuestPageRequest,
} from "./QuestmasterPage.test-harness.js";

vi.mock("../api.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockApiModule());
vi.mock("../utils/questmaster-view-state.js", async () =>
  (await import("./QuestmasterPage.test-harness.js")).mockViewStateModule(),
);
vi.mock("../utils/highlight.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockHighlightModule());
vi.mock("../store.js", async () => (await import("./QuestmasterPage.test-harness.js")).mockStoreModule());

import { QuestmasterPage } from "./QuestmasterPage.js";

installQuestmasterPageTestHooks();

function renderQuestmaster(props: { isActive?: boolean } = {}) {
  return render(<QuestmasterPage isActive={false} {...props} />);
}

describe("QuestmasterPage status display", () => {
  it("renders verification quests under Completed without Review Inbox grouping", () => {
    // q-1034: verification remains visible, but inbox state is no longer a Questmaster grouping.
    renderQuestmaster({ isActive: true });

    expect(screen.queryByText("Review Inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("Under Review")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Completed2$/ })).toBeInTheDocument();
    expect(screen.getByText("Fresh verification quest")).toBeInTheDocument();
    expect(screen.getByText("Regular verification quest")).toBeInTheDocument();
  });

  it("renders leader session attribution next to the worker owner", () => {
    const quest = {
      ...buildVerificationQuest({
        id: "q-50-v3",
        questId: "q-50",
        title: "Leader-routed quest",
        verificationInboxUnread: true,
      }),
      leaderSessionId: "leader-1",
    } as QuestmasterTask;
    resetState({
      quests: [quest],
      sdkSessions: [sessionRow("session-1", 10, "Worker"), sessionRow("leader-1", 4, "Leader")],
    });

    renderQuestmaster({ isActive: true });

    expect(screen.getByText("Leader-routed quest")).toBeInTheDocument();
    expect(screen.getByText("Leader")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#10" })).toBeInTheDocument();
    const leaderChip = screen.getByRole("button", { name: "#4" });
    expect(leaderChip).toBeInTheDocument();

    fireEvent.click(leaderChip);

    expect(window.location.hash).toBe("#/session/4?thread=q-50");
  });

  it("filters to one status with the segmented status bar", async () => {
    // One cell selected at a time, All included; choosing All shows every quest again.
    mockState.quests = [
      ...mockState.quests,
      {
        ...buildVerificationQuest({ id: "q-5-v1", questId: "q-5", title: "Idea quest" }),
        status: "idea",
      } as QuestmasterTask,
    ];
    renderQuestmaster({ isActive: true });
    await screen.findByText("Idea quest");

    const bar = screen.getByRole("group", { name: "Filter quests by status" });
    const ideas = within(bar).getByRole("button", { name: /^Ideas\s*1$/ });
    fireEvent.click(ideas);
    await waitFor(() => expect(screen.queryByText("Fresh verification quest")).toBeNull());
    expect(screen.getByText("Idea quest")).toBeInTheDocument();
    expect(ideas).toHaveAttribute("aria-pressed", "true");
    expect(mockListQuestPage.mock.lastCall?.[0]).toMatchObject({ status: "idea" });

    // Choosing the selected cell again keeps it, as in any segmented control.
    fireEvent.click(ideas);
    expect(ideas).toHaveAttribute("aria-pressed", "true");

    const all = within(bar).getByRole("button", { name: /^All\s*3$/ });
    fireEvent.click(all);
    await screen.findByText("Fresh verification quest");
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(mockListQuestPage.mock.lastCall?.[0]?.status).toBeUndefined();
  });

  it("renders one flat list with sortable column headers and no layout toggle", async () => {
    // The layout follows the viewport (desktop here), so the old Cards/Compact toggle is gone.
    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /Fresh verification quest/ });
    expect(screen.queryByRole("button", { name: "Cards" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compact" })).not.toBeInTheDocument();
    expect(screen.queryByText("Review Inbox")).not.toBeInTheDocument();
    for (const column of ["Quest", "Status", "Owner", "Leader", "Updated"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^Sort by ${column} `) })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /Regular verification quest/ })).toBeInTheDocument();
  });

  it("uses the phone layout below the desktop width, with a sort picker instead of column headers", async () => {
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 430 });
    try {
      renderQuestmaster({ isActive: true });

      const row = await screen.findByRole("button", { name: /Fresh verification quest/ });
      expect(screen.queryByRole("button", { name: /^Sort by / })).not.toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: "Sort quests" })).toHaveValue("updated");
      expect(within(row).queryByTestId("quest-row-leader")).not.toBeInTheDocument();
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: originalWidth });
    }
  });

  it("shows Completed status without inbox text or the removed User review checks progress", async () => {
    // Status no longer encodes review inbox state; rows also omit review-check progress.

    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /Fresh verification quest/ });
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("0/1")).not.toBeInTheDocument();
  });

  it("shows the active Journey phase as Status and opens the shared Journey hover card", async () => {
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-88-v1", questId: "q-88", title: "Active Journey quest" }),
        status: "in_progress",
        sessionId: "worker-88",
        leaderSessionId: "leader-88",
      } as QuestmasterTask,
    ];
    mockState.sessionBoards = new Map([
      [
        "leader-88",
        [
          {
            questId: "q-88",
            title: "Active Journey quest",
            worker: "worker-88",
            workerNum: 88,
            status: "IMPLEMENTING",
            updatedAt: 10_000,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "implement", "code-review"],
              currentPhaseId: "implement",
              activePhaseIndex: 1,
            },
          },
        ],
      ],
    ]);

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /Active Journey quest/ });
    const status = within(row).getByText("Implement");
    expect(within(row).queryByText("In Progress")).not.toBeInTheDocument();

    fireEvent.mouseEnter(status);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
    expect(screen.getByTestId("quest-hover-status-row")).toHaveTextContent("Implement");
  });

  it("uses persisted Journey runs for Status and Status hover previews", async () => {
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-89-v1", questId: "q-89", title: "Persisted Journey quest" }),
        status: "in_progress",
        journeyRuns: [
          {
            runId: "run-89",
            source: "board",
            phaseIds: ["alignment", "implement", "code-review"],
            status: "active",
            createdAt: 1,
            updatedAt: 2,
            workerSessionId: "worker-89",
            workerSessionNum: 89,
            phaseOccurrences: [
              {
                occurrenceId: "run-89:p1",
                phaseId: "alignment",
                phaseIndex: 0,
                phasePosition: 1,
                phaseOccurrence: 1,
                status: "completed",
                boardState: "PLANNING",
              },
              {
                occurrenceId: "run-89:p2",
                phaseId: "implement",
                phaseIndex: 1,
                phasePosition: 2,
                phaseOccurrence: 1,
                status: "active",
                boardState: "IMPLEMENTING",
              },
            ],
          },
        ],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /Persisted Journey quest/ });
    const status = within(row).getByText("Implement");
    expect(within(row).queryByText("In Progress")).not.toBeInTheDocument();

    fireEvent.mouseEnter(status);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
  });

  it("keeps done quests Completed in Status despite stale Journey phase context", async () => {
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-93-v1", questId: "q-93", title: "Done quest with stale board row" }),
        status: "done",
        sessionId: "worker-93",
        leaderSessionId: "leader-93",
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-94-v1", questId: "q-94", title: "Done quest with stale run" }),
        status: "done",
        journeyRuns: [
          {
            runId: "run-94",
            source: "board",
            phaseIds: ["alignment", "implement", "code-review", "port"],
            status: "active",
            createdAt: 1,
            updatedAt: 2,
            workerSessionId: "worker-94",
            workerSessionNum: 94,
            phaseOccurrences: [
              {
                occurrenceId: "run-94:p4",
                phaseId: "port",
                phaseIndex: 3,
                phasePosition: 4,
                phaseOccurrence: 1,
                status: "active",
                boardState: "PORTING",
              },
            ],
          },
        ],
      } as QuestmasterTask,
    ];
    mockState.sessionBoards = new Map([
      [
        "leader-93",
        [
          {
            questId: "q-93",
            title: "Done quest with stale board row",
            worker: "worker-93",
            workerNum: 93,
            status: "PORTING",
            updatedAt: 10_000,
            journey: {
              mode: "active",
              phaseIds: ["alignment", "implement", "code-review", "port"],
              currentPhaseId: "port",
              activePhaseIndex: 3,
            },
          },
        ],
      ],
    ]);

    renderQuestmaster({ isActive: true });

    const staleBoardRow = await screen.findByRole("button", { name: /Done quest with stale board row/ });
    const staleBoardStatus = within(staleBoardRow).getByText("Completed");
    expect(staleBoardStatus).toBeInTheDocument();
    expect(within(staleBoardRow).queryByText("Port")).not.toBeInTheDocument();
    expect(within(staleBoardRow).queryByText("0/1")).not.toBeInTheDocument();

    const staleRunRow = screen.getByRole("button", { name: /Done quest with stale run/ });
    expect(within(staleRunRow).getByText("Completed")).toBeInTheDocument();
    expect(within(staleRunRow).queryByText("Port")).not.toBeInTheDocument();
    expect(within(staleRunRow).queryByText("0/1")).not.toBeInTheDocument();

    fireEvent.mouseEnter(staleBoardStatus);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
    expect(screen.getByTestId("quest-hover-status-row")).toHaveTextContent("Done");
    expect(screen.getByTestId("quest-hover-status-row")).not.toHaveTextContent("Port");
    expect(screen.getByTestId("quest-hover-journey")).toHaveTextContent("Completed Journey");
  });

  it("limits rows to the title, quest number and one plain-text TLDR line", async () => {
    // Rows lead with the title; tags, debriefs and phase notes stay out of the list.
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-90-v1", questId: "q-90", title: "Markdown TLDR quest" }),
        tldr: [
          "Use [q-986](quest:q-986) direction for the list.",
          "Keep this second line in the same truncated string instead of a second rendered line.",
        ].join("\n"),
        debriefTldr: "Debrief should not appear in rows.",
        feedback: [
          {
            author: "agent",
            text: "Full phase summary should not appear in rows.",
            tldr: "Phase summary should not appear.",
            ts: Date.now(),
            kind: "phase_summary",
            phaseId: "implement",
          },
        ],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /Markdown TLDR quest/ });
    const tldr = within(row).getByTestId("quest-row-tldr");
    expect(tldr).toHaveTextContent(
      "Use q-986 direction for the list. Keep this second line in the same truncated string instead of a second rendered line.",
    );
    expect(within(tldr).queryByRole("link", { name: "q-986" })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "q-90" })).toBeInTheDocument();
    expect(within(row).queryByText("#ui")).not.toBeInTheDocument();
    expect(within(row).queryByText(/Debrief should not appear/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Phase summary should not appear/)).not.toBeInTheDocument();
  });

  it("shows only open human feedback, not addressed feedback", async () => {
    mockState.quests = [
      // The list endpoint sends feedback as counts (feedbackSummary), not entries.
      {
        ...buildVerificationQuest({ id: "q-95-v1", questId: "q-95", title: "Open feedback quest" }),
        feedbackSummary: { humanTotal: 2, humanUnaddressed: 1, humanAddressed: 1 },
      } as unknown as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-96-v1", questId: "q-96", title: "Addressed feedback quest" }),
        feedbackSummary: { humanTotal: 1, humanUnaddressed: 0, humanAddressed: 1 },
      } as unknown as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const openRow = await screen.findByRole("button", { name: /Open feedback quest/ });
    expect(within(openRow).getByText("1 open")).toBeInTheDocument();
    const addressedRow = screen.getByRole("button", { name: /Addressed feedback quest/ });
    expect(within(addressedRow).queryByText(/open|addressed/)).not.toBeInTheDocument();
  });

  it("shows Owner and Leader in separate columns and leaves out unknown sessions", async () => {
    mockState.sdkSessions = [sessionRow("worker-1347", 1347, "Worker"), sessionRow("leader-1286", 1286, "Leader")];
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-91-v1", questId: "q-91", title: "Split owner leader quest" }),
        sessionId: "worker-1347",
        leaderSessionId: "leader-1286",
      } as QuestmasterTask,
      {
        ...buildVerificationQuest({ id: "q-97-v1", questId: "q-97", title: "Removed owner quest" }),
        sessionId: "removed-session",
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /Split owner leader quest/ });
    expect(within(row).getByTestId("quest-row-owner")).toHaveTextContent("#1347");
    expect(within(row).getByTestId("quest-row-owner")).not.toHaveTextContent("#1286");
    expect(within(row).getByTestId("quest-row-leader")).toHaveTextContent("#1286");
    // A session that is no longer known has nothing to open, so its "#?" placeholder is left out.
    const removedRow = screen.getByRole("button", { name: /Removed owner quest/ });
    expect(within(removedRow).getByTestId("quest-row-owner")).toBeEmptyDOMElement();
  });

  it("keeps keyboard activation on the quest number for copying instead of opening the quest", async () => {
    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /Fresh verification quest/ });
    const questId = within(row).getByRole("button", { name: "q-1" });
    fireEvent.keyDown(questId, { key: "Enter" });
    fireEvent.keyDown(questId, { key: " " });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();

    fireEvent.keyDown(row, { key: "Enter" });
    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1", undefined);
  });

  it("pauses fallback polling while the tab is hidden and resumes on visibility", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "hidden";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });

    try {
      renderQuestmaster({ isActive: true });
      expect(mockListQuestPage).toHaveBeenCalledTimes(1);

      await act(async () => {
        vi.advanceTimersByTime(15_000);
      });
      expect(mockListQuestPage).toHaveBeenCalledTimes(1);

      visibilityState = "visible";
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(mockListQuestPage).toHaveBeenCalledTimes(2);
      await settleLatestQuestPageRequest();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });
      expect(mockListQuestPage).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens quest overlay via store when clicking a row", async () => {
    // Clicking a row should set questOverlayId on the store so
    // QuestDetailPanel renders the detail modal globally.
    renderQuestmaster({ isActive: true });

    fireEvent.click(screen.getByRole("button", { name: /Fresh verification quest/ }));

    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1", undefined);
    expect(mockState.questOverlayId).toBe("q-1");
  });

  it("copies the quest id from a card without opening the overlay", async () => {
    renderQuestmaster({ isActive: true });

    fireEvent.click(screen.getByRole("button", { name: "q-1" }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("q-1");
    });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument());
  });

  it("opens quest overlay via deep-link", () => {
    // Deep-linking should open the targeted quest via the store overlay.
    window.location.hash = "#/questmaster?quest=q-2";
    renderQuestmaster({ isActive: true });

    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-2");
    expect(mockState.questOverlayId).toBe("q-2");
  });

  it("cancels the pending deep-link scroll frame on unmount", () => {
    // The deep-link scroll is asynchronous; cleanup must cancel it so no
    // browser globals are touched after Vitest tears down jsdom.
    window.location.hash = "#/questmaster?quest=q-2";
    const requestFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 123);
    const cancelFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    try {
      const { unmount } = renderQuestmaster();
      unmount();

      expect(requestFrameSpy).toHaveBeenCalled();
      expect(cancelFrameSpy).toHaveBeenCalledWith(123);
    } finally {
      requestFrameSpy.mockRestore();
      cancelFrameSpy.mockRestore();
    }
  });

  it("toggles quest overlay closed when clicking an already-expanded quest card", () => {
    // Clicking the same quest card again should close the overlay.
    mockState.questOverlayId = "q-1";
    renderQuestmaster();

    fireEvent.click(screen.getByText("Fresh verification quest"));

    expect(mockState.closeQuestOverlay).toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();
  });
});
