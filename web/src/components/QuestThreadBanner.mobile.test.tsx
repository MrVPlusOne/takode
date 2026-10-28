// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildLeaderThreadRowsFromSummaries } from "../../shared/leader-projection.js";
import { buildThreadMonitoringProjection } from "../../server/thread-monitoring-projection.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { useStore } from "../store.js";
import { fingerTap } from "../test-fixtures/finger-tap.js";
import { QuestThreadBanner } from "./QuestThreadBanner.js";
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
      { sessionId: "leader", sessionNum: 1, state: "connected", cwd: "/leader", createdAt: 1, isOrchestrator: true },
      { sessionId: "worker", sessionNum: 10, state: "connected", cwd: "/fixture", createdAt: 1 },
      { sessionId: "reviewer", sessionNum: 20, state: "exited", cwd: "/fixture", createdAt: 1 },
    ]);
    setMonitoring(false);
  });

  // A quest thread's strip keeps one line on phones: Worker, Reviewer and commits are in the phase
  // pill's card (a tap away), so there is no disclosure for them; Notify Me is an icon in the strip.
  it("keeps Worker, Reviewer and commits in the pill's card with no disclosure, and Notify as an icon", () => {
    setMonitoring(true);
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" monitorSessionId="leader" diffSessionId="leader" />);
    expect(screen.queryByRole("button", { name: /quest information/ })).not.toBeInTheDocument();
    const banner = screen.getByTestId("quest-thread-banner");
    expect(within(banner).queryByRole("link", { name: "Worker #10" })).not.toBeInTheDocument();
    // The Notify icon has no word but still acknowledges a waiting result.
    const acknowledge = within(banner).getByRole("button", { name: "Acknowledge" });
    expect(acknowledge).not.toHaveTextContent("Acknowledge");
    fireEvent.click(acknowledge);
    expect(updateThreadMonitoring).toHaveBeenCalledWith("leader", "q-9001", "acknowledge", "1");

    fingerTap(screen.getByTestId("quest-thread-journey-hover-target"));
    const card = within(screen.getByTestId("quest-thread-journey-hover-card"));
    expect(card.getByRole("link", { name: "Worker #10" })).toHaveAttribute("href", "#/session/10");
    expect(card.getByRole("link", { name: "Reviewer #20" })).toHaveAttribute("href", "#/session/20");
    expect(card.getByTestId("quest-thread-diff-chip-commits")).toHaveTextContent("1 commit");
  });

  it("starts expanded and retains a deliberate collapse of the open questions across phase and result updates", () => {
    // Open questions to the user still sit in the strip, behind the phone disclosure.
    const withQuestions = (checkpoint = false) => {
      const row = bannerRow(checkpoint);
      return { ...row, boardRow: { ...row.boardRow!, openQuestions: ["n-1"] } };
    };
    const { rerender } = render(
      <QuestThreadBanner row={withQuestions()} threadKey="q-9001" monitorSessionId="leader" diffSessionId="leader" />,
    );
    const details = screen.getByTestId("quest-thread-details");
    const toggle = screen.getByRole("button", { name: "Collapse quest information" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(within(details).getByTestId("quest-thread-open-questions-pill")).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(details).toHaveClass("hidden");
    rerender(
      <QuestThreadBanner
        row={withQuestions(true)}
        threadKey="q-9001"
        monitorSessionId="leader"
        diffSessionId="leader"
      />,
    );
    act(() => setMonitoring(true));
    expect(screen.getByTestId("quest-journey-compact-summary")).toHaveTextContent("User Checkpoint3/5");
    expect(screen.getByRole("button", { name: "Expand quest information" })).toHaveAttribute("aria-expanded", "false");
    expect(details).toHaveClass("hidden");

    // A different quest starts expanded again.
    rerender(
      <QuestThreadBanner
        row={{ ...withQuestions(), questId: "q-9002", threadKey: "q-9002" }}
        threadKey="q-9002"
        diffSessionId="leader"
      />,
    );
    expect(screen.getByRole("button", { name: "Collapse quest information" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("quest-thread-details")).not.toHaveClass("hidden");
  });

  it("keeps the close button outside the content that wraps on wider screens", () => {
    // The strip's title and chips wrap onto more lines as the window narrows. The close
    // button must not be one of the wrapping items, or it drops onto its own line at the
    // left; as the row's last direct child it keeps the top right corner at every width.
    // Real widths are covered in browser validation.
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" diffSessionId="leader" onCloseTab={() => {}} />);
    const wrapping = screen.getByTestId("quest-thread-wrapping-content");
    const close = screen.getByTestId("quest-thread-close-tab");
    expect(within(wrapping).getByText("q-9001")).toBeInTheDocument();
    expect(within(wrapping).getByTestId("quest-thread-meta-strip")).toBeInTheDocument();
    expect(wrapping).not.toContainElement(close);
    expect(close.parentElement).toBe(wrapping.parentElement);
    expect(close.parentElement?.lastElementChild).toBe(close);
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

  it("toggles the Journey card with taps while a mouse still hovers it open", () => {
    // A tap emulates mouseover before its click. If that hover opened the card,
    // the click would close it again; and a second tap must close it, so an
    // accidental tap is undone on the same spot.
    render(<QuestThreadBanner row={bannerRow()} threadKey="q-9001" diffSessionId="leader" />);
    const target = screen.getByRole("button", { name: "Show Quest Journey preview" });
    const card = () => document.body.querySelector('[data-testid="quest-thread-journey-hover-card"]');

    fingerTap(target);
    expect(card()).toBeInTheDocument();
    fingerTap(target);
    expect(card()).not.toBeInTheDocument();

    fireEvent.pointerOver(target, { pointerType: "mouse" });
    fireEvent.mouseOver(target);
    expect(card()).toBeInTheDocument();
    // A mouse click keeps the hovered card open rather than toggling it shut.
    fireEvent.pointerDown(target, { pointerType: "mouse" });
    fireEvent.click(target);
    expect(card()).toBeInTheDocument();
  });
});
