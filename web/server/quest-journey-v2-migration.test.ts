import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  migrateQuestJourneyV2BoardRows,
  type QuestJourneyV2MigrationSessionInfo,
} from "./quest-journey-v2-migration.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
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

function persistedSession(id: string, board: BoardRow[], completedBoard: BoardRow[] = []): PersistedSession {
  return {
    id,
    state: {} as PersistedSession["state"],
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
    board,
    completedBoard,
  };
}

async function runPersistedMigration(args: {
  store: SessionStore;
  now: number;
  infos?: Record<string, QuestJourneyV2MigrationSessionInfo | undefined>;
}) {
  const loaded = await args.store.loadAll();
  const persistedById = new Map(loaded.map((session) => [session.id, session]));
  const sessions = loaded.map((session) => ({
    id: session.id,
    board: new Map((session.board ?? []).map((entry) => [entry.questId, entry])),
  }));
  const writes: Array<Promise<boolean>> = [];
  const summary = migrateQuestJourneyV2BoardRows(sessions, {
    now: args.now,
    getSessionInfo: (sessionId) =>
      args.infos && Object.hasOwn(args.infos, sessionId) ? args.infos[sessionId] : { archived: false },
    persistSession: (session) => {
      const persisted = persistedById.get(session.id);
      if (!persisted) throw new Error(`missing persisted session ${session.id}`);
      writes.push(args.store.saveSync({ ...persisted, board: [...session.board.values()] }));
    },
  });
  await Promise.all(writes);
  return summary;
}

async function loadBoard(store: SessionStore): Promise<BoardRow[]> {
  const [session] = await store.loadAll();
  return session?.board ?? [];
}

async function loadPersistedState(store: SessionStore): Promise<unknown> {
  const sessions = await store.loadAll();
  return sessions.map((session) => ({
    id: session.id,
    board: session.board,
    completedBoard: session.completedBoard,
  }));
}

