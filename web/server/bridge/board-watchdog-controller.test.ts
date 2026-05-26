import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEST_JOURNEY_STATES } from "../../shared/quest-journey.js";
import type { BoardRow, SessionAttentionRecord } from "../session-types.js";
import {
  advanceBoardRow,
  completeDoneBoardRowsForQuestInAllSessions,
  getBoard,
  getCompletedBoard,
  upsertBoardRow,
  type WorkBoardStateDeps,
} from "./board-watchdog-controller.js";

interface TestSession {
  id: string;
  board: Map<string, BoardRow>;
  completedBoard: Map<string, BoardRow>;
  boardDispatchStates: Map<string, unknown>;
  boardStallStates: Map<string, unknown>;
  attentionRecords: SessionAttentionRecord[];
}

function createSession(): TestSession {
  return {
    id: "leader-1",
    board: new Map(),
    completedBoard: new Map(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    attentionRecords: [],
  };
}

function createDeps(): WorkBoardStateDeps {
  return {
    getBoardDispatchableSignature: () => null,
    markNotificationDone: () => true,
    broadcastBoard: vi.fn(),
    broadcastAttentionRecords: vi.fn(),
    persistSession: vi.fn(),
    notifyReview: vi.fn(),
  };
}

describe("Quest Journey board phase timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts the active phase on upsert, closes it on advance, and persists timing on completion", () => {
    // Phase timing is stored on the board row Journey so normal session persistence
    // keeps it across server restarts without a separate migration path.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1016",
        status: "PLANNING",
        journey: { phaseIds: ["alignment", "implement"] },
      },
      deps,
    );

    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000 },
    });

    vi.setSystemTime(new Date(61_000));
    const advanced = advanceBoardRow(session, "q-1016", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "PLANNING", newState: "IMPLEMENTING" }),
    );
    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "1": { startedAt: 61_000 },
    });

    vi.setSystemTime(new Date(181_000));
    const completed = advanceBoardRow(session, "q-1016", QUEST_JOURNEY_STATES, deps);

    expect(completed).toEqual(expect.objectContaining({ removed: true, previousState: "IMPLEMENTING" }));
    expect(getCompletedBoard(session)[0]?.completedAt).toBe(181_000);
    expect(getCompletedBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "1": { startedAt: 61_000, endedAt: 181_000 },
    });
  });

  it("tracks repeated phases by phase position instead of phase id", () => {
    // Repeated Journey phases are separate occurrences; keying by position avoids
    // collapsing two Implement phases into one timing bucket.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1017",
        status: "IMPLEMENTING",
        journey: {
          phaseIds: ["implement", "code-review", "implement"],
          activePhaseIndex: 0,
        },
      },
      deps,
    );

    vi.setSystemTime(new Date(11_000));
    advanceBoardRow(session, "q-1017", QUEST_JOURNEY_STATES, deps);
    vi.setSystemTime(new Date(21_000));
    advanceBoardRow(session, "q-1017", QUEST_JOURNEY_STATES, deps);

    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 11_000 },
      "1": { startedAt: 11_000, endedAt: 21_000 },
      "2": { startedAt: 21_000 },
    });
  });

  it("advances into User Checkpoint by default", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1040",
        status: "EXPLORING",
        journey: {
          phaseIds: ["explore", "user-checkpoint", "implement"],
          activePhaseIndex: 0,
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1040", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "EXPLORING", newState: "USER_CHECKPOINTING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 1,
      currentPhaseId: "user-checkpoint",
    });
  });

  it("enters an optional User Checkpoint unless the skip condition is explicitly satisfied", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1041",
        status: "EXPLORING",
        journey: {
          phaseIds: ["explore", "user-checkpoint", "implement"],
          activePhaseIndex: 0,
          phaseNotes: {
            "1": "Optional: skip if Explore confirms implementation has no user-visible tradeoff.",
          },
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1041", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "EXPLORING", newState: "USER_CHECKPOINTING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 1,
      currentPhaseId: "user-checkpoint",
    });
  });

  it("records the satisfied skip condition when skipping an optional User Checkpoint", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1042",
        status: "EXPLORING",
        journey: {
          phaseIds: ["explore", "user-checkpoint", "implement"],
          activePhaseIndex: 0,
          phaseNotes: {
            "1": "May be skipped if Explore confirms implementation has no user-visible tradeoff.",
          },
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1042", QUEST_JOURNEY_STATES, deps, {
      skipOptionalUserCheckpointReason: "Explore found no user-visible tradeoff.",
    });

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "EXPLORING", newState: "IMPLEMENTING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 2,
      currentPhaseId: "implement",
      phaseSkipReasons: {
        "1": "Explore found no user-visible tradeoff.",
      },
    });
  });

  it("rebases the current open timing when a revision inserts a phase before the current phase", () => {
    // The old Implement timing must move to the revised Implement position;
    // otherwise the inserted Explore phase would display time the board never spent there.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1018",
        status: "PLANNING",
        journey: { phaseIds: ["alignment", "implement", "code-review"] },
      },
      deps,
    );
    vi.setSystemTime(new Date(61_000));
    advanceBoardRow(session, "q-1018", QUEST_JOURNEY_STATES, deps);

    vi.setSystemTime(new Date(181_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1018",
        status: "IMPLEMENTING",
        journey: {
          phaseIds: ["alignment", "explore", "implement", "code-review"],
          activePhaseIndex: 2,
          revisionReason: "Add Explore before review",
        },
      },
      deps,
    );

    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "2": { startedAt: 61_000 },
    });
  });

  it("drops ambiguous repeated-phase current timing on phase-plan revision", () => {
    // If repeated phases make the current occurrence identity ambiguous, start
    // timing from the revision boundary instead of reusing stale precise history.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1019",
        status: "IMPLEMENTING",
        journey: {
          phaseIds: ["alignment", "implement", "code-review", "implement"],
          activePhaseIndex: 3,
        },
      },
      deps,
    );

    vi.setSystemTime(new Date(11_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1019",
        status: "IMPLEMENTING",
        journey: {
          phaseIds: ["alignment", "implement", "code-review", "explore", "implement"],
          activePhaseIndex: 4,
          revisionReason: "Add Explore before the repeated Implement",
        },
      },
      deps,
    );

    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "4": { startedAt: 11_000 },
    });
  });

  it("records a Journey start once when a row first enters an active run", () => {
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1033",
        title: "Show Journey lifecycle chips",
        status: "PLANNING",
        journey: { phaseIds: ["alignment", "implement"] },
      },
      deps,
    );
    upsertBoardRow(
      session,
      {
        questId: "q-1033",
        title: "Show Journey lifecycle chips",
        status: "IMPLEMENTING",
      },
      deps,
    );

    expect(session.attentionRecords).toHaveLength(1);
    expect(session.attentionRecords[0]).toMatchObject({
      type: "quest_journey_started",
      questId: "q-1033",
      threadKey: "q-1033",
      title: "Journey started",
      summary: "Show Journey lifecycle chips",
      state: "resolved",
      createdAt: 1_000,
      route: { threadKey: "q-1033", questId: "q-1033" },
    });
    expect(deps.broadcastAttentionRecords).toHaveBeenCalledTimes(1);
  });

  it("records Journey start when a proposed row is promoted but not while it is only proposed", () => {
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1034",
        title: "Promote proposed Journey",
        status: "PROPOSED",
        journey: { mode: "proposed", phaseIds: ["alignment", "implement"] },
      },
      deps,
    );
    expect(session.attentionRecords).toHaveLength(0);

    vi.setSystemTime(new Date(2_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1034",
        status: "PLANNING",
        journey: { mode: "active", phaseIds: ["alignment", "implement"], activePhaseIndex: 0 },
      },
      deps,
    );

    expect(session.attentionRecords).toHaveLength(1);
    expect(session.attentionRecords[0]).toMatchObject({
      type: "quest_journey_started",
      questId: "q-1034",
      createdAt: 2_000,
    });
  });

  it("records a fresh Journey start for a repeated run after completion", () => {
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1035",
        title: "Repeated Journey",
        status: "PLANNING",
        journey: { phaseIds: ["alignment"] },
      },
      deps,
    );
    vi.setSystemTime(new Date(2_000));
    advanceBoardRow(session, "q-1035", QUEST_JOURNEY_STATES, deps);
    vi.setSystemTime(new Date(3_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1035",
        title: "Repeated Journey",
        status: "PLANNING",
        journey: { phaseIds: ["alignment"] },
      },
      deps,
    );

    expect(session.attentionRecords.filter((record) => record.type === "quest_journey_started")).toHaveLength(2);
    expect(session.attentionRecords.map((record) => record.type)).toEqual([
      "quest_journey_started",
      "quest_completed_recent",
      "quest_journey_started",
    ]);
  });

  it("records Journey finish rows with quest-thread routes when board rows complete", () => {
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1036",
        title: "Finish compact lifecycle cards",
        status: "PLANNING",
        journey: { phaseIds: ["alignment"] },
      },
      deps,
    );
    vi.setSystemTime(new Date(2_000));
    advanceBoardRow(session, "q-1036", QUEST_JOURNEY_STATES, deps);

    expect(session.attentionRecords.at(-1)).toMatchObject({
      type: "quest_completed_recent",
      questId: "q-1036",
      threadKey: "q-1036",
      title: "Journey finished",
      summary: "Finish compact lifecycle cards",
      actionLabel: "Open",
      priority: "review",
      state: "unresolved",
      createdAt: 2_000,
      route: { threadKey: "q-1036", questId: "q-1036" },
    });
    expect(deps.notifyReview).toHaveBeenCalledWith(
      "leader-1",
      "q-1036 ready for review: Finish compact lifecycle cards",
    );
  });
});

