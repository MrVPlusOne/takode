import { describe, expect, it } from "vitest";
import type { QuestInProgress } from "./quest-types.js";
import { grepQuests } from "./quest-grep.js";
import { buildQuestListPreview } from "./quest-list-filters.js";
import { normalizeLiveQuest } from "./quest-store-normalize.js";
import { selectQuestPreviewProgressTldr } from "../shared/quest-phase-documentation-summary.js";

function quest(outcome: unknown): QuestInProgress {
  return {
    id: "q-1",
    questId: "q-1",
    version: 2,
    title: "Legacy outcome compatibility",
    tldr: "Current quest metadata.",
    description: "Current description.",
    status: "in_progress",
    sessionId: "worker-1",
    claimedAt: 1,
    createdAt: 1,
    outcome,
  };
}

describe("opaque legacy Quest Outcome behavior", () => {
  it("keeps arbitrary shipped data during live normalization", () => {
    const outcome = { future: { fields: ["remain", 42] }, revisions: "not-an-array" };
    const normalized = normalizeLiveQuest(quest(outcome));

    expect(normalized.outcome).toBe(outcome);
  });

  it("does not expose legacy content in bounded quest previews", () => {
    const preview = buildQuestListPreview(
      quest({ currentRevisionId: "r1", revisions: [{ revisionId: "r1", summaryMarkdown: "Legacy secret" }] }),
    );

    expect(preview).not.toHaveProperty("outcomePreview");
    expect(JSON.stringify(preview)).not.toContain("Legacy secret");
  });

  it("does not rank or return legacy content in quest search", () => {
    const result = grepQuests(
      [quest({ currentRevisionId: "r1", revisions: [{ markdown: "legacy-only-needle" }] })],
      "legacy-only-needle",
    );

    expect(result.totalMatches).toBe(0);
  });

  it("uses phase documentation rather than legacy Outcome as active preview authority", () => {
    const withPhase = {
      ...quest({ currentRevisionId: "r1", revisions: [{ summaryMarkdown: "Rejected summary" }] }),
      feedback: [
        {
          author: "agent" as const,
          text: "Detailed Work result.",
          tldr: "Current Work result.",
          ts: 10,
          phaseId: "work" as const,
          phasePosition: 1,
          phaseOccurrence: 1,
          kind: "phase_summary" as const,
        },
      ],
      journeyRuns: [
        {
          runId: "run-1",
          source: "board" as const,
          phaseIds: ["work" as const],
          status: "active" as const,
          createdAt: 1,
          updatedAt: 1,
          phaseOccurrences: [
            {
              occurrenceId: "work-1",
              phaseId: "work" as const,
              phaseIndex: 0,
              phasePosition: 1,
              phaseOccurrence: 1,
              status: "active" as const,
              startedAt: 1,
            },
          ],
        },
      ],
    };

    expect(selectQuestPreviewProgressTldr(withPhase)).toMatchObject({
      kind: "phase",
      text: "Current Work result.",
    });
  });

  it("uses the explicit final debrief for completed previews", () => {
    const completed = {
      ...quest({ currentRevisionId: "r1", revisions: [{ summaryMarkdown: "Rejected summary" }] }),
      status: "done" as const,
      sessionId: undefined,
      claimedAt: undefined,
      completedAt: 20,
      verificationItems: [],
      debrief: "Trusted final debrief.",
      debriefTldr: "Trusted final TLDR.",
    };

    expect(selectQuestPreviewProgressTldr(completed)).toEqual({
      kind: "debrief",
      label: "Final Debrief",
      text: "Trusted final TLDR.",
    });
  });
});
