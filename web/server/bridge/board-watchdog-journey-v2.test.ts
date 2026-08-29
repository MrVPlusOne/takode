import { describe, expect, it } from "vitest";
import { DEFAULT_QUEST_JOURNEY_PHASE_IDS, QUEST_JOURNEY_STATES } from "../../shared/quest-journey.js";
import type { BoardRow } from "../session-types.js";
import { advanceBoardRow, upsertBoardRow } from "./board-watchdog-controller.js";

const workBoardStateDeps = {
  getBoardDispatchableSignature: () => null,
  markNotificationDone: () => false,
  broadcastBoard: () => undefined,
  persistSession: () => undefined,
  notifyReview: () => undefined,
};

type TestSession = {
  id: string;
  board: Map<string, BoardRow>;
  completedBoard: Map<string, BoardRow>;
  boardDispatchStates: Map<string, unknown>;
  boardStallStates: Map<string, unknown>;
  notifications: unknown[];
  notificationCounter: number;
};

function makeSession(): TestSession {
  return {
    id: "s1",
    board: new Map<string, BoardRow>(),
    completedBoard: new Map<string, BoardRow>(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
    notifications: [],
    notificationCounter: 0,
  };
}

function upsert(session: TestSession, row: Partial<BoardRow> & { questId: string }): BoardRow[] {
  return upsertBoardRow(session as never, row, workBoardStateDeps);
}

function advance(session: TestSession, questId: string) {
  return advanceBoardRow(session as never, questId, QUEST_JOURNEY_STATES, workBoardStateDeps);
}

function expectSuccess(result: ReturnType<typeof advance>) {
  expect(result).not.toHaveProperty("error");
  return result as Extract<ReturnType<typeof advance>, { board: BoardRow[] }>;
}

describe("board watchdog v2 Journey progression", () => {
  it("requires the guarded worker transition at the built-in Work boundary", () => {
    const session = makeSession();
    upsert(session, { questId: "q-1", status: "QUEUED" });

    expect(advance(session, "q-1")).toMatchObject({
      previousState: "QUEUED",
      newState: "PLANNING",
      removed: false,
    });
    expect(advance(session, "q-1")).toMatchObject({
      previousState: "PLANNING",
      newState: "WORKING",
      removed: false,
    });
    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("work-to-memory"),
      previousState: "WORKING",
    });

    // The dedicated route records code evidence first, then performs this low-level upsert.
    upsert(session, {
      questId: "q-1",
      status: "MEMORY",
      journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 2, currentPhaseId: "memory" },
    });
    expect(advance(session, "q-1")).toMatchObject({
      removed: true,
      previousState: "MEMORY",
      board: [],
    });
  });

  it("initializes default phase bookkeeping for the built-in v2 Work Quest Journey", () => {
    const session = makeSession();

    upsert(session, { questId: "q-1", status: "PLANNING" });

    expect(session.board.get("q-1")).toEqual(
      expect.objectContaining({
        status: "PLANNING",
        journey: expect.objectContaining({
          presetId: "v2-work",
          phaseIds: DEFAULT_QUEST_JOURNEY_PHASE_IDS,
          currentPhaseId: "alignment",
          nextLeaderAction: expect.stringContaining("alignment leader brief"),
        }),
      }),
    );
  });

  it("follows a custom planned v2 phase sequence", () => {
    const session = makeSession();
    upsert(session, {
      questId: "q-1",
      status: "PLANNING",
      journey: {
        presetId: "lightweight",
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "alignment",
      },
    });

    const work = expectSuccess(advance(session, "q-1"));
    expect(work?.newState).toBe("WORKING");
    expect(work?.board[0].journey).toEqual(
      expect.objectContaining({
        phaseIds: ["alignment", "work", "memory"],
        currentPhaseId: "work",
      }),
    );

    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("work-to-memory"),
      previousState: "WORKING",
    });

    upsert(session, {
      questId: "q-1",
      status: "MEMORY",
      journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 2, currentPhaseId: "memory" },
    });
    expect(session.board.get("q-1")?.journey).toEqual(
      expect.objectContaining({
        currentPhaseId: "memory",
        nextLeaderAction: expect.stringContaining("final Memory"),
      }),
    );
    expect(advance(session, "q-1")).toMatchObject({ removed: true, previousState: "MEMORY" });
  });

  it("fails closed when a repeated current phase lacks an active index", () => {
    const session = makeSession();
    upsert(session, {
      questId: "q-1",
      status: "WORKING",
      journey: {
        presetId: "v2-work",
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "user-checkpoint", "work", "memory"],
        currentPhaseId: "work",
      },
    });

    const row = session.board.get("q-1")!;
    delete row.journey?.activePhaseIndex;
    if (row.journey) row.journey.currentPhaseId = "work";

    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("lacks journey.activePhaseIndex"),
      previousState: "WORKING",
    });
  });

  it("holds an unresolved User Checkpoint, then resumes into its later Work occurrence", () => {
    const session = makeSession();

    upsert(session, {
      questId: "q-1",
      status: "USER_CHECKPOINTING",
      waitForInput: ["n-1"],
      journey: {
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
      },
    });

    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("unresolved"),
      previousState: "USER_CHECKPOINTING",
    });

    upsert(session, { questId: "q-1", waitForInput: [] });
    expect(advance(session, "q-1")).toMatchObject({
      removed: false,
      previousState: "USER_CHECKPOINTING",
      newState: "WORKING",
    });
    expect(session.board.get("q-1")?.journey).toMatchObject({
      activePhaseIndex: 3,
      currentPhaseId: "work",
    });
    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("work-to-memory"),
      previousState: "WORKING",
    });
  });

  it("requires a later Work occurrence after a taken checkpoint before Memory", () => {
    const session = makeSession();

    upsert(session, {
      questId: "q-1",
      status: "USER_CHECKPOINTING",
      journey: {
        phaseIds: ["alignment", "work", "user-checkpoint", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
      },
    });

    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("later Work occurrence"),
      previousState: "USER_CHECKPOINTING",
    });
    expect(session.board.get("q-1")?.status).toBe("USER_CHECKPOINTING");
  });

  it("blocks generic advance from Work to final Memory", () => {
    const session = makeSession();

    upsert(session, { questId: "q-1", status: "WORKING" });

    expect(advance(session, "q-1")).toMatchObject({
      error: expect.stringContaining("work-to-memory"),
      previousState: "WORKING",
    });
    expect(session.board.get("q-1")?.status).toBe("WORKING");
  });
});
