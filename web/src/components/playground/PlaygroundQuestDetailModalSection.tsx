import { useStore } from "../../store.js";
import { Card, Section } from "./shared.js";

export function PlaygroundQuestDetailModalSection() {
  return (
    <Section
      title="Quest Detail Modal"
      description="Global read-only quest detail overlay triggered from quest links in boards or markdown."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Open quest detail modal">
          <div className="p-3">
            <button
              type="button"
              onClick={openPlaygroundQuestDetail}
              className="px-4 py-2 text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg transition-colors cursor-pointer"
            >
              Open Quest Detail Modal (q-42)
            </button>
            <p className="text-xs text-cc-muted mt-2">
              Click to open a mock quest detail overlay. Press Escape or click the backdrop to close.
            </p>
          </div>
        </Card>
      </div>
    </Section>
  );
}

function openPlaygroundQuestDetail() {
  const now = Date.now();
  const journeyRuns = buildPlaygroundJourneyRuns(now);
  useStore.setState({
    quests: [
      {
        id: "q-42-v3",
        questId: "q-42",
        version: 3,
        title: "Fix mobile sidebar overflow on small screens",
        status: "done" as const,
        description:
          "The sidebar overflows on screens narrower than 375px. Need to add `overflow-hidden` and a scrollable wrapper.\n\n## Steps\n1. Add wrapper div\n2. Set max-height\n3. Test on iPhone SE",
        createdAt: now - 86400000,
        updatedAt: now - 3600000,
        sessionId: "playground-worker",
        leaderSessionId: "playground-leader",
        previousOwnerSessionIds: ["abc-123"],
        claimedAt: now - 43200000,
        completedAt: now - 3600000,
        commitShas: ["82a3f2b71d4c9000", "7d2c332e9b5a1000"],
        memoryCommitShas: ["eedb2db46f8a7000"],
        tags: ["ui", "mobile", "bug"],
        verificationItems: [
          { text: "Sidebar does not overflow on iPhone SE", checked: true },
          { text: "Scroll works on sidebar content", checked: false },
          { text: "Desktop layout unaffected", checked: true },
        ],
        quizItems: [
          {
            id: "q-42-mobile-failure",
            question: "What layout failure did this quest fix?",
            answer:
              "The mobile sidebar could exceed the viewport on narrow screens, so the fix added a bounded scroll container around sidebar content.",
            source: "Final debrief",
          },
          {
            id: "q-42-validation",
            question: "Which validation matters most before accepting this fix?",
            answer:
              "Inspect a narrow mobile viewport and a desktop viewport so the fix is proven responsive without regressing the normal layout.",
            source: "Verification items",
          },
        ],
        journeyRuns,
        feedback: [
          ...buildPlaygroundPhaseFeedback(journeyRuns, now),
          {
            author: "human" as const,
            text: "Please also check iPad mini",
            ts: now - 7200000,
            addressed: true,
            authorSessionId: "abc-123",
          },
          {
            author: "agent" as const,
            text: "Checked on iPad mini -- works correctly with the new wrapper.",
            ts: now - 3600000,
            authorSessionId: "abc-123",
          },
          {
            author: "human" as const,
            text: "Looks good! One more: the close button is hard to tap.",
            ts: now - 1800000,
            addressed: false,
          },
        ],
      },
    ],
    sdkSessions: [
      {
        sessionId: "playground-worker",
        sessionNum: 142,
        state: "connected",
        cwd: "/repo/takode",
        createdAt: now - 43200000,
        backendType: "codex",
      },
      {
        sessionId: "playground-leader",
        sessionNum: 141,
        state: "connected",
        cwd: "/repo/takode",
        createdAt: now - 7200000,
        backendType: "codex",
        isOrchestrator: true,
      },
    ],
    sessionNames: new Map([
      ["playground-worker", "Quest detail worker"],
      ["playground-leader", "Quest detail leader"],
    ]),
  });
  useStore.getState().openQuestOverlay("q-42");
}

const PLAYGROUND_PHASE_CYCLE = ["alignment", "user-checkpoint", "work", "memory"] as const;

function buildPlaygroundJourneyRuns(now: number) {
  return [
    buildPlaygroundJourneyRun("playground-run-1", 1, 6, now - 9000000),
    buildPlaygroundJourneyRun("playground-run-2", 2, 20, now - 5400000),
  ];
}

function buildPlaygroundJourneyRun(runId: string, runOrdinal: number, phaseCount: number, createdAt: number) {
  const phaseIds = Array.from(
    { length: phaseCount },
    (_, index) => PLAYGROUND_PHASE_CYCLE[index % PLAYGROUND_PHASE_CYCLE.length],
  );
  const activeIndex = runOrdinal === 2 ? 9 : phaseCount - 1;
  return {
    runId,
    source: "board" as const,
    phaseIds,
    status: "active" as const,
    createdAt,
    updatedAt: createdAt + phaseCount * 60000,
    phaseOccurrences: phaseIds.map((phaseId, phaseIndex) => ({
      occurrenceId: `${runId}:p${phaseIndex + 1}`,
      phaseId,
      phaseIndex,
      phasePosition: phaseIndex + 1,
      phaseOccurrence: phaseIds.slice(0, phaseIndex + 1).filter((candidate) => candidate === phaseId).length,
      status: phaseIndex === activeIndex ? ("active" as const) : ("completed" as const),
    })),
  };
}

function buildPlaygroundPhaseFeedback(journeyRuns: ReturnType<typeof buildPlaygroundJourneyRuns>, now: number) {
  return journeyRuns.flatMap((run, runIndex) =>
    run.phaseOccurrences.map((occurrence, occurrenceIndex) => ({
      author: "agent" as const,
      kind: "phase_summary" as const,
      text: `Playground long Journey detail for run ${runIndex + 1}, phase ${occurrence.phasePosition}.`,
      tldr: `Run ${runIndex + 1} phase ${occurrence.phasePosition} TLDR for collapsed Journey testing.`,
      ts: now - 5400000 + runIndex * 120000 + occurrenceIndex * 1000,
      authorSessionId: "abc-123",
      journeyRunId: run.runId,
      phaseOccurrenceId: occurrence.occurrenceId,
      phaseId: occurrence.phaseId,
      phasePosition: occurrence.phasePosition,
      phaseOccurrence: occurrence.phaseOccurrence,
    })),
  );
}