async function withStore<T>(fn: (store: SessionStore) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "journey-v2-migration-"));
  try {
    return await fn(new SessionStore(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("migrateQuestJourneyV2BoardRows", () => {
  it("keeps legacy indexed notes and timings out of active v2 maps across persisted idempotent startup replay", async () => {
    await withStore(async (store) => {
      const legacy = row({
        status: "PORTING",
        journey: {
          presetId: "legacy-default",
          phaseIds: ["alignment", "implement", "code-review", "port", "memory"],
          activePhaseIndex: 3,
          currentPhaseId: "port",
          phaseNotes: {
            "1": "Old Implement note",
            "2": "Old Code Review note",
            "3": "Old Port note",
            "4": "Old Memory note",
          },
          phaseTimings: {
            "1": { startedAt: 1000, endedAt: 2000 },
            "2": { startedAt: 2000, endedAt: 3000 },
            "3": { startedAt: 3000 },
            "4": { startedAt: 4000 },
          },
        },
      });
      await store.saveSync(persistedSession("leader-1", [legacy]));

      const summary = await runPersistedMigration({ store, now: 9000 });
      const [migrated] = await loadBoard(store);

      expect(summary.migratedRows).toEqual([
        expect.objectContaining({ questId: "q-1", fromStatus: "PORTING", toStatus: "WORKING" }),
      ]);
      expect(migrated.status).toBe("WORKING");
      expect(migrated.journey?.phaseIds).toEqual(["alignment", "work", "memory"]);
      expect(migrated.journey?.phaseNotes).toEqual({
        "1": "Migrated to Quest Journey v2. Legacy phase history is preserved in journey.v2Migration; continue with the active v2 Work/Memory flow.",
      });
      expect(migrated.journey?.phaseTimings).toEqual({ "1": { startedAt: 9000 } });
      expect(Object.values(migrated.journey?.phaseNotes ?? {}).join("\n")).not.toContain("Old Code Review note");
      expect(Object.values(migrated.journey?.phaseNotes ?? {}).join("\n")).not.toContain("Old Port note");
      expect(Object.values(migrated.journey?.phaseNotes ?? {}).join("\n")).not.toContain("Old Memory note");
      expect(migrated.journey?.v2Migration).toMatchObject({
        version: 2,
        migratedAt: 9000,
        fromPhaseIds: ["alignment", "implement", "code-review", "port", "memory"],
        fromPhaseNotes: legacy.journey?.phaseNotes,
        fromPhaseTimings: legacy.journey?.phaseTimings,
      });
      expect(migrated.journey?.v2Migration?.legacyPhases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phasePosition: 2, phaseId: "implement", note: "Old Implement note" }),
          expect.objectContaining({ phasePosition: 3, phaseId: "code-review", note: "Old Code Review note" }),
          expect.objectContaining({ phasePosition: 4, phaseId: "port", note: "Old Port note" }),
          expect.objectContaining({ phasePosition: 5, phaseId: "memory", note: "Old Memory note" }),
        ]),
      );

      const afterFirst = await loadPersistedState(store);
      const replay = await runPersistedMigration({ store, now: 10_000 });
      const afterSecond = await loadPersistedState(store);
      expect(replay).toEqual({ migratedRows: [], pausedRows: [], changedSessions: [] });
      expect(afterSecond).toEqual(afterFirst);
    });
  });

  it("retains only semantically matching Alignment and Memory active notes while preserving repeated legacy phase records", async () => {
    await withStore(async (store) => {
      await store.saveSync(
        persistedSession("leader-1", [
          row({
            questId: "q-align",
            status: "PLANNING",
            journey: {
              phaseIds: ["alignment", "implement", "memory"],
              activePhaseIndex: 0,
              currentPhaseId: "alignment",
              phaseNotes: { "0": "Old Alignment note", "1": "Old Implement note" },
              phaseTimings: { "0": { startedAt: 1000 } },
            },
          }),
          row({
            questId: "q-memory",
            status: "MEMORY",
            journey: {
              phaseIds: ["alignment", "implement", "implement", "memory"],
              activePhaseIndex: 3,
              currentPhaseId: "memory",
              phaseNotes: { "2": "Second Implement note", "3": "Old Memory note" },
              phaseTimings: { "3": { startedAt: 5000 } },
            },
          }),
        ]),
      );

      await runPersistedMigration({ store, now: 8000 });
      const [alignment, memory] = await loadBoard(store);

      expect(alignment.journey?.phaseNotes?.["0"]).toContain("Old Alignment note");
      expect(alignment.journey?.phaseNotes?.["0"]).toContain("Migrated to Quest Journey v2");
      expect(alignment.journey?.phaseNotes?.["1"]).toBeUndefined();
      expect(alignment.journey?.phaseTimings?.["0"]).toEqual({ startedAt: 1000 });
      expect(memory.journey?.phaseNotes?.["2"]).toContain("Old Memory note");
      expect(memory.journey?.phaseNotes?.["2"]).toContain("Migrated to Quest Journey v2");
      expect(memory.journey?.phaseNotes?.["1"]).toBeUndefined();
      expect(memory.journey?.phaseTimings?.["2"]).toEqual({ startedAt: 5000 });
      expect(memory.journey?.v2Migration?.legacyPhases).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ phasePosition: 2, phaseId: "implement", phaseOccurrence: 1 }),
          expect.objectContaining({
            phasePosition: 3,
            phaseId: "implement",
            phaseOccurrence: 2,
            note: "Second Implement note",
          }),
        ]),
      );
    });
  });

  it("maps every active legacy state safely while preserving checkpoint waits and Memory state", async () => {
    await withStore(async (store) => {
      const cases: Array<[string, string, string, number, string]> = [
        ["q-plan", "PLANNING", "implement", 0, "PLANNING"],
        ["q-explore", "EXPLORING", "explore", 1, "WORKING"],
        ["q-implement", "IMPLEMENTING", "implement", 1, "WORKING"],
        ["q-review", "CODE_REVIEWING", "code-review", 1, "WORKING"],
        ["q-sim", "MENTAL_SIMULATING", "mental-simulation", 1, "WORKING"],
        ["q-execute", "EXECUTING", "execute", 1, "WORKING"],
        ["q-outcome", "OUTCOME_REVIEWING", "outcome-review", 1, "WORKING"],
        ["q-port", "PORTING", "port", 1, "WORKING"],
        ["q-book", "BOOKKEEPING", "bookkeeping", 1, "WORKING"],
        ["q-memory", "MEMORY", "memory", 2, "MEMORY"],
      ];
      await store.saveSync(
        persistedSession("leader-1", [
          ...cases.map(([questId, status, phaseId, activePhaseIndex]) =>
            row({
              questId,
              status,
              journey: {
                phaseIds:
                  questId === "q-memory"
                    ? ["alignment", "implement", "memory"]
                    : ["alignment", phaseId as never, "memory"],
                activePhaseIndex,
                currentPhaseId: phaseId as never,
              },
            }),
          ),
          row({
            questId: "q-checkpoint",
            status: "USER_CHECKPOINTING",
            waitForInput: ["n-7"],
            journey: {
              phaseIds: ["alignment", "execute", "user-checkpoint", "memory"],
              activePhaseIndex: 2,
              currentPhaseId: "user-checkpoint",
            },
          }),
        ]),
      );

      await runPersistedMigration({ store, now: 7000 });
      const migrated = new Map((await loadBoard(store)).map((entry) => [entry.questId, entry]));

      for (const [questId, , , , expectedStatus] of cases) {
        expect(migrated.get(questId)?.status).toBe(expectedStatus);
        expect(migrated.get(questId)?.journey?.phaseIds).toEqual(["alignment", "work", "memory"]);
      }
      expect(migrated.get("q-checkpoint")).toMatchObject({
        status: "USER_CHECKPOINTING",
        waitForInput: ["n-7"],
        journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1, currentPhaseId: "work" },
      });
    });
  });

  it("preserves proposed and queued rows with dependencies while pausing reviewer-only or unavailable active rows", async () => {
    await withStore(async (store) => {
      await store.saveSync(
        persistedSession("leader-1", [
          row({
            questId: "q-proposed",
            worker: undefined,
            workerNum: undefined,
            status: "PROPOSED",
            journey: { mode: "proposed", phaseIds: ["alignment", "implement", "memory"] },
          }),
          row({
            questId: "q-queued",
            worker: undefined,
            workerNum: undefined,
            status: "QUEUED",
            waitFor: ["q-9"],
            journey: { phaseIds: ["alignment", "port", "memory"] },
          }),
          row({ questId: "q-reviewer", worker: "reviewer-1" }),
          row({ questId: "q-missing", worker: "missing-worker" }),
        ]),
      );

      const summary = await runPersistedMigration({
        store,
        now: 6000,
        infos: {
          "worker-1": { archived: false },
          "reviewer-1": { reviewerOf: 5 },
          "missing-worker": undefined,
        },
      });
      const migrated = new Map((await loadBoard(store)).map((entry) => [entry.questId, entry]));

      expect(migrated.get("q-proposed")?.status).toBe("PROPOSED");
      expect(migrated.get("q-proposed")?.journey?.mode).toBe("proposed");
      expect(migrated.get("q-queued")?.status).toBe("QUEUED");
      expect(migrated.get("q-queued")?.waitFor).toEqual(["q-9"]);
      expect(migrated.get("q-reviewer")).toMatchObject({ status: "QUEUED", waitFor: ["free-worker"] });
      expect(migrated.get("q-missing")).toMatchObject({ status: "QUEUED", waitFor: ["free-worker"] });
      expect(summary.pausedRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ questId: "q-reviewer", pausedReason: "assigned session is reviewer-only" }),
          expect.objectContaining({ questId: "q-missing", pausedReason: "assigned worker session is unavailable" }),
        ]),
      );
    });
  });

  it("pauses malformed unknown rows with bounded diagnostics instead of making them dispatchable", async () => {
    await withStore(async (store) => {
      await store.saveSync(
        persistedSession("leader-1", [
          row({
            questId: "q-bad-state",
            status: "MYSTERY_STATE",
            journey: { phaseIds: ["alignment", "implement", "memory"] },
          }),
          row({
            questId: "q-bad-phase",
            status: "IMPLEMENTING",
            journey: {
              phaseIds: ["alignment", "definitely-not-a-phase", "memory"] as never,
              phaseNotes: { "1": "Unknown phase note", "2": "Valid memory note" },
              phaseTimings: { "1": { startedAt: 1000 }, "2": { startedAt: 2000 } },
            },
          }),
        ]),
      );

      const summary = await runPersistedMigration({ store, now: 5000 });
      const migrated = new Map((await loadBoard(store)).map((entry) => [entry.questId, entry]));

      expect(migrated.get("q-bad-state")).toMatchObject({ status: "QUEUED", waitFor: ["free-worker"] });
      expect(migrated.get("q-bad-state")?.journey?.v2Migration?.diagnostic).toContain("unknown legacy board state");
      expect(migrated.get("q-bad-phase")).toMatchObject({ status: "QUEUED", waitFor: ["free-worker"] });
      expect(migrated.get("q-bad-phase")?.journey?.v2Migration?.diagnostic).toContain("unknown or malformed");
      const badPhaseLegacy = migrated.get("q-bad-phase")?.journey?.v2Migration?.legacyPhases ?? [];
      expect(badPhaseLegacy).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            index: 1,
            phasePosition: 2,
            rawPhaseId: "definitely-not-a-phase",
            diagnostic: "unknown or malformed legacy phase id",
            note: "Unknown phase note",
            timing: { startedAt: 1000 },
          }),
          expect.objectContaining({
            index: 2,
            phasePosition: 3,
            phaseId: "memory",
            rawPhaseId: "memory",
            note: "Valid memory note",
            timing: { startedAt: 2000 },
          }),
        ]),
      );
      expect(badPhaseLegacy.find((record) => record.index === 1)?.phaseId).toBeUndefined();
      expect(summary.pausedRows).toHaveLength(2);
    });
  });

  it("does not migrate completed-board history and leaves already migrated rows unchanged", async () => {
    await withStore(async (store) => {
      const completed = row({ questId: "q-done", status: "PORTING", completedAt: 123 });
      const alreadyMigrated = row({
        questId: "q-migrated",
        status: "WORKING",
        journey: {
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
          currentPhaseId: "work",
          phaseNotes: { "1": "Already migrated Work note" },
          v2Migration: { version: 2, migratedAt: 111 },
        },
      });
      await store.saveSync(persistedSession("leader-1", [alreadyMigrated], [completed]));

      const before = await loadPersistedState(store);
      const summary = await runPersistedMigration({ store, now: 4000 });
      const after = await loadPersistedState(store);

      expect(summary).toEqual({ migratedRows: [], pausedRows: [], changedSessions: [] });
      expect(after).toEqual(before);
    });
  });
});