describe("done quest board reconciliation", () => {
  it("moves active Memory rows for completed quests out of the active board", () => {
    const session = createSession();
    const deps = createDeps();
    session.board.set("q-1430", {
      questId: "q-1430",
      title: "Completed Memory quest",
      status: "MEMORY",
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "implement", "memory"],
        activePhaseIndex: 2,
        currentPhaseId: "memory",
        phaseTimings: {
          "2": { startedAt: 2 },
        },
      },
    });
    session.board.set("q-1431", {
      questId: "q-1431",
      title: "Unfinished Memory quest",
      status: "MEMORY",
      createdAt: 3,
      updatedAt: 4,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "memory",
      },
    });

    const touched = completeDoneBoardRowsForQuestInAllSessions(new Map([[session.id, session]]), "q-1430", deps);

    expect(touched).toEqual(["leader-1"]);
    expect(getBoard(session).map((row) => row.questId)).toEqual(["q-1431"]);
    expect(getCompletedBoard(session)).toEqual([
      expect.objectContaining({
        questId: "q-1430",
        status: "MEMORY",
        completedAt: expect.any(Number),
        journey: expect.objectContaining({
          phaseTimings: expect.objectContaining({
            "2": expect.objectContaining({ endedAt: expect.any(Number) }),
          }),
        }),
      }),
    ]);
    expect(deps.broadcastBoard).toHaveBeenCalledWith(
      session,
      [expect.objectContaining({ questId: "q-1431" })],
      [expect.objectContaining({ questId: "q-1430" })],
    );
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(deps.notifyReview).not.toHaveBeenCalled();
  });

  it("preserves active Memory rows that have not been reconciled as done", () => {
    const session = createSession();
    const deps = createDeps();
    session.board.set("q-1431", {
      questId: "q-1431",
      title: "Unfinished Memory quest",
      status: "MEMORY",
      createdAt: 1,
      updatedAt: 2,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "memory",
      },
    });

    const touched = completeDoneBoardRowsForQuestInAllSessions(new Map([[session.id, session]]), "q-9999", deps);

    expect(touched).toEqual([]);
    expect(getBoard(session)).toEqual([expect.objectContaining({ questId: "q-1431", status: "MEMORY" })]);
    expect(getCompletedBoard(session)).toEqual([]);
    expect(deps.broadcastBoard).not.toHaveBeenCalled();
  });
});
