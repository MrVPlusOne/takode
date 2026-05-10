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
        createdAt: Date.now() - 86400000,
        updatedAt: Date.now() - 3600000,
        sessionId: "playground-worker",
        leaderSessionId: "playground-leader",
        previousOwnerSessionIds: ["abc-123"],
        claimedAt: Date.now() - 43200000,
        completedAt: Date.now() - 3600000,
        tags: ["ui", "mobile", "bug"],
        verificationItems: [
          { text: "Sidebar does not overflow on iPhone SE", checked: true },
          { text: "Scroll works on sidebar content", checked: false },
          { text: "Desktop layout unaffected", checked: true },
        ],
        journeyRuns: [
          {
            runId: "playground-run-1",
            source: "board" as const,
            phaseIds: ["alignment", "implement", "code-review"],
            status: "completed" as const,
            createdAt: Date.now() - 7200000,
            updatedAt: Date.now() - 3600000,
            phaseOccurrences: [
              {
                occurrenceId: "playground-run-1:p1",
                phaseId: "alignment" as const,
                phaseIndex: 0,
                phasePosition: 1,
                phaseOccurrence: 1,
                status: "completed" as const,
              },
              {
                occurrenceId: "playground-run-1:p2",
                phaseId: "implement" as const,
                phaseIndex: 1,
                phasePosition: 2,
                phaseOccurrence: 1,
                status: "completed" as const,
              },
              {
                occurrenceId: "playground-run-1:p3",
                phaseId: "code-review" as const,
                phaseIndex: 2,
                phasePosition: 3,
                phaseOccurrence: 1,
                status: "completed" as const,
              },
            ],
          },
        ],
        feedback: [
          {
            author: "agent" as const,
            kind: "phase_summary" as const,
            text: "Implemented the responsive wrapper in [QuestDetailPanel.tsx:42](file:web/src/components/QuestDetailPanel.tsx:42) and verified that the sidebar content scrolls independently on narrow screens.",
            tldr: "Implemented the narrow-screen wrapper in [QuestDetailPanel](web/src/components/QuestDetailPanel.tsx#L42).",
            ts: Date.now() - 5400000,
            authorSessionId: "abc-123",
            journeyRunId: "playground-run-1",
            phaseOccurrenceId: "playground-run-1:p2",
            phaseId: "implement" as const,
            phasePosition: 2,
          },
          {
            author: "human" as const,
            text: "Please also check iPad mini",
            ts: Date.now() - 7200000,
            addressed: true,
          },
          {
            author: "agent" as const,
            text: "Checked on iPad mini -- works correctly with the new wrapper.",
            ts: Date.now() - 3600000,
            authorSessionId: "abc-123",
          },
          {
            author: "human" as const,
            text: "Looks good! One more: the close button is hard to tap.",
            ts: Date.now() - 1800000,
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
        createdAt: Date.now() - 43200000,
        backendType: "codex",
      },
      {
        sessionId: "playground-leader",
        sessionNum: 141,
        state: "connected",
        cwd: "/repo/takode",
        createdAt: Date.now() - 7200000,
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
