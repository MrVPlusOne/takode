import { describe, expect, it } from "vitest";
import type { BoardRow } from "../session-types.js";
import {
  AUTO_CHECKPOINT_REOPEN_WINDOW_MS,
  addLeaderQuestionToBoardRow,
  endUserCheckpointByHand,
  findUserCheckpointQuestsForWorker,
  isWorkAfterAutomaticCheckpoint,
  removeResolvedQuestionFromBoardRow,
  restorePlannedCheckpointLeftOpen,
} from "./board-user-checkpoint.js";

// Automatic User Checkpoints: a quest in Work enters User Checkpoint while its leader has a blocking
// question to the user open, and returns to Work for the same worker once every such question is resolved.

const T0 = 1_000_000;

function workingRow(phaseIds: NonNullable<BoardRow["journey"]>["phaseIds"], activePhaseIndex = 0): BoardRow {
  return {
    questId: "q-1",
    worker: "worker-1",
    status: "WORKING",
    createdAt: 1,
    updatedAt: 1,
    journey: {
      mode: "active",
      phaseIds,
      activePhaseIndex,
      currentPhaseId: "work",
      phaseTimings: { [String(activePhaseIndex)]: { startedAt: T0 - 60_000 } },
    },
  };
}

describe("automatic User Checkpoint", () => {
  it("adds a checkpoint and a later Work after the current Work, with its own timing", () => {
    // A blocking question pauses Work: the Journey gains [User Checkpoint, Work] after the current
    // Work, the row waits in the new checkpoint, and Work time stops when the question is asked.
    const row = workingRow(["work", "memory"]);
    row.journey!.phaseNotes = { "1": "Memory note" };

    addLeaderQuestionToBoardRow(row, "n-3", { blocking: true, now: T0 });

    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.waitForInput).toEqual(["n-3"]);
    expect(row.autoCheckpoint).toEqual({ checkpointIndex: 1 });
    expect(row.journey).toMatchObject({
      phaseIds: ["work", "user-checkpoint", "work", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "user-checkpoint",
      revisionCount: 1,
      phaseTimings: { "0": { startedAt: T0 - 60_000, endedAt: T0 }, "1": { startedAt: T0 } },
    });
    // The later Memory note moves with its phase.
    expect(row.journey!.phaseNotes!["3"]).toBe("Memory note");
    expect(row.journey!.phaseNotes!["1"]).toContain("Added by Takode");
  });

  it("keeps one checkpoint for further questions and resumes the same worker's Work after the last answer", () => {
    const row = workingRow(["work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-3", { blocking: true, now: T0 });
    addLeaderQuestionToBoardRow(row, "n-4", { blocking: true, now: T0 + 1000 });

    expect(row.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    expect(row.waitForInput).toEqual(["n-3", "n-4"]);

    removeResolvedQuestionFromBoardRow(row, "n-3", T0 + 2000);
    expect(row.status).toBe("USER_CHECKPOINTING");

    removeResolvedQuestionFromBoardRow(row, "n-4", T0 + 5000);
    expect(row.status).toBe("WORKING");
    expect(row.worker).toBe("worker-1");
    expect(row.waitForInput).toBeUndefined();
    expect(row.autoCheckpoint).toEqual({ checkpointIndex: 1, resumedAt: T0 + 5000 });
    expect(row.journey).toMatchObject({
      activePhaseIndex: 2,
      currentPhaseId: "work",
      phaseTimings: { "1": { startedAt: T0, endedAt: T0 + 5000 }, "2": { startedAt: T0 + 5000 } },
    });
    expect(isWorkAfterAutomaticCheckpoint(row)).toBe(true);
  });

  it("reopens the same checkpoint for a question soon after resuming, but not after real Work", () => {
    // Back-and-forth with the user stays one checkpoint: the short Work stretch becomes checkpoint time.
    const row = workingRow(["work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-3", { blocking: true, now: T0 });
    removeResolvedQuestionFromBoardRow(row, "n-3", T0 + 5000);
    addLeaderQuestionToBoardRow(row, "n-5", { blocking: true, now: T0 + 65_000 });

    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    expect(row.journey!.activePhaseIndex).toBe(1);
    expect(row.journey!.phaseTimings).toEqual({
      "0": { startedAt: T0 - 60_000, endedAt: T0 },
      "1": { startedAt: T0 },
    });

    removeResolvedQuestionFromBoardRow(row, "n-5", T0 + 70_000);
    const lateQuestionAt = T0 + 70_000 + AUTO_CHECKPOINT_REOPEN_WINDOW_MS + 1;
    addLeaderQuestionToBoardRow(row, "n-6", { blocking: true, now: lateQuestionAt });

    expect(row.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"]);
    expect(row.journey!.activePhaseIndex).toBe(3);
    expect(row.autoCheckpoint).toEqual({ checkpointIndex: 3 });
  });

  it("takes a planned next checkpoint without adding one and leaves its resumption to the leader", () => {
    const row = workingRow(["work", "user-checkpoint", "work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-2", { blocking: true, now: T0 });

    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    expect(row.journey!.activePhaseIndex).toBe(1);
    expect(row.autoCheckpoint).toBeUndefined();

    removeResolvedQuestionFromBoardRow(row, "n-2", T0 + 1000);
    expect(row.status).toBe("USER_CHECKPOINTING");
    expect(row.waitForInput).toBeUndefined();
  });

  it("adds a later Work when a planned checkpoint is followed directly by Memory", () => {
    const row = workingRow(["work", "user-checkpoint", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-2", { blocking: true, now: T0 });

    expect(row.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    expect(row.journey!.activePhaseIndex).toBe(1);
  });

  it("keeps non-blocking questions open without pausing Work, and drops them once resolved", () => {
    const row = workingRow(["work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-7", { blocking: false, now: T0 });

    expect(row.status).toBe("WORKING");
    expect(row.openQuestions).toEqual(["n-7"]);
    expect(row.journey!.phaseIds).toEqual(["work", "memory"]);

    removeResolvedQuestionFromBoardRow(row, "n-7", T0 + 1000);
    expect(row.openQuestions).toBeUndefined();
  });

  it("does not pause rows outside Work; their questions stay open", () => {
    const row = workingRow(["work", "memory"], 1);
    row.status = "MEMORY";
    row.journey!.currentPhaseId = "memory";
    addLeaderQuestionToBoardRow(row, "n-8", { blocking: true, now: T0 });

    expect(row.status).toBe("MEMORY");
    expect(row.waitForInput).toBeUndefined();
    expect(row.openQuestions).toEqual(["n-8"]);
  });

  it("ends a checkpoint by hand with its questions still open but no longer blocking", () => {
    const row = workingRow(["work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-3", { blocking: true, now: T0 });

    expect(endUserCheckpointByHand(row)).toBe(2);
    expect(row.waitForInput).toBeUndefined();
    expect(row.openQuestions).toEqual(["n-3"]);
    // A manual end does not reopen the checkpoint for the next question.
    expect(row.autoCheckpoint).toEqual({ checkpointIndex: 1 });
  });

  it("ends a planned checkpoint by hand into the Work after it, keeping its questions open", () => {
    const row = workingRow(["work", "user-checkpoint", "work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-2", { blocking: true, now: T0 });

    expect(endUserCheckpointByHand(row)).toBe(2);
    expect(row.waitForInput).toBeUndefined();
    expect(row.openQuestions).toEqual(["n-2"]);
    expect(row.autoCheckpoint).toBeUndefined();
  });

  // A planned checkpoint left while its questions are still open is not used up: the pause is
  // relabeled as one Takode added and the planned checkpoint goes back after the resumed Work.
  describe("restoring a planned checkpoint left with open questions", () => {
    function plannedCheckpointWithQuestion(): BoardRow {
      const row = workingRow(["work", "user-checkpoint", "work", "memory"]);
      row.journey!.phaseNotes = { "1": "Final approval of the redesign", "3": "Memory note" };
      addLeaderQuestionToBoardRow(row, "n-2", { blocking: true, now: T0 });
      return row;
    }

    it("puts the planned checkpoint and its note back after the Work a hand end resumes", () => {
      const before = plannedCheckpointWithQuestion();
      // The board's hand end: questions kept open, the row resumes the Work after the checkpoint.
      const after = structuredClone(before);
      endUserCheckpointByHand(after);
      after.status = "WORKING";
      after.journey = { ...after.journey!, activePhaseIndex: 2, currentPhaseId: "work" };

      expect(restorePlannedCheckpointLeftOpen(before, after, T0 + 1000)).toBe(true);

      expect(after.status).toBe("WORKING");
      expect(after.openQuestions).toEqual(["n-2"]);
      expect(after.journey).toMatchObject({
        phaseIds: ["work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"],
        activePhaseIndex: 2,
        currentPhaseId: "work",
        revisionReason: expect.stringContaining("put the planned User Checkpoint back"),
      });
      expect(after.journey!.phaseNotes).toEqual({
        "1": expect.stringContaining("Added by Takode"),
        "3": "Final approval of the redesign",
        "5": "Memory note",
      });
      // The pause now counts as a checkpoint Takode added, ended by hand, so it does not reopen.
      expect(after.autoCheckpoint).toEqual({ checkpointIndex: 1 });
    });

    it("resumes Work and restores the planned checkpoint when its last links are dropped", () => {
      const before = plannedCheckpointWithQuestion();
      const after = structuredClone(before);
      after.waitForInput = undefined;
      after.openQuestions = ["n-2"];

      expect(restorePlannedCheckpointLeftOpen(before, after, T0 + 1000)).toBe(true);

      expect(after.status).toBe("WORKING");
      expect(after.journey).toMatchObject({
        phaseIds: ["work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"],
        activePhaseIndex: 2,
        phaseTimings: { "1": { startedAt: T0, endedAt: T0 + 1000 }, "2": { startedAt: T0 + 1000 } },
      });
      expect(isWorkAfterAutomaticCheckpoint(after)).toBe(true);
    });

    it("leaves the planned checkpoint used up when its questions were resolved", () => {
      const before = plannedCheckpointWithQuestion();
      removeResolvedQuestionFromBoardRow(before, "n-2", T0 + 1000);
      const after = structuredClone(before);
      after.status = "WORKING";
      after.journey = { ...after.journey!, activePhaseIndex: 2, currentPhaseId: "work" };

      expect(restorePlannedCheckpointLeftOpen(before, after, T0 + 2000)).toBe(false);
      expect(after.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    });

    it("leaves a checkpoint Takode added alone", () => {
      const before = workingRow(["work", "memory"]);
      addLeaderQuestionToBoardRow(before, "n-3", { blocking: true, now: T0 });
      const after = structuredClone(before);
      endUserCheckpointByHand(after);
      after.status = "WORKING";
      after.journey = { ...after.journey!, activePhaseIndex: 2, currentPhaseId: "work" };

      expect(restorePlannedCheckpointLeftOpen(before, after, T0 + 1000)).toBe(false);
      expect(after.journey!.phaseIds).toEqual(["work", "user-checkpoint", "work", "memory"]);
    });
  });

  it("names the quests that hold a worker in a User Checkpoint", () => {
    const row = workingRow(["work", "memory"]);
    addLeaderQuestionToBoardRow(row, "n-3", { blocking: true, now: T0 });
    const boards = [{ board: new Map([[row.questId, row]]) }];

    expect(findUserCheckpointQuestsForWorker(boards, "worker-1")).toEqual(["q-1"]);
    expect(findUserCheckpointQuestsForWorker(boards, "worker-2")).toEqual([]);
  });
});
