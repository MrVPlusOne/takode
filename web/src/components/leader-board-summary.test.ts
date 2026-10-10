import { describe, expect, it } from "vitest";
import type { BoardRowData } from "./BoardTable.js";
import { activeBoardPhaseDots, describeBoardPhaseDots } from "./leader-board-summary.js";

// The top-bar Board button draws one dot per board quest that is in a Journey phase.
describe("activeBoardPhaseDots", () => {
  it("gives a dot to quests in a Journey phase and none to queued or proposed quests", () => {
    const board: BoardRowData[] = [
      { questId: "q-1", status: "WORKING", updatedAt: 1 },
      { questId: "q-2", status: "QUEUED", updatedAt: 2, journey: { mode: "proposed", phaseIds: ["work", "memory"] } },
      { questId: "q-3", status: "PROPOSED", updatedAt: 3 },
      {
        questId: "q-4",
        status: "USER_CHECKPOINTING",
        updatedAt: 4,
        journey: {
          mode: "active",
          phaseIds: ["work", "user-checkpoint", "work", "memory"],
          currentPhaseId: "user-checkpoint",
          activePhaseIndex: 1,
        },
      },
      {
        questId: "q-5",
        status: "LANDING",
        updatedAt: 5,
        journey: {
          mode: "active",
          phaseIds: ["work", "memory", "landing"],
          currentPhaseId: "landing",
          activePhaseIndex: 2,
        },
      },
    ];

    const dots = activeBoardPhaseDots(board);

    expect(dots.map((dot) => [dot.questId, dot.phase.id])).toEqual([
      ["q-5", "landing"],
      ["q-4", "user-checkpoint"],
      ["q-1", "work"],
    ]);
  });

  it("describes the dots with a count and phase breakdown for the tooltip and accessible label", () => {
    const board: BoardRowData[] = [
      { questId: "q-1", status: "WORKING", updatedAt: 1 },
      { questId: "q-2", status: "WORKING", updatedAt: 2 },
      { questId: "q-3", status: "MEMORY", updatedAt: 3 },
    ];

    expect(describeBoardPhaseDots(activeBoardPhaseDots(board))).toBe("3 active (1 Memory, 2 Work)");
    expect(describeBoardPhaseDots([])).toBe("nothing active");
  });
});
