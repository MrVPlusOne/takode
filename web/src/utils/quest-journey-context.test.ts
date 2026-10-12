import { describe, expect, it } from "vitest";
import type { QuestmasterTask, SdkSessionInfo } from "../types.js";
import {
  buildQuestJourneyContextByQuestId,
  findQuestJourneyContext,
  resolveQuestSessionTargets,
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

describe("quest session targets", () => {
  const workingRow: QuestJourneyBoardRow = {
    questId: "q-95",
    status: "WORKING",
    worker: "worker-95",
    workerNum: 95,
    journey: { mode: "active", phaseIds: ["work", "memory"], currentPhaseId: "work", activePhaseIndex: 0 },
  };

  it("finds the leader of a dispatched quest whose worker has not claimed it yet", () => {
    // A quest records its leader only when the worker claims it. Between dispatch and claim it has
    // neither owner nor leader, so the leader comes from the board that holds the row, which once
    // made Open Thread say "No leader session for this quest".
    const unclaimed = quest({ status: "refined" });
    const context = findQuestJourneyContext(unclaimed, new Map([["leader-95", [workingRow]]]), new Map(), new Map());

    expect(resolveQuestSessionTargets(unclaimed, context, [])).toEqual({
      workerSessionId: "worker-95",
      workerStatus: "idle",
      leaderSessionId: "leader-95",
    });
  });

  it("falls back to the Journey run's leader, then to the board worker's herding leader", () => {
    const withRun = quest({
      journeyRuns: [
        {
          runId: "run-95",
          leaderSessionId: "run-leader-95",
          workerSessionId: "worker-95",
          source: "board",
          phaseIds: ["work", "memory"],
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          phaseOccurrences: [],
        },
      ],
    });
    const runContext = findQuestJourneyContext(withRun, new Map(), new Map(), new Map());
    expect(resolveQuestSessionTargets(withRun, runContext, []).leaderSessionId).toBe("run-leader-95");

    // Without a known board or run leader (a context built by hand), the worker's herdedBy decides.
    const herded = [{ sessionId: "worker-95", herdedBy: "herding-leader-95" }] as SdkSessionInfo[];
    expect(
      resolveQuestSessionTargets(quest({ status: "refined" }), { row: workingRow, completed: false }, herded),
    ).toMatchObject({ workerSessionId: "worker-95", leaderSessionId: "herding-leader-95" });
  });

  it("keeps the recorded leader and owner when there is no board row", () => {
    const claimed = quest({ sessionId: "owner-95", leaderSessionId: "recorded-leader-95" } as Partial<QuestmasterTask>);
    expect(resolveQuestSessionTargets(claimed, null, [])).toEqual({
      workerSessionId: "owner-95",
      leaderSessionId: "recorded-leader-95",
    });
  });
});
