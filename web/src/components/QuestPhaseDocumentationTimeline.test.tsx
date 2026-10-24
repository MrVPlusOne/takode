// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const groups = [...earlierRunGroups, ...latestRunGroups];
  return {
    hasJourneyRuns: true,
    hasPhaseDocumentation: true,
    primaryRun: run("run-2", 2, 20),
    groups,
    scopedEntries: groups.flatMap((item) => item.entries),
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

  it("reveals an exact target inside a collapsed older Journey run", async () => {
    const onTargetReady = vi.fn();
    render(
      <QuestPhaseDocumentationTimeline
        summary={longSummary()}
        feedbackTarget={{ index: 101, requestId: 1 }}
        highlightedFeedbackIndex={101}
        onFeedbackTargetReady={onTargetReady}
      />,
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveAttribute("aria-expanded", "true"),
    );
    const target = document.querySelector<HTMLElement>('[data-feedback-index="101"]');
    expect(target).toHaveAttribute("data-feedback-highlighted", "true");
    expect(target?.querySelector("details")).toHaveAttribute("open");
    expect(onTargetReady).toHaveBeenCalledWith(target);
  });

  it("expands an omitted phase window that contains the exact target", async () => {
    render(<QuestPhaseDocumentationTimeline summary={longSummary()} feedbackTarget={{ index: 201, requestId: 1 }} />);

    await waitFor(() => expect(document.body).toHaveTextContent("Latest run phase 1 TLDR"));
    expect(screen.getByRole("button", { name: "Hide 4 earlier phases" })).toBeInTheDocument();
    expect(document.querySelector('[data-feedback-index="201"]')).toBeInTheDocument();
  });

  it("recomputes target window expansion when full detail hydrates under the same run and group keys", async () => {
    const hydrated = longSummary();
    const previewGroups = hydrated.groups.filter(
      (item) => item.journeyRunId !== "run-2" || (item.phasePosition ?? 0) <= 4,
    );
    const preview = {
      ...hydrated,
      primaryRun: run("run-2", 2, 4),
      groups: previewGroups,
      scopedEntries: previewGroups.flatMap((item) => item.entries),
    };
    const target = { index: 201, requestId: 1 };
    const { rerender } = render(<QuestPhaseDocumentationTimeline summary={preview} feedbackTarget={target} />);
    expect(document.querySelector('[data-feedback-index="201"]')).toBeInTheDocument();

    rerender(<QuestPhaseDocumentationTimeline summary={hydrated} feedbackTarget={target} />);

    await waitFor(() => expect(document.querySelector('[data-feedback-index="201"]')).toBeInTheDocument());
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

describe("QuestPhaseDocumentationTimeline unscoped feedback", () => {
  // Two dated runs: unscoped feedback lands inside the phase its time falls in, or between the runs
  // when it was written after one run ended and before the next started.
  function datedSummary(): QuestPhaseDocumentationSummary {
    const dated = (runId: string, runOrdinal: number, startedAt: number, completedAt: number, text: string) => ({
      ...group({ runId, runOrdinal, position: 1, text }),
      startedAt,
      completedAt,
      entries: [{ ...entry(runOrdinal * 100, text), ts: completedAt }],
    });
    const groups = [dated("run-1", 1, 1_000, 2_000, "Run one note"), dated("run-2", 2, 5_000, 6_000, "Run two note")];
    const humanFeedback = (index: number, text: string, ts: number): IndexedQuestFeedbackEntry => ({
      index,
      author: "human",
      text,
      ts,
    });
    return {
      hasJourneyRuns: true,
      hasPhaseDocumentation: true,
      primaryRun: run("run-2", 2, 1),
      groups,
      scopedEntries: groups.flatMap((item) => item.entries),
      unscopedFeedback: [
        humanFeedback(1, "Before any run", 500),
        humanFeedback(2, "During run one", 1_500),
        humanFeedback(3, "**Start** the second run", 3_000),
        humanFeedback(4, "During run two", 5_500),
      ],
    };
  }

  it("shows feedback collapsed at its time position: between runs and inside phases", () => {
    render(<QuestPhaseDocumentationTimeline summary={datedSummary()} />);

    const list = screen.getByTestId("quest-phase-documentation-run-list");
    const topLevel = [...list.children].map((child) =>
      child.getAttribute("data-testid") === "quest-journey-feedback"
        ? `feedback ${child.getAttribute("data-feedback-index")}`
        : child.getAttribute("data-run-key"),
    );
    expect(topLevel).toEqual(["feedback 1", "run:run-1", "feedback 3", "run:run-2"]);

    // The older run is collapsed, but its header counts the feedback inside it.
    expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveTextContent("1 feedback");
    const latestRun = list.querySelector('[data-run-key="run:run-2"]')!;
    const insidePhase = within(latestRun as HTMLElement).getByTestId("quest-journey-feedback");
    expect(insidePhase).toHaveAttribute("data-feedback-index", "4");

    // Collapsed rows show a one-line plain-text preview, not the full Markdown entry.
    const between = screen.getByRole("button", { name: "Show user feedback #3" });
    expect(between).toHaveTextContent("Start the second run");
    expect(between.querySelector("strong")).toBeNull();
  });

  it("expands a feedback row into the full entry and collapses it again", () => {
    render(<QuestPhaseDocumentationTimeline summary={datedSummary()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show user feedback #3" }));
    const expanded = document.querySelector<HTMLElement>('[data-feedback-index="3"]')!;
    expect(expanded).toHaveAttribute("data-feedback-expanded", "true");
    expect(within(expanded).getByText("Start").tagName).toBe("STRONG");

    fireEvent.click(screen.getByRole("button", { name: "Collapse feedback #3" }));
    expect(screen.getByRole("button", { name: "Show user feedback #3" })).toBeInTheDocument();
  });

  it("uses the supplied renderer for expanded entries and expands a linked entry", async () => {
    render(
      <QuestPhaseDocumentationTimeline
        summary={datedSummary()}
        feedbackTarget={{ index: 2, requestId: 1 }}
        renderFeedbackEntry={(item, { collapseControl }) => (
          <div data-testid="custom-feedback">
            {collapseControl}
            Custom {item.text}
          </div>
        )}
      />,
    );

    // Feedback #2 is inside the collapsed older run; the link opens the run and the entry.
    await waitFor(() => expect(screen.getByTestId("custom-feedback")).toHaveTextContent("Custom During run one"));
    expect(screen.getByRole("button", { name: /Earlier Journey run 1/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Collapse feedback #2" })).toBeInTheDocument();
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

  it("reopens Journey Details when a scoped feedback target arrives", async () => {
    const summary = longSummary();
    const { rerender } = render(<QuestDetailTextSections quest={quest} phaseDocumentationSummary={summary} />);
    fireEvent.click(screen.getByTestId("quest-journey-details-toggle"));
    expect(screen.queryByTestId("quest-phase-documentation-timeline")).toBeNull();

    rerender(
      <QuestDetailTextSections
        quest={quest}
        phaseDocumentationSummary={summary}
        feedbackTarget={{ index: 101, requestId: 1 }}
      />,
    );

    await waitFor(() => expect(screen.getByTestId("quest-phase-documentation-timeline")).toBeInTheDocument());
  });
});

describe("quest machine stamps", () => {
  // A phase note and the final debrief show the machine they were written on,
  // since paths and commands in them refer to that machine.
  it("shows the machine next to a phase note's author and on the debrief", () => {
    const summary = longSummary();
    const stamped = { ...summary.groups[0]!.entries[0]!, machine: "devbox" };
    const groups = [{ ...summary.groups[0]!, entries: [stamped] }, ...summary.groups.slice(1)];
    const quest: QuestmasterTask = {
      id: "q-42-v1",
      questId: "q-42",
      version: 1,
      title: "Stamped notes",
      status: "done",
      description: "Done.",
      createdAt: 1,
      completedAt: 2,
      verificationItems: [],
      debrief: "Outcome.",
      debriefMachine: "laptop",
    };
    render(
      <QuestDetailTextSections
        quest={quest}
        phaseDocumentationSummary={{ ...summary, groups, scopedEntries: groups.flatMap((item) => item.entries) }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Earlier Journey run 1/ }));
    expect(screen.getAllByTestId("quest-machine-stamp").map((node) => node.textContent)).toEqual([
      "on laptop",
      "on devbox",
    ]);
  });
});
