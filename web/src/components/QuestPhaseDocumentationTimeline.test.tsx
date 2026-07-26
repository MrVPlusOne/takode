// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { QuestDetailTextSections } from "./QuestDetailTextSections.js";
import { QuestPhaseDocumentationTimeline } from "./QuestPhaseDocumentationTimeline.js";
import type { QuestmasterTask } from "../types.js";
import type {
  IndexedQuestFeedbackEntry,
  QuestPhaseDocumentationSummary,
} from "../../shared/quest-phase-documentation-summary.js";
import type { QuestJourneyRun } from "../../server/quest-types.js";
import type { QuestJourneyPhaseId } from "../../shared/quest-journey.js";

function entry(index: number, text: string): IndexedQuestFeedbackEntry {
  return {
    index,
    author: "agent",
    text,
    tldr: text,
    ts: 1_000 + index,
  };
}

function group({
  runId,
  runOrdinal,
  position,
  phaseId = "implement",
  phaseStatus = "completed",
  text,
}: {
  runId: string;
  runOrdinal: number;
  position: number;
  phaseId?: QuestJourneyPhaseId;
  phaseStatus?: "pending" | "active" | "completed" | "skipped" | "manual";
  text: string;
}): QuestPhaseDocumentationSummary["groups"][number] {
  return {
    key: `${runId}:p${position}`,
    phaseId,
    phaseLabel: phaseId,
    displayLabel: `${phaseId} ${position}`,
    metaLabel: `run ${runOrdinal} / phase ${position}`,
    phaseStatus,
    journeyRunId: runId,
    journeyRunOrdinal: runOrdinal,
    phaseOccurrenceId: `${runId}:p${position}`,
    phaseIndex: position - 1,
    phasePosition: position,
    phaseOccurrence: 1,
    scopeMatched: true,
    entries: [entry(runOrdinal * 100 + position, text)],
  };
}

function run(runId: string, ordinal: number, phaseCount: number): QuestJourneyRun {
  return {
    runId,
    source: "board",
    phaseIds: Array.from({ length: phaseCount }, () => "implement"),
    status: "active",
    createdAt: ordinal,
    updatedAt: ordinal,
    phaseOccurrences: [],
  };
}

function longSummary(): QuestPhaseDocumentationSummary {
  const earlierRunGroups = [
    group({ runId: "run-1", runOrdinal: 1, position: 1, phaseStatus: "active", text: "Earlier run active TLDR" }),
    group({ runId: "run-1", runOrdinal: 1, position: 2, text: "Earlier run second TLDR" }),
  ];
  const latestRunGroups = Array.from({ length: 20 }, (_, index) =>
    group({
      runId: "run-2",
      runOrdinal: 2,
      position: index + 1,
      phaseStatus: index === 9 ? "active" : "completed",
      text: `Latest run phase ${index + 1} TLDR`,
    }),
  );
  return {
    hasJourneyRuns: true,
    hasPhaseDocumentation: true,
    primaryRun: run("run-2", 2, 20),
    groups: [...earlierRunGroups, ...latestRunGroups],
    scopedEntries: [],
    unscopedFeedback: [],
  };
}

describe("QuestPhaseDocumentationTimeline", () => {
  it("collapses older Journey runs and windows the latest run around its active phase", () => {
    render(<QuestPhaseDocumentationTimeline summary={longSummary()} />);

    expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Latest Journey run/ })).toHaveAttribute("aria-expanded", "true");
    expect(document.body).not.toHaveTextContent("Earlier run active TLDR");
    expect(document.body).toHaveTextContent("Latest run phase 5 TLDR");
    expect(document.body).toHaveTextContent("Latest run phase 20 TLDR");
    expect(document.body).not.toHaveTextContent("Latest run phase 1 TLDR");
    expect(screen.getByRole("button", { name: "Show 4 earlier phases" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Earlier Journey run 1/ }));
    expect(document.body).toHaveTextContent("Earlier run active TLDR");

    fireEvent.click(screen.getByRole("button", { name: "Show 4 earlier phases" }));
    expect(document.body).toHaveTextContent("Latest run phase 1 TLDR");
    expect(screen.getByRole("button", { name: "Hide 4 earlier phases" })).toBeInTheDocument();
  });

  it("reveals collapsed runs and windows while search highlighting is active", () => {
    render(<QuestPhaseDocumentationTimeline summary={longSummary()} searchHighlight="Earlier run" />);

    expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveAttribute("aria-expanded", "true");
    expect(document.body).toHaveTextContent("Earlier run active TLDR");
    expect(document.body).toHaveTextContent("Latest run phase 1 TLDR");
    expect(screen.queryByRole("button", { name: /Show .* earlier phases/ })).toBeNull();
  });
});

describe("QuestDetailTextSections Journey Details toggle", () => {
  const quest: QuestmasterTask = {
    id: "q-42-v1",
    questId: "q-42",
    version: 1,
    title: "Compact journeys",
    status: "refined",
    description: "Keep long Journey details compact.",
    createdAt: 1,
  };

  it("defaults expanded, collapses locally, and resets on remount", () => {
    const summary = longSummary();
    const { unmount } = render(<QuestDetailTextSections quest={quest} phaseDocumentationSummary={summary} />);

    expect(screen.getByTestId("quest-phase-documentation-timeline")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("quest-journey-details-toggle"));
    expect(screen.queryByTestId("quest-phase-documentation-timeline")).toBeNull();

    unmount();
    cleanup();
    render(<QuestDetailTextSections quest={quest} phaseDocumentationSummary={summary} />);
    const toggle = screen.getByTestId("quest-journey-details-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(document.body).getByTestId("quest-phase-documentation-timeline")).toBeInTheDocument();
  });
});
