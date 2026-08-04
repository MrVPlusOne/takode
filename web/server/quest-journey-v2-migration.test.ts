import { describe, expect, it, vi } from "vitest";
import { migrateQuestJourneyV2BoardRows } from "./quest-journey-v2-migration.js";
import type { BoardRow } from "./session-types.js";

function row(overrides: Partial<BoardRow>): BoardRow {
  return {
    questId: "q-1",
    title: "Quest",
    worker: "worker-1",
    workerNum: 5,
    status: "IMPLEMENTING",
    journey: {
      presetId: "legacy",
      phaseIds: ["alignment", "implement", "code-review", "port", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "implement",
      phaseNotes: { "1": "Legacy implement note" },
      phaseTimings: { "1": { startedAt: 1000 } },
    },
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function session(rows: BoardRow[]) {
  return { id: "leader-1", board: new Map(rows.map((entry) => [entry.questId, entry])) };
}

describe("migrateQuestJourneyV2BoardRows", () => {
  it("maps legacy active work states to Work while preserving legacy metadata", () => {
    const persistSession = vi.fn();
    const leader = session([row({})]);

    const summary = migrateQuestJourneyV2BoardRows([leader], {
      now: 1234,
      persistSession,
      getSessionInfo: () => ({ archived: false }),
    });

    const migrated = leader.board.get("q-1")!;
    expect(summary.migratedRows).toEqual([
      expect.objectContaining({
        leaderSessionId: "leader-1",
        questId: "q-1",
        fromStatus: "IMPLEMENTING",
        toStatus: "WORKING",
      }),
    ]);
    expect(summary.pausedRows).toEqual([]);
    expect(persistSession).toHaveBeenCalledWith(leader);
    expect(migrated.status).toBe("WORKING");
    expect(migrated.journey).toMatchObject({
      presetId: "v2-migrated",
      phaseIds: ["alignment", "work", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "work",
      v2Migration: {
        version: 2,
        migratedAt: 1234,
        fromStatus: "IMPLEMENTING",
        fromPhaseIds: ["alignment", "implement", "code-review", "port", "memory"],
        fromActivePhaseIndex: 1,
        fromCurrentPhaseId: "implement",
        fromPhaseNotes: { "1": "Legacy implement note" },
      },
    });
    expect(migrated.journey?.phaseNotes?.["1"]).toContain("Migrated to Quest Journey v2");
  });

  it("preserves User Checkpoint as a Work pause over the same worker", () => {
    const leader = session([
      row({
        status: "USER_CHECKPOINTING",
        waitForInput: ["n-7"],
        journey: {
          phaseIds: ["alignment", "execute", "user-checkpoint", "memory"],
          activePhaseIndex: 2,
          currentPhaseId: "user-checkpoint",
        },
      }),
    ]);

    migrateQuestJourneyV2BoardRows([leader], {
      now: 2000,
      persistSession: vi.fn(),
      getSessionInfo: () => ({ archived: false }),
    });

    const migrated = leader.board.get("q-1")!;
    expect(migrated.status).toBe("USER_CHECKPOINTING");
    expect(migrated.waitForInput).toEqual(["n-7"]);
    expect(migrated.journey?.currentPhaseId).toBe("work");
    expect(migrated.journey?.activePhaseIndex).toBe(1);
  });

  it("migrates proposed and queued rows without requiring a worker", () => {
    const proposed = row({
      questId: "q-1",
      worker: undefined,
      workerNum: undefined,
      status: "PROPOSED",
      journey: { mode: "proposed", phaseIds: ["alignment", "implement", "memory"] },
    });
    const queued = row({
      questId: "q-2",
      worker: undefined,
      workerNum: undefined,
      status: "QUEUED",
      waitFor: ["q-9"],
      journey: { phaseIds: ["alignment", "port", "memory"] },
    });
    const leader = session([proposed, queued]);

    migrateQuestJourneyV2BoardRows([leader], {
      now: 3000,
      persistSession: vi.fn(),
      getSessionInfo: () => undefined,
    });

    expect(leader.board.get("q-1")?.status).toBe("PROPOSED");
    expect(leader.board.get("q-1")?.journey?.phaseIds).toEqual(["alignment", "work", "memory"]);
    expect(leader.board.get("q-1")?.journey?.activePhaseIndex).toBeUndefined();
    expect(leader.board.get("q-2")?.status).toBe("QUEUED");
    expect(leader.board.get("q-2")?.waitFor).toEqual(["q-9"]);
    expect(leader.board.get("q-2")?.journey?.phaseIds).toEqual(["alignment", "work", "memory"]);
  });

  it("pauses reviewer-only or unavailable active rows instead of guessing a worker", () => {
    const leader = session([row({ worker: "reviewer-1" })]);

    const summary = migrateQuestJourneyV2BoardRows([leader], {
      now: 4000,
      persistSession: vi.fn(),
      getSessionInfo: () => ({ reviewerOf: 5 }),
    });

    const migrated = leader.board.get("q-1")!;
    expect(migrated.status).toBe("QUEUED");
    expect(migrated.waitFor).toEqual(["free-worker"]);
    expect(summary.pausedRows[0]).toMatchObject({
      questId: "q-1",
      pausedReason: "assigned session is reviewer-only",
    });
    expect(migrated.journey?.v2Migration?.pausedReason).toBe("assigned session is reviewer-only");
  });

  it("is idempotent for already migrated rows", () => {
    const persistSession = vi.fn();
    const leader = session([
      row({
        status: "WORKING",
        journey: {
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
          currentPhaseId: "work",
          v2Migration: { version: 2, migratedAt: 111 },
        },
      }),
    ]);

    const summary = migrateQuestJourneyV2BoardRows([leader], {
      persistSession,
      getSessionInfo: () => ({ archived: false }),
    });

    expect(summary.migratedRows).toEqual([]);
    expect(persistSession).not.toHaveBeenCalled();
  });
});
