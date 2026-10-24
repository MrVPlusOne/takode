import { describe, expect, it } from "vitest";
import type {
  IndexedQuestFeedbackEntry,
  QuestPhaseDocumentationGroup,
} from "../../shared/quest-phase-documentation-summary.js";
import { placeUnscopedFeedback } from "./quest-journey-feedback-placement.js";

function phase(
  key: string,
  runId: string,
  startedAt: number | undefined,
  options: { completedAt?: number; status?: QuestPhaseDocumentationGroup["phaseStatus"]; noteTimes?: number[] } = {},
): QuestPhaseDocumentationGroup {
  return {
    key,
    phaseLabel: key,
    displayLabel: key,
    metaLabel: "",
    phaseStatus: options.status ?? "completed",
    journeyRunId: runId,
    ...(startedAt !== undefined ? { startedAt } : {}),
    ...(options.completedAt !== undefined ? { completedAt: options.completedAt } : {}),
    scopeMatched: true,
    entries: (options.noteTimes ?? []).map((ts, i) => ({ index: 900 + i, author: "agent", text: "note", ts })),
  };
}

function feedback(index: number, ts: number): IndexedQuestFeedbackEntry {
  return { index, author: "human", text: `feedback ${index}`, ts };
}

function placedKeys(groups: QuestPhaseDocumentationGroup[], entries: IndexedQuestFeedbackEntry[]) {
  const placement = placeUnscopedFeedback(groups, entries);
  return {
    byGroup: Object.fromEntries([...placement.byGroupKey].map(([key, list]) => [key, list.map((e) => e.index)])),
    outside: placement.outside.map((e) => e.index),
  };
}

describe("placeUnscopedFeedback", () => {
  it("puts feedback in the latest phase that started at or before it", () => {
    // Shaped like a Work -> User Checkpoint -> Work run: the user's pick, written just before the
    // checkpoint ends, belongs to the checkpoint, and later feedback belongs to the second Work.
    const groups = [
      phase("work-1", "run-1", 100, { completedAt: 200 }),
      phase("checkpoint", "run-1", 200, { completedAt: 300 }),
      phase("work-2", "run-1", 300, { status: "active" }),
    ];
    expect(placedKeys(groups, [feedback(1, 150), feedback(2, 299), feedback(3, 400)])).toEqual({
      byGroup: { "work-1": [1], checkpoint: [2], "work-2": [3] },
      outside: [],
    });
  });

  it("keeps feedback written between runs outside both runs, even when an older run still claims to be active", () => {
    // Older runs often keep a stale "active" final phase; only recorded activity bounds them.
    const groups = [
      phase("run-1-work", "run-1", 100, { completedAt: 200 }),
      phase("run-1-memory", "run-1", 200, { status: "active", noteTimes: [250] }),
      phase("run-2-work", "run-2", 400, { completedAt: 500 }),
    ];
    expect(placedKeys(groups, [feedback(1, 50), feedback(2, 240), feedback(3, 390), feedback(4, 600)])).toEqual({
      byGroup: { "run-1-memory": [2] },
      outside: [1, 3, 4],
    });
  });

  it("keeps the latest run open while its last phase is active", () => {
    const groups = [phase("work", "run-1", 100, { status: "active" })];
    expect(placedKeys(groups, [feedback(1, 10_000)])).toEqual({ byGroup: { work: [1] }, outside: [] });
  });

  it("leaves feedback outside when no phase has a start time", () => {
    const groups = [phase("legacy", "run-1", undefined, { noteTimes: [5] })];
    expect(placedKeys(groups, [feedback(2, 5), feedback(1, 3)])).toEqual({ byGroup: {}, outside: [1, 2] });
  });
});
