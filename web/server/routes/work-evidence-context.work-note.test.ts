import { describe, expect, it } from "vitest";
import type { QuestFeedbackEntry, QuestmasterTask } from "../quest-types.js";
import { resolveCurrentWorkFeedback } from "./work-evidence-context.js";

// Work -> Memory accepts only the worker's own phase-summary note in the active
// Work occurrence. When a named note is refused, the error must say which rule
// it broke: a bare "not the current Work phase note by this worker" once sent a
// worker and its leader hunting for a missing session when the note was really a
// worker-stream report (kind phase_finding) edited into the final Work note.

const scope = { journeyRunId: "board-leader-1-100", phaseOccurrenceId: "board-leader-1-100:p2" };
const longText = "Final Work note with enough detail to stand as the handoff record for this occurrence.";

function note(overrides: Partial<QuestFeedbackEntry> = {}): QuestFeedbackEntry {
  return {
    author: "agent",
    authorSessionId: "worker-1",
    kind: "phase_summary",
    phaseId: "work",
    journeyRunId: scope.journeyRunId,
    phaseOccurrenceId: scope.phaseOccurrenceId,
    text: longText,
    ts: 1,
    ...overrides,
  };
}

function resolve(feedback: QuestFeedbackEntry[], requestedIndex?: number, withRunSnapshot = true) {
  const quest = {
    questId: "q-7",
    feedback,
    ...(withRunSnapshot ? { journeyRuns: [{ runId: scope.journeyRunId, phaseOccurrences: [] }] } : {}),
  } as unknown as QuestmasterTask;
  return resolveCurrentWorkFeedback({ quest, authorSessionId: "worker-1", activeScope: scope, requestedIndex });
}

describe("resolveCurrentWorkFeedback", () => {
  it("accepts the worker's own phase-summary note, named or found", () => {
    expect(resolve([note()], 0)).toEqual({ index: 0 });
    expect(resolve([note(), note({ kind: undefined })])).toEqual({ index: 1 });
  });

  it("names the rule a requested note breaks", () => {
    // Each case breaks exactly one rule, so the reason identifies that rule.
    const cases: Array<[Partial<QuestFeedbackEntry>, string]> = [
      [{ kind: "phase_finding" }, "is a phase_finding note, as takode worker-stream reports are"],
      [{ kind: "review" }, "is a review note"],
      [{ authorSessionId: undefined }, "has no author session"],
      [{ authorSessionId: "worker-2" }, "was written by another session"],
      [{ author: "human" }, "is human feedback"],
      [{ phaseId: "memory" }, "belongs to the memory phase, not Work"],
      [{ phaseId: undefined }, "is not attached to the Work phase"],
      [{ text: "Too short." }, "is shorter than 80 characters"],
      [{ phaseOccurrenceId: "board-leader-1-100:p1" }, "belongs to an earlier Work occurrence"],
    ];
    for (const [overrides, reason] of cases) {
      const result = resolve([note(overrides)], 0);
      expect(result).toEqual({ error: expect.stringContaining(`Feedback #0 can't be the Work note: it ${reason}`) });
      expect(result).toEqual({ error: expect.stringContaining("quest feedback add q-7 --kind phase-summary") });
    }
  });

  it("reports a missing or deleted note as such", () => {
    expect(resolve([note({ deletedAt: 2 })], 0)).toEqual({
      error: expect.stringContaining("it does not exist or was deleted"),
    });
    expect(resolve([note()], 3)).toEqual({ error: expect.stringContaining("it does not exist or was deleted") });
  });

  it("skips ineligible notes when no index is named", () => {
    expect(resolve([note(), note({ kind: "phase_finding" })])).toEqual({ index: 0 });
    expect(resolve([note({ kind: "phase_finding" })])).toEqual({
      error: expect.stringContaining("A Work phase note for the active Journey run"),
    });
  });

  it("accepts unscoped legacy notes only when the run has no snapshot", () => {
    const legacy = note({ journeyRunId: undefined, phaseOccurrenceId: undefined });
    expect(resolve([legacy], 0, false)).toEqual({ index: 0 });
    expect(resolve([legacy], 0, true)).toEqual({
      error: expect.stringContaining("belongs to an earlier Work occurrence"),
    });
  });
});
