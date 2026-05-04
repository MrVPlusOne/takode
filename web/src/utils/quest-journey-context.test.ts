import { describe, expect, it } from "vitest";
import type { QuestmasterTask } from "../types.js";
import {
  buildQuestJourneyContextByQuestId,
  findQuestJourneyContext,
  type QuestJourneyBoardRow,
} from "./quest-journey-context.js";

function quest(overrides: Partial<QuestmasterTask> = {}): QuestmasterTask {
  return {
    id: "q-95-v1",
    questId: "q-95",
    version: 1,
    title: "Repeated Journey quest",
    status: "in_progress",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as QuestmasterTask;
}

describe("quest journey context selection", () => {
  it("prefers active board context over completed Journey history for current-status surfaces", () => {
    // Shared quest hover/status surfaces must not let a prior completed row
    // override the current active Journey for the same quest id.
    const activeRow: QuestJourneyBoardRow = {
      questId: "q-95",
      status: "USER_CHECKPOINTING",
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "explore", "user-checkpoint", "implement"],
        currentPhaseId: "user-checkpoint" as const,
        activePhaseIndex: 2,
      },
    };
    const completedRow: QuestJourneyBoardRow = {
      questId: "q-95",
      status: "PORTING",
      completedAt: 10,
      journey: {
        mode: "active" as const,
        phaseIds: ["alignment", "implement", "code-review", "port"],
        currentPhaseId: "port" as const,
        activePhaseIndex: 3,
      },
    };

    const context = findQuestJourneyContext(
      quest(),
      new Map([["leader-95", [activeRow]]]),
      new Map([["leader-95", [completedRow]]]),
      new Map(),
    );
    const contexts = buildQuestJourneyContextByQuestId(
      [quest()],
      new Map([["leader-95", [activeRow]]]),
      new Map([["leader-95", [completedRow]]]),
    );

    expect(context).toMatchObject({
      completed: false,
      row: { status: "USER_CHECKPOINTING", journey: { currentPhaseId: "user-checkpoint", activePhaseIndex: 2 } },
    });
    expect(contexts.get("q-95")).toMatchObject({
      completed: false,
      row: { status: "USER_CHECKPOINTING", journey: { currentPhaseId: "user-checkpoint", activePhaseIndex: 2 } },
    });
  });

  it("uses the latest active persisted Journey run when no board row is available", () => {
    const context = findQuestJourneyContext(
      quest({
        journeyRuns: [
          {
            runId: "older-port",
            source: "board",
            phaseIds: ["alignment", "implement", "code-review", "port"],
            status: "active",
            createdAt: 1,
            updatedAt: 10,
            phaseOccurrences: [
              {
                occurrenceId: "older-port:p4",
                phaseId: "port",
                phaseIndex: 3,
                phasePosition: 4,
                phaseOccurrence: 1,
                status: "active",
                boardState: "PORTING",
              },
            ],
          },
          {
            runId: "newer-checkpoint",
            source: "board",
            phaseIds: ["alignment", "explore", "user-checkpoint", "implement"],
            status: "active",
            createdAt: 2,
            updatedAt: 20,
            phaseOccurrences: [
              {
                occurrenceId: "newer-checkpoint:p3",
                phaseId: "user-checkpoint",
                phaseIndex: 2,
                phasePosition: 3,
                phaseOccurrence: 1,
                status: "active",
                boardState: "USER_CHECKPOINTING",
              },
            ],
          },
        ],
      }),
      new Map(),
      new Map(),
      new Map(),
    );

    expect(context).toMatchObject({
      completed: false,
      row: { status: "USER_CHECKPOINTING", journey: { currentPhaseId: "user-checkpoint", activePhaseIndex: 2 } },
    });
  });
});
