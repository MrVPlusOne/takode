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
vi.mock("../utils/questmaster-view-state.js", async (importOriginal) =>
  (await import("./QuestmasterPage.test-harness.js")).mockViewStateModule(await importOriginal()),
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

  it("collapses and expands the completed section without an inbox split", () => {
    // Completed remains a normal status group even when quests have verification metadata.
    renderQuestmaster({ isActive: true });

    const completedHeader = screen.getByRole("button", { name: /^Completed2$/ });
    expect(screen.getByText("Fresh verification quest")).toBeInTheDocument();

    fireEvent.click(completedHeader);
    expect(screen.queryByText("Fresh verification quest")).toBeNull();
    expect(screen.queryByText("Regular verification quest")).toBeNull();

    fireEvent.click(completedHeader);
    expect(screen.getByText("Fresh verification quest")).toBeInTheDocument();
    expect(screen.getByText("Regular verification quest")).toBeInTheDocument();
  });

  it("orders quests within a group by recency (updatedAt fallback to createdAt)", () => {
    const olderCreatedButRecentlyUpdated = {
      ...buildVerificationQuest({
        id: "q-10-v3",
        questId: "q-10",
        title: "Older create, newer update",
        verificationInboxUnread: false,
      }),
      createdAt: 1_000,
      updatedAt: 5_000,
      verificationInboxUnread: false,
    } as QuestmasterTask;
    const newerCreatedButNotUpdated = {
      ...buildVerificationQuest({
        id: "q-11-v3",
        questId: "q-11",
        title: "Newer create, older update",
        verificationInboxUnread: false,
      }),
      createdAt: 4_000,
      updatedAt: 4_000,
      verificationInboxUnread: false,
    } as QuestmasterTask;

    mockState.quests = [newerCreatedButNotUpdated, olderCreatedButRecentlyUpdated];
    renderQuestmaster({ isActive: true });

    const order = Array.from(document.querySelectorAll<HTMLElement>("[data-quest-id]")).map((el) => el.dataset.questId);
    expect(order).toEqual(["q-10", "q-11"]);
  });

  it("loads the server-persisted compact view and renders quests as dense rows", async () => {
    // View mode is a server setting: activating Questmaster should hydrate the compact table without localStorage.
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });

    renderQuestmaster({ isActive: true });

    expect(await screen.findAllByRole("columnheader", { name: "Quest" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Owner" })).toHaveLength(1);
    expect(screen.getAllByRole("columnheader", { name: "Leader" })).toHaveLength(1);
    expect(screen.queryByRole("columnheader", { name: "User review checks" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.queryByText("Review Inbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /q-1 Fresh verification quest/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /q-2 Regular verification quest/ })).toBeInTheDocument();
  });

  it("shows Completed status without inbox text or the removed User review checks column", async () => {
    // Status no longer encodes review inbox state; the compact table also omits review-check progress.
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });

    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /q-1 Fresh verification quest/ });
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Inbox")).not.toBeInTheDocument();
    expect(screen.queryByText("0/1")).not.toBeInTheDocument();
  });

  it("shows the active Journey phase as compact Status and opens the shared Journey hover card", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
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

    const row = await screen.findByRole("button", { name: /q-88 Active Journey quest/ });
    const status = within(row).getByText("Implement");
    expect(within(row).queryByText("In Progress")).not.toBeInTheDocument();

    fireEvent.mouseEnter(status);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
    expect(screen.getByTestId("quest-hover-status-row")).toHaveTextContent("Implement");
  });

  it("uses persisted Journey runs for compact Status and Status hover previews", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
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

    const row = await screen.findByRole("button", { name: /q-89 Persisted Journey quest/ });
    const status = within(row).getByText("Implement");
    expect(within(row).queryByText("In Progress")).not.toBeInTheDocument();

    fireEvent.mouseEnter(status);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
  });

  it("keeps done quests Completed in compact Status despite stale Journey phase context", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
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

    const staleBoardRow = await screen.findByRole("button", { name: /q-93 Done quest with stale board row/ });
    const staleBoardStatus = within(staleBoardRow).getByText("Completed");
    expect(staleBoardStatus).toBeInTheDocument();
    expect(within(staleBoardRow).queryByText("Port")).not.toBeInTheDocument();
    expect(within(staleBoardRow).queryByText("0/1")).not.toBeInTheDocument();

    const staleRunRow = screen.getByRole("button", { name: /q-94 Done quest with stale run/ });
    expect(within(staleRunRow).getByText("Completed")).toBeInTheDocument();
    expect(within(staleRunRow).queryByText("Port")).not.toBeInTheDocument();
    expect(within(staleRunRow).queryByText("0/1")).not.toBeInTheDocument();

    fireEvent.mouseEnter(staleBoardStatus);
    expect(await screen.findByTestId("quest-hover-journey")).toBeInTheDocument();
    expect(screen.getByTestId("quest-hover-status-row")).toHaveTextContent("Done");
    expect(screen.getByTestId("quest-hover-status-row")).not.toHaveTextContent("Port");
    expect(screen.getByTestId("quest-hover-journey")).toHaveTextContent("Completed Journey");
  });

  it("limits compact title cells to title, tags, and one plain-text description TLDR string", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-90-v1", questId: "q-90", title: "Markdown TLDR quest" }),
        tldr: [
          "Use [q-986](quest:q-986) direction for the compact table.",
          "Keep this second line in the same truncated string instead of a second rendered line.",
        ].join("\n"),
        debriefTldr: "Debrief should not appear in compact title cells.",
        feedback: [
          {
            author: "agent",
            text: "Full phase summary should not appear in compact title cells.",
            tldr: "Phase summary should not appear.",
            ts: Date.now(),
            kind: "phase_summary",
            phaseId: "implement",
          },
        ],
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /q-90 Markdown TLDR quest/ });
    const tldr = within(row).getByTestId("quest-compact-tldr");
    expect(tldr).toHaveTextContent(
      "Use q-986 direction for the compact table. Keep this second line in the same truncated string instead of a second rendered line.",
    );
    expect(within(tldr).queryByRole("link", { name: "q-986" })).not.toBeInTheDocument();
    expect(within(row).getByText("#ui")).toBeInTheDocument();
    expect(within(row).getByText("#questmaster")).toBeInTheDocument();
    expect(within(row).queryByText(/Debrief should not appear/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Phase summary should not appear/)).not.toBeInTheDocument();
  });

  it("splits compact Owner and Leader into separate columns", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
    mockState.sdkSessions = [
      {
        sessionId: "worker-1347",
        sessionNum: 1347,
        state: "idle",
        cwd: "/tmp",
        createdAt: 1,
        archived: false,
      },
      {
        sessionId: "leader-1286",
        sessionNum: 1286,
        state: "idle",
        cwd: "/tmp",
        createdAt: 1,
        archived: false,
      },
    ];
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-91-v1", questId: "q-91", title: "Split owner leader quest" }),
        sessionId: "worker-1347",
        leaderSessionId: "leader-1286",
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    const row = await screen.findByRole("button", { name: /q-91 Split owner leader quest/ });
    const cells = row.querySelectorAll("td");
    expect(cells[2]).toHaveTextContent("#1347");
    expect(cells[2]).not.toHaveTextContent("Leader");
    expect(cells[2]).not.toHaveTextContent("#1286");
    expect(cells[3]).toHaveTextContent("#1286");
  });

  it("does not intercept keyboard activation on compact quest ID links", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });
    mockState.quests = [
      {
        ...buildVerificationQuest({ id: "q-92-v1", questId: "q-92", title: "Quest ID link quest" }),
      } as QuestmasterTask,
    ];

    renderQuestmaster({ isActive: true });

    await screen.findByRole("button", { name: /q-92 Quest ID link quest/ });
    const questLink = screen.getByRole("link", { name: "q-92" });
    questLink.focus();
    expect(questLink).toHaveFocus();

    const enterEvent = createEvent.keyDown(questLink, { key: "Enter" });
    fireEvent(questLink, enterEvent);
    expect(enterEvent.defaultPrevented).toBe(false);

    const spaceEvent = createEvent.keyDown(questLink, { key: " " });
    fireEvent(questLink, spaceEvent);
    expect(spaceEvent.defaultPrevented).toBe(false);
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();

    fireEvent.click(questLink);
    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-92");
    expect(mockState.questOverlayId).toBe("q-92");
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

  it("opens quest overlay via store when clicking a compact row", async () => {
    // Clicking a compact row should set questOverlayId on the store so
    // QuestDetailPanel renders the detail modal globally.
    renderQuestmaster({ isActive: true });

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    await screen.findAllByRole("columnheader", { name: "Quest" });

    fireEvent.click(screen.getByRole("button", { name: /q-1 Fresh verification quest/ }));

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

  it("opens compact quest id links with hover previews and copies from the adjacent icon", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /q-1 Fresh verification quest/ });

    const questLink = screen.getByRole("link", { name: "q-1" });
    fireEvent.mouseEnter(questLink);
    expect(await screen.findByTestId("quest-hover-card")).toBeInTheDocument();

    fireEvent.click(questLink);
    expect(mockState.openQuestOverlay).toHaveBeenCalledWith("q-1");
    expect(mockState.questOverlayId).toBe("q-1");

    mockState.openQuestOverlay.mockClear();
    mockState.questOverlayId = null;
    fireEvent.click(screen.getByRole("button", { name: "Copy quest ID q-1" }));

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("q-1");
    });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();
  });

  it("blocks compact row keyboard open when compact quest id controls are focused", async () => {
    mockGetSettings.mockResolvedValueOnce({ questmasterViewMode: "compact" });

    renderQuestmaster({ isActive: true });
    await screen.findByRole("button", { name: /q-1 Fresh verification quest/ });

    const questLink = screen.getByRole("link", { name: "q-1" });
    const copyButton = screen.getByRole("button", { name: "Copy quest ID q-1" });

    fireEvent.keyDown(questLink, { key: " " });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();

    // JSDOM does not synthesize the native button click from Enter, so assert
    // the keydown does not bubble to the row, then emulate activation click.
    fireEvent.keyDown(copyButton, { key: "Enter" });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();

    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockClipboardWriteText).toHaveBeenCalledWith("q-1");
    });
    expect(mockState.openQuestOverlay).not.toHaveBeenCalled();
    expect(mockState.questOverlayId).toBeNull();
  });

  it("opens compact rows even when their Cards-mode section is collapsed", async () => {
    // Compact view is flat: a previously-collapsed Cards group must not prevent overlay.
    renderQuestmaster({ isActive: true });

    fireEvent.click(screen.getByRole("button", { name: /^Completed2$/ }));
    expect(screen.queryByText("Fresh verification quest")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    await screen.findByRole("button", { name: /q-1 Fresh verification quest/ });

    fireEvent.click(screen.getByRole("button", { name: /q-1 Fresh verification quest/ }));

    expect(mockState.questOverlayId).toBe("q-1");
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

  it("highlights card with primary border when overlay is open for that quest", () => {
    // The card's appearance should reflect the overlay state from the store.
    mockState.questOverlayId = "q-1";
    renderQuestmaster({ isActive: true });

    const card = document.querySelector('[data-quest-id="q-1"]');
    expect(card).toBeTruthy();
    expect(card!.className).toContain("border-cc-primary");
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
