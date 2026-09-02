import { describe, expect, it } from "vitest";
import {
  selectQuestPreviewProgressTldr,
  summarizeQuestPhaseDocumentation,
} from "./quest-phase-documentation-summary.js";
import type { QuestJourneyRun, QuestmasterTask } from "../server/quest-types.js";

const baseQuest = {
  id: "q-1-v1",
  questId: "q-1",
  version: 1,
  title: "Document phases",
  createdAt: 1,
  status: "refined",
  description: "Make phase documentation easy to scan.",
} satisfies QuestmasterTask;

function run(overrides: Partial<QuestJourneyRun> = {}): QuestJourneyRun {
  return {
    runId: "run-1",
    source: "board",
    phaseIds: ["alignment", "implement", "code-review", "implement"],
    status: "completed",
    createdAt: 10,
    updatedAt: 20,
    phaseOccurrences: [
      {
        occurrenceId: "run-1:p1",
        phaseId: "alignment",
        phaseIndex: 0,
        phasePosition: 1,
        phaseOccurrence: 1,
        status: "completed",
      },
      {
        occurrenceId: "run-1:p2",
        phaseId: "implement",
        phaseIndex: 1,
        phasePosition: 2,
        phaseOccurrence: 1,
        status: "completed",
      },
      {
        occurrenceId: "run-1:p3",
        phaseId: "code-review",
        phaseIndex: 2,
        phasePosition: 3,
        phaseOccurrence: 1,
        status: "completed",
      },
      {
        occurrenceId: "run-1:p4",
        phaseId: "implement",
        phaseIndex: 3,
        phasePosition: 4,
        phaseOccurrence: 2,
        status: "completed",
      },
    ],
    ...overrides,
  };
}

describe("summarizeQuestPhaseDocumentation", () => {
  it("preserves legacy flat feedback as unscoped feedback", () => {
    const summary = summarizeQuestPhaseDocumentation({
      ...baseQuest,
      feedback: [{ author: "agent", text: "Explore findings without phase metadata.", ts: 30 }],
    });

    expect(summary.hasJourneyRuns).toBe(false);
    expect(summary.hasPhaseDocumentation).toBe(false);
    expect(summary.groups).toHaveLength(0);
    expect(summary.unscopedFeedback).toHaveLength(1);
    expect(summary.unscopedFeedback[0]).toMatchObject({ index: 0, text: "Explore findings without phase metadata." });
  });

  it("groups scoped documentation by durable phase occurrence and preserves TLDR plus full detail", () => {
    const summary = summarizeQuestPhaseDocumentation({
      ...baseQuest,
      tldr: "Quest scan summary.",
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          kind: "phase_summary",
          text: "Full implementation detail.",
          tldr: "Implementation TLDR.",
          ts: 30,
          phaseOccurrenceId: "run-1:p2",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 2,
          phaseOccurrence: 1,
        },
      ],
    });

    const implementGroup = summary.groups.find((group) => group.phaseOccurrenceId === "run-1:p2");
    expect(summary.questTldr).toBe("Quest scan summary.");
    expect(summary.hasPhaseDocumentation).toBe(true);
    expect(implementGroup).toMatchObject({
      displayLabel: "Implement",
      metaLabel: "phase 2",
      scopeMatched: true,
    });
    expect(implementGroup?.entries[0]).toMatchObject({
      index: 0,
      tldr: "Implementation TLDR.",
      text: "Full implementation detail.",
    });
  });

  it("labels repeated phases distinctly", () => {
    const summary = summarizeQuestPhaseDocumentation({
      ...baseQuest,
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Second implementation pass.",
          tldr: "Second implement TLDR.",
          ts: 30,
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    const repeatedGroup = summary.groups.find((group) => group.phasePosition === 4);
    expect(repeatedGroup).toMatchObject({
      displayLabel: "Implement #2",
      phaseOccurrence: 2,
      phaseOccurrenceId: "run-1:p4",
    });
    expect(repeatedGroup?.entries).toHaveLength(1);
  });

  it("does not present stale active occurrences as active after the run is finished", () => {
    const summary = summarizeQuestPhaseDocumentation({
      ...baseQuest,
      status: "done",
      journeyRuns: [
        run({
          status: "completed",
          completedAt: 300,
          phaseOccurrences: [
            {
              occurrenceId: "run-1:p1",
              phaseId: "alignment",
              phaseIndex: 0,
              phasePosition: 1,
              phaseOccurrence: 1,
              status: "completed",
              startedAt: 100,
              completedAt: 200,
            },
            {
              occurrenceId: "run-1:p2",
              phaseId: "implement",
              phaseIndex: 1,
              phasePosition: 2,
              phaseOccurrence: 1,
              status: "active",
              startedAt: 200,
            },
          ],
        }),
      ],
      feedback: [
        {
          author: "agent",
          text: "Final implementation summary.",
          tldr: "Final implementation TLDR.",
          ts: 310,
          journeyRunId: "run-1",
          phaseOccurrenceId: "run-1:p2",
          phaseId: "implement",
          phasePosition: 2,
        },
      ],
    });

    const staleActiveGroup = summary.groups.find((group) => group.phaseOccurrenceId === "run-1:p2");
    expect(staleActiveGroup).toMatchObject({
      displayLabel: "Implement",
      phaseStatus: "completed",
      startedAt: 200,
    });
    expect(staleActiveGroup?.completedAt).toBeUndefined();
  });

  it("keeps stale or ambiguous scoped entries visible without attaching them to a run occurrence", () => {
    const summary = summarizeQuestPhaseDocumentation({
      ...baseQuest,
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Could belong to either implement occurrence.",
          tldr: "Ambiguous implement TLDR.",
          ts: 30,
          phaseId: "implement",
        },
        {
          author: "agent",
          text: "References a removed occurrence.",
          tldr: "Stale occurrence TLDR.",
          ts: 40,
          phaseOccurrenceId: "run-1:p99",
          journeyRunId: "run-1",
          phaseId: "code-review",
          phasePosition: 99,
        },
      ],
    });

    const unmatchedGroups = summary.groups.filter((group) => !group.scopeMatched);
    expect(unmatchedGroups).toHaveLength(2);
    expect(unmatchedGroups.map((group) => group.displayLabel)).toEqual(
      expect.arrayContaining(["Implement", "Code Review"]),
    );
    expect(unmatchedGroups.map((group) => group.metaLabel)).toEqual(
      expect.arrayContaining(["scope unmatched", "phase 99 / scope unmatched"]),
    );
  });
});

