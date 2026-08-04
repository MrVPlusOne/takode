// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { QuestJourneyPhaseId, QuestJourneyPlanState } from "../../shared/quest-journey.js";
import { QuestJourneyPreviewCard, QuestJourneyTimeline } from "./QuestJourneyTimeline.js";

const PHASE_CYCLE: QuestJourneyPhaseId[] = ["alignment", "work", "user-checkpoint", "work", "memory"];

function longJourney(overrides: Partial<QuestJourneyPlanState> = {}): QuestJourneyPlanState {
  const phaseIds = Array.from({ length: 38 }, (_, index) => PHASE_CYCLE[index % PHASE_CYCLE.length]);
  return {
    mode: "active",
    phaseIds,
    currentPhaseId: phaseIds[20],
    activePhaseIndex: 20,
    ...overrides,
  };
}

function visiblePhaseIndexes(container: HTMLElement): number[] {
  return Array.from(container.querySelectorAll("li[data-phase-index]")).map((row) =>
    Number(row.getAttribute("data-phase-index")),
  );
}

describe("QuestJourneyTimeline vertical clamping", () => {
  it("clamps long active vertical Journeys around the current phase and expands omitted blocks inline", () => {
    const journey = longJourney({
      currentPhaseId: longJourney().phaseIds[22],
      activePhaseIndex: 22,
      phaseNotes: {
        "16": "Hidden earlier boundary note",
        "17": "Visible earlier boundary note",
        "32": "Visible later boundary note",
        "33": "Hidden later boundary note",
      },
      phaseTimings: {
        "17": { startedAt: 1_000, endedAt: 61_000 },
      },
    });

    render(<QuestJourneyTimeline journey={journey} status="USER_CHECKPOINTING" variant="vertical" />);

    const timeline = screen.getByTestId("quest-journey-timeline");
    expect(visiblePhaseIndexes(timeline)).toEqual(Array.from({ length: 16 }, (_, index) => index + 17));
    expect(timeline.querySelector('li[data-phase-index="22"]')).toHaveAttribute("data-phase-current", "true");
    expect(timeline).toHaveTextContent("38 phases · Partial 1m");
    expect(within(timeline).getByTestId("quest-journey-phase-duration")).toHaveTextContent("1m");
    expect(within(timeline).queryByText("duration unavailable")).toBeNull();
    expect(within(timeline).getByRole("button", { name: "Show 17 earlier phases" })).toBeInTheDocument();
    expect(within(timeline).getByRole("button", { name: "Show 5 later phases" })).toBeInTheDocument();
    expect(within(timeline).queryByText("Hidden earlier boundary note")).toBeNull();
    expect(within(timeline).getByText("Visible earlier boundary note")).toBeInTheDocument();
    expect(within(timeline).getByText("Visible later boundary note")).toBeInTheDocument();
    expect(within(timeline).queryByText("Hidden later boundary note")).toBeNull();

    fireEvent.click(within(timeline).getByRole("button", { name: "Show 17 earlier phases" }));
    expect(visiblePhaseIndexes(timeline).slice(0, 16)).toEqual(Array.from({ length: 16 }, (_, index) => index));
    expect(within(timeline).getByRole("button", { name: "Hide 17 earlier phases" })).toBeInTheDocument();
    expect(within(timeline).getByText("Hidden earlier boundary note")).toBeInTheDocument();

    fireEvent.click(within(timeline).getByRole("button", { name: "Show 5 later phases" }));
    expect(visiblePhaseIndexes(timeline).slice(-5)).toEqual([33, 34, 35, 36, 37]);
    expect(within(timeline).getByRole("button", { name: "Hide 5 later phases" })).toBeInTheDocument();
    expect(within(timeline).getByText("Hidden later boundary note")).toBeInTheDocument();
  });

  it("clamps prior phases even when the whole Journey fits the nominal visible row limit", () => {
    const phaseIds: QuestJourneyPhaseId[] = [
      "alignment",
      "work",
      "user-checkpoint",
      "work",
      "user-checkpoint",
      "work",
      "user-checkpoint",
      "work",
      "user-checkpoint",
      "work",
      "user-checkpoint",
      "work",
      "memory",
    ];

    render(
      <QuestJourneyTimeline
        journey={{
          mode: "active",
          phaseIds,
          currentPhaseId: "work",
          activePhaseIndex: 11,
          phaseNotes: {
            "5": "Sixth previous phase should be hidden by default.",
            "6": "First visible previous phase.",
          },
        }}
        status="WORKING"
        variant="vertical"
      />,
    );

    const timeline = screen.getByTestId("quest-journey-timeline");
    expect(visiblePhaseIndexes(timeline)).toEqual([6, 7, 8, 9, 10, 11, 12]);
    expect(timeline.querySelector('li[data-phase-index="11"]')).toHaveAttribute("data-phase-current", "true");
    expect(within(timeline).getByRole("button", { name: "Show 6 earlier phases" })).toBeInTheDocument();
    expect(within(timeline).queryByRole("button", { name: /later phases/ })).toBeNull();
    expect(within(timeline).queryByText("Sixth previous phase should be hidden by default.")).toBeNull();
    expect(within(timeline).getByText("First visible previous phase.")).toBeInTheDocument();

    fireEvent.click(within(timeline).getByRole("button", { name: "Show 6 earlier phases" }));
    expect(visiblePhaseIndexes(timeline)).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(within(timeline).getByText("Sixth previous phase should be hidden by default.")).toBeInTheDocument();
  });

  it("keeps start-adjacent current phases anchored at the beginning without an earlier omitted block", () => {
    const phaseIds = longJourney().phaseIds;
    render(
      <QuestJourneyTimeline
        journey={{ mode: "active", phaseIds, currentPhaseId: phaseIds[2], activePhaseIndex: 2 }}
        status="USER_CHECKPOINTING"
        variant="vertical"
      />,
    );

    const timeline = screen.getByTestId("quest-journey-timeline");
    expect(visiblePhaseIndexes(timeline)).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(within(timeline).queryByRole("button", { name: /earlier phases/ })).toBeNull();
    expect(within(timeline).getByRole("button", { name: "Show 25 later phases" })).toBeInTheDocument();
  });

  it("anchors completed and no-current vertical Journeys near the final phase", () => {
    const phaseIds = longJourney().phaseIds;

    render(<QuestJourneyTimeline journey={{ mode: "active", phaseIds }} status="done" variant="vertical" />);

    const timeline = screen.getByTestId("quest-journey-timeline");
    expect(timeline).toHaveAttribute("data-journey-mode", "completed");
    expect(visiblePhaseIndexes(timeline)).toEqual([32, 33, 34, 35, 36, 37]);
    expect(within(timeline).getByRole("button", { name: "Show 32 earlier phases" })).toBeInTheDocument();
    expect(within(timeline).queryByRole("button", { name: /later phases/ })).toBeNull();
  });

  it("does not clamp short vertical Journeys", () => {
    render(
      <QuestJourneyPreviewCard
        journey={{
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          currentPhaseId: "work",
        }}
        status="WORKING"
      />,
    );

    const preview = screen.getByTestId("quest-journey-preview-card");
    expect(visiblePhaseIndexes(preview)).toEqual([0, 1, 2]);
    expect(within(preview).queryByTestId("quest-journey-omitted-phases")).toBeNull();
  });

  it("renders migrated legacy notes separately from active v2 phase notes", () => {
    render(
      <QuestJourneyTimeline
        journey={{
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
          currentPhaseId: "work",
          phaseNotes: {
            "1": "Active v2 Work migration summary",
          },
          v2Migration: {
            version: 2,
            migratedAt: 10_000,
            fromPhaseIds: ["alignment", "implement", "code-review", "port", "memory"],
            legacyPhases: [
              { index: 2, phasePosition: 3, phaseOccurrence: 1, phaseId: "code-review", note: "Old review note" },
              {
                index: 4,
                phasePosition: 5,
                phaseOccurrence: 1,
                rawPhaseId: "definitely-not-a-phase",
                diagnostic: "unknown or malformed legacy phase id",
                note: "Unknown legacy note",
              },
              {
                index: 3,
                phasePosition: 4,
                phaseOccurrence: 1,
                phaseId: "port",
                note: "Old port note",
                timing: { startedAt: 1000, endedAt: 61_000 },
              },
            ],
          },
        }}
        status="WORKING"
        variant="vertical"
      />,
    );

    const timeline = screen.getByTestId("quest-journey-timeline");
    const activeNotes = within(timeline).getAllByTestId("quest-journey-phase-purpose");
    expect(activeNotes.map((node) => node.textContent)).toEqual(["Active v2 Work migration summary"]);
    expect(within(timeline).getByTestId("quest-journey-legacy-history")).toHaveTextContent("Legacy v1 History");
    expect(within(timeline).getByText("3. Code Review")).toBeInTheDocument();
    expect(within(timeline).getByText("Old review note")).toBeInTheDocument();
    expect(within(timeline).getByText("4. Port")).toBeInTheDocument();
    expect(within(timeline).getByText("Old port note")).toBeInTheDocument();
    expect(within(timeline).getByText("5. definitely-not-a-phase")).toBeInTheDocument();
    expect(within(timeline).getByText("Unknown legacy note")).toBeInTheDocument();
    expect(within(timeline).queryByText("5. Memory")).toBeNull();
    expect(within(timeline).getByText("1m")).toBeInTheDocument();
  });
});
