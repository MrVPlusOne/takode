import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUEST_JOURNEY_STATES } from "../../shared/quest-journey.js";
import type { BoardRow, SessionAttentionRecord } from "../session-types.js";
import {
  advanceBoardRow,
  completeDoneBoardRowsForQuestInAllSessions,
  getBoard,
  getCompletedBoard,
  getBoardStallSignature,
  pruneStaleBoardStalledHerdBatch,
  removeBoardRows,
  sweepBoardStallWarnings,
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
  state: Record<string, unknown>;
}

function createSession(): TestSession {
  return {
    id: "leader-1",
    board: new Map(),
    completedBoard: new Map(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    attentionRecords: [],
    state: {},
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

describe("Work Board row merge", () => {
  it("clears stale workerNum when worker changes without a resolved number", () => {
    // A worker ID and worker number must not silently describe different sessions.
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(session, { questId: "q-1452", worker: "worker-old", workerNum: 1950 }, deps);
    upsertBoardRow(session, { questId: "q-1452", worker: "worker-new" }, deps);

    expect(getBoard(session)[0]).toEqual(expect.objectContaining({ worker: "worker-new" }));
    expect(getBoard(session)[0]?.workerNum).toBeUndefined();
  });
});

describe("Work Board stale herd batch pruning", () => {
  it("drops board_dispatchable events when the queued row revision changed before delivery", () => {
    const session = createSession();
    const deps = {
      ...createDeps(),
      getLauncherSessionInfo: vi.fn(),
      getSession: vi.fn(),
      listSessions: vi.fn(() => []),
      resolveSessionId: vi.fn(),
      timerCount: vi.fn(() => 0),
      backendConnected: vi.fn(() => true),
      getBoard: vi.fn(() => Array.from(session.board.values())),
      getBoardRowsForQuest: vi.fn(() => []),
      getCompletedBoardRowsForQuest: vi.fn(() => []),
      emitTakodeEvent: vi.fn(),
      isSessionIdle: vi.fn(() => true),
    };

    upsertBoardRow(
      session,
      {
        questId: "q-77",
        title: "Queued transition",
        status: "QUEUED",
        waitFor: ["free-worker"],
        updatedAt: 100,
      },
      createDeps(),
    );
    upsertBoardRow(
      session,
      {
        questId: "q-77",
        title: "Queued transition",
        status: "PLANNING",
        worker: "worker-1",
        updatedAt: 200,
      },
      createDeps(),
    );

    const pruned = pruneStaleBoardStalledHerdBatch(
      session,
      {
        events: [
          {
            id: -1,
            event: "board_dispatchable",
            sessionId: "work-board",
            sessionNum: -1,
            sessionName: "Work Board",
            ts: 150,
            data: {
              questId: "q-77",
              signature: "q-77|dispatchable|free-worker|free-worker-capacity:0/0/5",
              rowUpdatedAt: 100,
              summary: "q-77 can be dispatched now.",
            },
          },
        ],
        renderedLines: ["Work Board | board_dispatchable | q-77 | q-77 can be dispatched now."],
      },
      deps as any,
    );

    expect(pruned).toEqual({ changed: true, suppressedReasonCode: "stale_board_state" });
  });
});

describe("Work Board stall occurrences", () => {
  it("gives a recovered-then-stalled row a fresh delivery identity", () => {
    const leader = createSession();
    const worker = { id: "worker-1", isGenerating: false, pendingPermissions: new Map() };
    leader.board.set("q-77", {
      questId: "q-77",
      title: "Recover and stall again",
      status: "WORKING",
      worker: worker.id,
      workerNum: 77,
      createdAt: 0,
      updatedAt: 0,
    });
    let workerLastActivityAt = 0;
    const emitted: Array<Record<string, unknown>> = [];
    const deps = {
      getLauncherSessionInfo: vi.fn((sessionId: string) =>
        sessionId === leader.id ? { isOrchestrator: true } : { sessionNum: 77, lastActivityAt: workerLastActivityAt },
      ),
      getSession: vi.fn((sessionId: string) => (sessionId === worker.id ? worker : undefined)),
      listSessions: vi.fn(() => [{ sessionId: worker.id, sessionNum: 77 }]),
      resolveSessionId: vi.fn(() => worker.id),
      timerCount: vi.fn(() => 0),
      backendConnected: vi.fn(() => true),
      getBoard: vi.fn(() => Array.from(leader.board.values())),
      emitTakodeEvent: vi.fn((_sessionId: string, _type: string, data: Record<string, unknown>) => emitted.push(data)),
      markNotificationDone: vi.fn(() => true),
      isSessionIdle: vi.fn(() => true),
    } as any;

    sweepBoardStallWarnings([leader], 0, deps);
    sweepBoardStallWarnings([leader], 180_001, deps);
    const firstSignature = emitted[0]?.signature;
    expect(firstSignature).toBe("q-77|WORKING|idle|since:0");
    expect(getBoardStallSignature(leader, "q-77", deps)).toBe(firstSignature);

    worker.isGenerating = true;
    sweepBoardStallWarnings([leader], 200_000, deps);
    worker.isGenerating = false;
    workerLastActivityAt = 210_000;
    sweepBoardStallWarnings([leader], 210_000, deps);
    sweepBoardStallWarnings([leader], 390_001, deps);

    expect(emitted[1]?.signature).toBe("q-77|WORKING|idle|since:210000");
    expect(emitted[1]?.signature).not.toBe(firstSignature);
  });
});

describe("Work Board leader thread tabs", () => {
  it("persists server-owned leader thread tabs when active board rows are created", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-9",
        title: "Keep active quest tab",
        status: "IMPLEMENTING",
      },
      deps,
    );

    expect((session.state.leaderOpenThreadTabs as any)?.orderedOpenThreadKeys).toEqual(["q-9"]);
    expect((session.state.leaderOpenThreadTabs as any)?.closedThreadTombstones).toEqual([]);
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("preserves board order when backfilling multiple active rows without saved tabs", () => {
    const session = createSession();
    const deps = createDeps();
    session.board.set("q-1", {
      questId: "q-1",
      title: "First active row",
      status: "IMPLEMENTING",
      createdAt: 100,
      updatedAt: 100,
    });
    session.board.set("q-2", {
      questId: "q-2",
      title: "Second active row",
      status: "CODE_REVIEWING",
      createdAt: 200,
      updatedAt: 200,
    });

    upsertBoardRow(
      session,
      {
        questId: "q-3",
        title: "Third active row",
        status: "EXECUTING",
        updatedAt: 300,
      },
      deps,
    );

    expect((session.state.leaderOpenThreadTabs as any)?.orderedOpenThreadKeys).toEqual(["q-1", "q-2", "q-3"]);
  });

  it("retains an active leader thread tab when the board row completes even if old sessions had no tab state", () => {
    const session = createSession();
    const deps = createDeps();
    session.board.set("q-9", {
      questId: "q-9",
      title: "Complete without browser-authored tab state",
      status: "MEMORY",
      createdAt: 100,
      updatedAt: 200,
    });

    removeBoardRows(session, ["q-9"], deps);

    expect(session.completedBoard.has("q-9")).toBe(true);
    expect((session.state.leaderOpenThreadTabs as any)?.orderedOpenThreadKeys).toEqual(["q-9"]);
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("resurfaces a queued row with a fresh activation event without weakening later closes", () => {
    // A queued row can be closed before it resumes. Its transition back to
    // active work is a new server candidate, while later active-phase edits are not.
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(session, { questId: "q-9", status: "QUEUED", updatedAt: 100 }, deps);
    session.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 200 }],
      updatedAt: 200,
    };

    upsertBoardRow(session, { questId: "q-9", status: "WORKING", updatedAt: 300 }, deps);

    expect(session.board.get("q-9")?.threadTabActivatedAt).toBe(300);
    expect(session.state.leaderOpenThreadTabs).toEqual({
      version: 1,
      orderedOpenThreadKeys: ["q-9"],
      closedThreadTombstones: [],
      updatedAt: 300,
    });

    session.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 400 }],
      updatedAt: 400,
    };
    upsertBoardRow(session, { questId: "q-9", status: "MEMORY", updatedAt: 500 }, deps);

    expect(session.board.get("q-9")?.threadTabActivatedAt).toBe(300);
    expect(session.state.leaderOpenThreadTabs).toEqual({
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 400 }],
      updatedAt: 400,
    });
  });

  it("resurfaces a queued row when board advance starts its first active phase", () => {
    // The advance primitive is a second production activation path and must use
    // the same fresh event semantics as an explicit board-set status change.
    const session = createSession();
    const deps = createDeps();
    const closedAt = Date.now() - 1;
    session.board.set("q-9", {
      questId: "q-9",
      status: "QUEUED",
      waitFor: ["free-worker"],
      createdAt: closedAt - 100,
      updatedAt: closedAt - 100,
    });
    session.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt }],
      updatedAt: closedAt,
    };

    const result = advanceBoardRow(session, "q-9", QUEST_JOURNEY_STATES, deps);

    expect(result && "newState" in result ? result.newState : undefined).toBe("PLANNING");
    expect(session.board.get("q-9")?.threadTabActivatedAt).toBeGreaterThan(closedAt);
    expect((session.state.leaderOpenThreadTabs as any)?.orderedOpenThreadKeys).toEqual(["q-9"]);
    expect((session.state.leaderOpenThreadTabs as any)?.closedThreadTombstones).toEqual([]);
  });

  it("does not revive a completed leader thread tab after an explicit close tombstone", () => {
    const session = createSession();
    const deps = createDeps();
    session.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 200 }],
      updatedAt: 200,
    };
    session.board.set("q-9", {
      questId: "q-9",
      title: "Closed before completion",
      status: "MEMORY",
      createdAt: 100,
      updatedAt: 150,
    });

    removeBoardRows(session, ["q-9"], deps);

    expect(session.completedBoard.has("q-9")).toBe(true);
    expect(session.state.leaderOpenThreadTabs).toEqual({
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-9", closedAt: 200 }],
      updatedAt: 200,
    });
  });
});

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
        journey: { phaseIds: ["alignment", "work", "memory"] },
      },
      deps,
    );

    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000 },
    });

    vi.setSystemTime(new Date(61_000));
    const advanced = advanceBoardRow(session, "q-1016", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "PLANNING", newState: "WORKING" }),
    );
    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "1": { startedAt: 61_000 },
    });

    vi.setSystemTime(new Date(181_000));
    const blocked = advanceBoardRow(session, "q-1016", QUEST_JOURNEY_STATES, deps);
    expect(blocked).toEqual(
      expect.objectContaining({ error: expect.stringContaining("work-to-memory"), previousState: "WORKING" }),
    );

    // Simulate the dedicated route after it has persisted Work commit evidence.
    upsertBoardRow(
      session,
      {
        questId: "q-1016",
        status: "MEMORY",
        journey: {
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 2,
          currentPhaseId: "memory",
        },
      },
      deps,
    );
    expect(getBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "1": { startedAt: 61_000, endedAt: 181_000 },
      "2": { startedAt: 181_000 },
    });

    vi.setSystemTime(new Date(241_000));
    const completed = advanceBoardRow(session, "q-1016", QUEST_JOURNEY_STATES, deps);

    expect(completed).toEqual(expect.objectContaining({ removed: true, previousState: "MEMORY" }));
    expect(getCompletedBoard(session)[0]?.completedAt).toBe(241_000);
    expect(getCompletedBoard(session)[0]?.journey?.phaseTimings).toEqual({
      "0": { startedAt: 1_000, endedAt: 61_000 },
      "1": { startedAt: 61_000, endedAt: 181_000 },
      "2": { startedAt: 181_000, endedAt: 241_000 },
    });
  });

  it("tracks repeated phases by phase position instead of phase id", () => {
    // Repeated Journey phases are separate occurrences; keying by position avoids
    // collapsing two Work phases into one timing bucket.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1017",
        status: "WORKING",
        journey: {
          phaseIds: ["work", "user-checkpoint", "work"],
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
        status: "WORKING",
        journey: {
          phaseIds: ["work", "user-checkpoint", "memory"],
          activePhaseIndex: 0,
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1040", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "WORKING", newState: "USER_CHECKPOINTING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 0,
      currentPhaseId: "work",
    });
  });

  it("enters an optional User Checkpoint unless the skip condition is explicitly satisfied", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1041",
        status: "WORKING",
        journey: {
          phaseIds: ["work", "user-checkpoint", "memory"],
          activePhaseIndex: 0,
          phaseNotes: {
            "1": "Optional: skip if Work confirms there is no user-visible tradeoff.",
          },
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1041", QUEST_JOURNEY_STATES, deps);

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "WORKING", newState: "USER_CHECKPOINTING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 0,
      currentPhaseId: "work",
    });
  });

  it("keeps optional checkpoint skipping from Work to a later Work occurrence", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1042",
        status: "WORKING",
        journey: {
          phaseIds: ["work", "user-checkpoint", "work", "memory"],
          activePhaseIndex: 0,
          phaseNotes: {
            "1": "Optional: skip if Work confirms there is no user-visible tradeoff.",
          },
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1042", QUEST_JOURNEY_STATES, deps, {
      skipOptionalUserCheckpointReason: "Work found no user-visible tradeoff.",
    });

    expect(advanced).toEqual(
      expect.objectContaining({ removed: false, previousState: "WORKING", newState: "WORKING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 2,
      currentPhaseId: "work",
      phaseSkipReasons: { "1": "Work found no user-visible tradeoff." },
    });
  });

  it("does not let optional-checkpoint skipping bypass the guarded Work transition", () => {
    const session = createSession();
    const deps = createDeps();

    upsertBoardRow(
      session,
      {
        questId: "q-1042",
        status: "WORKING",
        journey: {
          phaseIds: ["work", "user-checkpoint", "memory"],
          activePhaseIndex: 0,
          phaseNotes: {
            "1": "May be skipped if Work confirms there is no user-visible tradeoff.",
          },
        },
      },
      deps,
    );

    const advanced = advanceBoardRow(session, "q-1042", QUEST_JOURNEY_STATES, deps, {
      skipOptionalUserCheckpointReason: "Work found no user-visible tradeoff.",
    });

    expect(advanced).toEqual(
      expect.objectContaining({ error: expect.stringContaining("work-to-memory"), previousState: "WORKING" }),
    );
    expect(getBoard(session)[0]?.journey).toMatchObject({
      activePhaseIndex: 0,
      currentPhaseId: "work",
    });
    expect(getBoard(session)[0]?.journey?.phaseSkipReasons).toBeUndefined();
  });

  it("rebases the current open timing when a revision inserts a phase before the current phase", () => {
    // The old Work timing must move to the revised Work position; otherwise
    // the inserted checkpoint would display time the board never spent there.
    const session = createSession();
    const deps = createDeps();

    vi.setSystemTime(new Date(1_000));
    upsertBoardRow(
      session,
      {
        questId: "q-1018",
        status: "PLANNING",
        journey: { phaseIds: ["alignment", "work", "memory"] },
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
        status: "WORKING",
        journey: {
          phaseIds: ["alignment", "user-checkpoint", "work", "memory"],
          activePhaseIndex: 2,
          revisionReason: "Add a checkpoint before Work continues",
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
        status: "WORKING",
        journey: {
          phaseIds: ["alignment", "work", "user-checkpoint", "work"],
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
        status: "WORKING",
        journey: {
          phaseIds: ["alignment", "work", "user-checkpoint", "memory", "work"],
          activePhaseIndex: 4,
          revisionReason: "Add Memory before the repeated Work",
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
        questTldr: "Lifecycle chips should show the quest TLDR.",
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
      questTldr: "Lifecycle chips should show the quest TLDR.",
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
        phaseIds: ["alignment", "work", "memory"],
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
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 2,
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