describe("selectQuestPreviewProgressTldr", () => {
  it("uses the latest phase documentation TLDR according to existing phase summary ordering", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "in_progress",
      sessionId: "worker-1",
      claimedAt: 30,
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Alignment detail.",
          tldr: "Alignment TLDR.",
          ts: 40,
          phaseOccurrenceId: "run-1:p1",
          journeyRunId: "run-1",
          phaseId: "alignment",
          phasePosition: 1,
        },
        {
          author: "agent",
          text: "Second implementation detail.",
          tldr: "Second implementation TLDR.",
          ts: 50,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    expect(preview).toEqual({
      kind: "phase",
      label: "Latest Phase",
      phaseLabel: "Implement #2",
      metaLabel: "phase 4",
      text: "Second implementation TLDR.",
    });
  });

  it("requires explicit TLDR metadata for phase preview progress", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "in_progress",
      sessionId: "worker-1",
      claimedAt: 30,
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Earlier phase has a TLDR.",
          tldr: "Earlier TLDR.",
          ts: 40,
          phaseOccurrenceId: "run-1:p1",
          journeyRunId: "run-1",
          phaseId: "alignment",
          phasePosition: 1,
        },
        {
          author: "agent",
          text: "Latest phase detail without TLDR should not be copied into compact preview.",
          ts: 50,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    expect(preview).toBeNull();
  });

  it("prefers final debrief TLDR for completed non-cancelled quests", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "done",
      completedAt: 80,
      verificationItems: [],
      debrief: "Final outcome detail.",
      debriefTldr: "Final outcome TLDR.",
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Implementation detail.",
          tldr: "Implementation TLDR.",
          ts: 50,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    expect(preview).toEqual({
      kind: "debrief",
      label: "Final Debrief",
      text: "Final outcome TLDR.",
    });
  });

  it("omits completed progress preview when a completed quest has no debrief TLDR", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "done",
      completedAt: 80,
      verificationItems: [],
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Implementation detail.",
          tldr: "Implementation TLDR.",
          ts: 50,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    expect(preview).toBeNull();
  });

  it("omits cancelled completed quest preview progress instead of falling back to stale phase TLDR", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "done",
      completedAt: 80,
      verificationItems: [],
      cancelled: true,
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Cancelled implementation detail should not appear as current progress.",
          tldr: "Stale implementation TLDR.",
          ts: 50,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
          phaseOccurrence: 2,
        },
      ],
    });

    expect(preview).toBeNull();
  });
});

