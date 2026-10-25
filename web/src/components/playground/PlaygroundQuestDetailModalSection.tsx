import { useStore } from "../../store.js";
import { PlaygroundQuestLabelComparison } from "./PlaygroundQuestLabelComparison.js";
import { Card, Section } from "./shared.js";

export function PlaygroundQuestDetailModalSection() {
  return (
    <Section
      title="Quest Detail Modal"
      description="Global quest detail overlay with on-demand details, including Edit and Cancel."
    >
      <div className="max-w-3xl space-y-4">
        <Card label="Open quest detail modal">
          <div className="p-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openPlaygroundQuestDetail("q-42")}
                className="px-4 py-2 text-sm font-medium bg-cc-primary hover:bg-cc-primary-hover text-white rounded-lg transition-colors cursor-pointer"
              >
                Open Quest Detail Modal (q-42)
              </button>
              <button
                type="button"
                onClick={() => openPlaygroundQuestDetail("q-44")}
                className="px-4 py-2 text-sm font-medium border border-cc-border bg-cc-hover/30 text-cc-fg hover:bg-cc-hover/60 rounded-lg transition-colors cursor-pointer"
              >
                In-progress quest (q-44)
              </button>
            </div>
            <p className="text-xs text-cc-muted mt-2">
              Click to open a mock quest detail overlay: q-42 is done with feedback and two rounds, q-44 is in progress
              with none (Finish Quest and the empty feedback field). Press Escape or click the backdrop to close.
            </p>
          </div>
        </Card>
        <PlaygroundQuestLabelComparison />
      </div>
    </Section>
  );
}

function openPlaygroundQuestDetail(questId: "q-42" | "q-44") {
  const now = Date.now();
  const journeyRuns = buildPlaygroundJourneyRuns(now);
  useStore.setState({
    quests: [],
    questDetails: new Map([
      [
        "q-42",
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
          debrief: "The sidebar now scrolls inside a bounded wrapper on narrow screens.",
          debriefTldr: "Bounded, scrollable sidebar on narrow screens.",
          debriefMachine: "laptop",
          tags: ["ui", "mobile", "bug"],
          // Several backlinks collapse into one "Referenced by 4" chip in the quest view chip row.
          relatedQuests: ["q-43", "q-47", "q-48", "q-51"].map((questId) => ({
            questId,
            kind: "referenced_by" as const,
            explicit: false,
          })),
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
          // Reopened once: each Journey run shows as a round, with the second round's brief at its top.
          rounds: [
            {
              openedAt: now - 86400000,
              title: "Bounded scroll wrapper for the sidebar",
              closedAt: now - 5500000,
              outcome: "The sidebar scrolls inside a bounded wrapper on phones narrower than 375px.",
              outcomeTldr: "Bounded, scrollable sidebar on narrow phones.",
            },
            {
              openedAt: now - 5410000,
              title: "Landscape phones",
              brief: "Make the bounded sidebar work in **landscape** on phones, then land both rounds together.",
              requests: [27],
            },
          ],
          feedback: [
            ...buildPlaygroundPhaseFeedback(journeyRuns),
            // Unscoped feedback sits in the Journey timeline by time: inside a phase, between runs, after the Journey.
            {
              author: "human" as const,
              text: "Please also check iPad mini",
              ts: now - 7200000,
              addressed: true,
              authorSessionId: "abc-123",
            },
            {
              author: "human" as const,
              text: "User (after the first round): start a second round for **landscape** phones before landing.",
              ts: now - 5430000,
              addressed: true,
              authorSessionId: "playground-leader",
            },
            {
              author: "agent" as const,
              text: "Checked on iPad mini -- works correctly with the new wrapper.",
              ts: now - 1500000,
              authorSessionId: "abc-123",
              machine: "build-box",
            },
            {
              author: "human" as const,
              text: "Looks good! One more: the close button is hard to tap.",
              ts: now - 300000,
              addressed: false,
            },
          ],
        },
      ],
      [
        "q-44",
        {
          id: "q-44-v2",
          questId: "q-44",
          version: 2,
          title: "Keep the top bar clear after closing previews",
          status: "in_progress" as const,
          description:
            "The top bar stays blurred after a preview sheet closes. Find what leaves the blur and remove it.",
          tldr: "Remove the blur the top bar keeps after a preview sheet closes.",
          createdAt: now - 7200000,
          updatedAt: now - 600000,
          sessionId: "playground-worker",
          leaderSessionId: "playground-leader",
          claimedAt: now - 3600000,
          tags: ["ui", "bugfix"],
        },
      ],
    ]),
    sdkSessions: [
      {
        sessionId: "playground-worker",
        sessionNum: 2970,
        state: "connected",
        cwd: "/repo/takode",
        createdAt: now - 43200000,
        backendType: "codex",
        name: "Quest detail worker",
      },
      {
        sessionId: "playground-leader",
        sessionNum: 2851,
        state: "connected",
        cwd: "/repo/takode",
        createdAt: now - 7200000,
        backendType: "codex",
        isOrchestrator: true,
        name: "Quest detail leader",
      },
    ],
  });
  useStore.getState().openQuestOverlay(questId);
}

const PLAYGROUND_PHASE_CYCLE = ["alignment", "user-checkpoint", "work", "memory"] as const;

function buildPlaygroundJourneyRuns(now: number) {
  return [
    buildPlaygroundJourneyRun("playground-run-1", 1, 6, now - 9000000, 600000),
    buildPlaygroundJourneyRun("playground-run-2", 2, 20, now - 5400000, 240000),
  ];
}

function buildPlaygroundJourneyRun(
  runId: string,
  runOrdinal: number,
  phaseCount: number,
  createdAt: number,
  phaseDuration: number,
) {
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
      startedAt: createdAt + phaseIndex * phaseDuration,
      ...(phaseIndex === activeIndex ? {} : { completedAt: createdAt + (phaseIndex + 1) * phaseDuration }),
    })),
  };
}

function buildPlaygroundPhaseFeedback(journeyRuns: ReturnType<typeof buildPlaygroundJourneyRuns>) {
  return journeyRuns.flatMap((run, runIndex) =>
    run.phaseOccurrences.map((occurrence, occurrenceIndex) => ({
      author: "agent" as const,
      kind: "phase_summary" as const,
      text: `Playground long Journey detail for run ${runIndex + 1}, phase ${occurrence.phasePosition}.`,
      tldr: `Run ${runIndex + 1} phase ${occurrence.phasePosition} TLDR for collapsed Journey testing.`,
      ts: occurrence.startedAt + 30000,
      authorSessionId: "abc-123",
      // Alternate machines so the Playground shows notes stamped by different machines.
      machine: occurrenceIndex % 2 === 0 ? "laptop" : "build-box",
      journeyRunId: run.runId,
      phaseOccurrenceId: occurrence.occurrenceId,
      phaseId: occurrence.phaseId,
      phasePosition: occurrence.phasePosition,
      phaseOccurrence: occurrence.phaseOccurrence,
    })),
  );
}
