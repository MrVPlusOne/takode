// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaderThreadRowsFromSummaries } from "../../shared/leader-projection.js";
import { buildThreadMonitoringProjection } from "../../server/thread-monitoring-projection.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { useStore } from "../store.js";
import { QuestThreadBanner } from "./ChatView.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";

vi.mock("../api/thread-monitoring.js", () => ({ updateThreadMonitoring: vi.fn().mockResolvedValue({}) }));

function bannerRow(checkpoint = false) {
  // Use the shared producer so the view consumes the same assignment/Journey
  // relationship as a real leader banner, including a numerically newer reviewer.
  return buildLeaderThreadRowsFromSummaries({
    activeBoard: [
      {
        questId: "q-9001",
        title: "Review the navigation comparison and next steps",
        status: checkpoint ? "USER_CHECKPOINTING" : "WORKING",
        worker: "worker",
        workerNum: 10,
        createdAt: 1,
        updatedAt: 2,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
          currentPhaseId: checkpoint ? "user-checkpoint" : "work",
          activePhaseIndex: checkpoint ? 2 : 1,
        },
      },
    ],
    completedBoard: [],
    threadSummaries: [],
    quests: [],
    rowSessionStatuses: {
      "q-9001": {
        worker: { sessionId: "worker", sessionNum: 10, status: "idle" },
        reviewer: { sessionId: "reviewer", sessionNum: 20, status: "disconnected" },
      },
    },
  })[0];
}

function setMonitoring(pending: boolean) {
  useStore.getState().applySyncedProjectionSnapshot({
    projection: THREAD_MONITORING_PROJECTION,
    key: "leader",
    generation: "mobile-banner",
    revision: pending ? 2 : 1,
    value: buildThreadMonitoringProjection({
      state: {
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-9001"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
        threadMonitoring: {
          revision: pending ? 2 : 1,
          alertVersion: 1,
          threads: {
            "q-9001": {
              trackedAt: 1,
              afterHistoryIndex: 0,
              pending: pending ? { id: "1", messageId: "answer-1", timestamp: 2, summary: "Ready" } : null,
            },
          },
        },
      },
    }),
  });
}

describe("mobile quest banner disclosure", () => {
  beforeEach(() => {
    useStore.getState().reset();
    vi.clearAllMocks();
    for (const questId of ["q-9001", "q-9002"]) {
      useStore.getState().upsertQuestTitlePreview({
        questId,
        title: "Banner example",
        version: 1,
        updatedAt: 1,
        commitShas: ["abc1234"],
      });
    }
    useStore.getState().setSdkSessions([
      { sessionId: "worker", sessionNum: 10, state: "connected", cwd: "/fixture", createdAt: 1 },
      { sessionId: "reviewer", sessionNum: 20, state: "exited", cwd: "/fixture", createdAt: 1 },
    ]);
    setMonitoring(false);
  });

  it("starts expanded and retains a deliberate collapse across authoritative phase and result updates", () => {
    const { rerender } = render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" monitorSessionId="leader" />);
    const details = screen.getByTestId("quest-thread-details");
    const toggle = screen.getByRole("button", { name: "Collapse quest information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(details).not.toHaveClass("hidden");
    expect(screen.getByTestId("quest-journey-compact-summary")).toHaveTextContent("Work2/5");

    fireEvent.click(toggle);
    expect(details).toHaveClass("hidden");
    rerender(<QuestThreadBanner row={bannerRow(true)} threadKey="q-9001" monitorSessionId="leader" />);
    act(() => setMonitoring(true));
    expect(screen.getByTestId("quest-journey-compact-summary")).toHaveTextContent("User Checkpoint3/5");
    expect(screen.getByRole("button", { name: "Expand quest information" })).toHaveAttribute("aria-expanded", "false");
    expect(details).toHaveClass("hidden");
    expect(updateThreadMonitoring).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Expand quest information" }));
    expect(details).not.toHaveClass("hidden");
    expect(within(details).getByRole("link", { name: "Worker #10" })).toHaveAttribute("href", "#/session/10");
    expect(within(details).getByTestId("quest-thread-commit-button")).toHaveTextContent("1 commit");
    fireEvent.click(within(details).getByRole("button", { name: "Acknowledge" }));
    expect(updateThreadMonitoring).toHaveBeenCalledWith("leader", "q-9001", "acknowledge", "1");
  });

  it("starts a different quest expanded and retains reviewer access in the desktop presentation", () => {
    const { rerender } = render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" />);
    // CSS removes only the mobile reviewer link. Its exact desktop destination
    // and server-owned identity remain intact; real widths are covered in browser validation.
    const reviewer = screen.getByRole("link", { name: "Reviewer #20" });
    expect(reviewer).toHaveAttribute("href", "#/session/20");
    expect(reviewer.parentElement).toHaveClass("hidden", "sm:contents");
    fireEvent.click(screen.getByRole("button", { name: "Collapse quest information" }));
    rerender(<QuestThreadBanner row={{ ...bannerRow(), questId: "q-9002", threadKey: "q-9002" }} threadKey="q-9002" />);
    expect(screen.getByRole("button", { name: "Collapse quest information" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("quest-thread-details")).not.toHaveClass("hidden");
  });

  it("does not offer an empty disclosure on a session banner with only a Journey", () => {
    render(
      <QuestThreadBanner
        row={{ threadKey: "q-9001", title: "Journey only", journey: bannerRow().journey }}
        threadKey="q-9001"
        variant="session"
      />,
    );
    expect(screen.queryByRole("button", { name: /quest information/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show Quest Journey preview" })).toBeInTheDocument();
  });
});