describe("Quest Outcome preview priority", () => {
  it("prefers the current Outcome summary over active phase documentation", () => {
    const preview = selectQuestPreviewProgressTldr({
      ...baseQuest,
      status: "in_progress",
      sessionId: "worker-1",
      claimedAt: 30,
      outcome: {
        currentRevisionId: "r1",
        revisions: [
          {
            revisionId: "r1",
            markdown: "Detailed current outcome.",
            summaryMarkdown: "Current outcome summary.",
            summarySource: "derived",
            contentHash: "hash",
            createdAt: 50,
            actor: { kind: "human" },
            sources: [],
          },
        ],
      },
      journeyRuns: [run()],
      feedback: [
        {
          author: "agent",
          text: "Work detail.",
          tldr: "Work phase TLDR.",
          ts: 40,
          phaseOccurrenceId: "run-1:p4",
          journeyRunId: "run-1",
          phaseId: "implement",
          phasePosition: 4,
        },
      ],
    });

    expect(preview).toEqual({ kind: "outcome", label: "Current Outcome", text: "Current outcome summary." });
  });

  it("falls back to the debrief when a completed full Outcome is not exactly sealed", () => {
    const outcome = {
      currentRevisionId: "r2",
      revisions: [
        {
          revisionId: "r2",
          markdown: "Unsealed draft detail.",
          summaryMarkdown: "Unsealed draft summary.",
          summarySource: "derived" as const,
          contentHash: "hash-r2",
          createdAt: 50,
          actor: { kind: "human" as const },
          sources: [],
        },
      ],
    };
    const quest = {
      ...baseQuest,
      status: "done" as const,
      completedAt: 80,
      verificationItems: [],
      debriefTldr: "Trusted final debrief.",
      outcome,
    };

    // A partial or corrupt completion must not advertise an active draft as delivered.
    expect(selectQuestPreviewProgressTldr(quest)).toEqual({
      kind: "debrief",
      label: "Final Debrief",
      text: "Trusted final debrief.",
    });
    expect(
      selectQuestPreviewProgressTldr({
        ...quest,
        outcome: { ...outcome, finalizedRevisionId: "r1" },
      }),
    ).toEqual({ kind: "debrief", label: "Final Debrief", text: "Trusted final debrief." });
    expect(
      selectQuestPreviewProgressTldr({
        ...quest,
        outcome: { ...outcome, finalizedRevisionId: "r2" },
      }),
    ).toEqual({ kind: "outcome", label: "Outcome", text: "Unsealed draft summary." });
  });

  it("requires bounded completed previews to prove the current revision is sealed", () => {
    const preview = {
      preview: true as const,
      id: "q-2",
      questId: "q-2",
      version: 2,
      title: "Completed preview",
      status: "done" as const,
      createdAt: 1,
      completedAt: 20,
      debriefTldr: "Trusted bounded debrief.",
      outcomePreview: {
        currentRevisionId: "r2",
        summaryMarkdown: "Unsealed bounded draft.",
        updatedAt: 10,
        revisionCount: 2,
      },
    };

    // Compact data has no full revision graph, so the exact finalized pointer is required.
    expect(selectQuestPreviewProgressTldr(preview)).toEqual({
      kind: "debrief",
      label: "Final Debrief",
      text: "Trusted bounded debrief.",
    });
    expect(
      selectQuestPreviewProgressTldr({
        ...preview,
        outcomePreview: { ...preview.outcomePreview, finalizedRevisionId: "r1" },
      }),
    ).toEqual({ kind: "debrief", label: "Final Debrief", text: "Trusted bounded debrief." });
    expect(
      selectQuestPreviewProgressTldr({
        ...preview,
        outcomePreview: { ...preview.outcomePreview, finalizedRevisionId: "r2" },
      }),
    ).toEqual({ kind: "outcome", label: "Outcome", text: "Unsealed bounded draft." });
  });

  it("uses bounded Outcome preview data and labels reopened work as previous", () => {
    const preview = selectQuestPreviewProgressTldr({
      preview: true,
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Preview",
      status: "in_progress",
      createdAt: 1,
      outcomePreview: {
        currentRevisionId: "r1",
        summaryMarkdown: "Previous finalized result.",
        updatedAt: 10,
        revisionCount: 1,
        reopenedAt: 20,
      },
    });

    expect(preview).toEqual({ kind: "outcome", label: "Previous Outcome", text: "Previous finalized result." });
  });
});
