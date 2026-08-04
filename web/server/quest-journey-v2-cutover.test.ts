import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getBoard, advanceBoardRow, type WorkBoardStateDeps } from "./bridge/board-watchdog-controller.js";
import { SessionStore, type PersistedSession } from "./session-store.js";
import type { BoardRow } from "./session-types.js";
import {
  getInvalidQuestJourneyPhaseIds,
  normalizeQuestJourneyPlan,
  QUEST_JOURNEY_PHASES,
  QUEST_JOURNEY_STATES,
  validateQuestJourneyPhaseSequence,
} from "../shared/quest-journey.js";

function legacyRow(overrides: Partial<BoardRow> = {}): BoardRow {
  return {
    questId: "q-legacy",
    title: "Legacy Quest",
    worker: "worker-1",
    workerNum: 5,
    status: "IMPLEMENTING",
    journey: {
      presetId: "legacy",
      phaseIds: ["alignment", "implement", "code-review", "port", "memory"],
      activePhaseIndex: 1,
      currentPhaseId: "implement",
      phaseNotes: {
        "1": "Legacy implement note",
        "2": "Legacy review note",
        "3": "Legacy port note",
      },
      phaseTimings: {
        "1": { startedAt: 1000, endedAt: 2000 },
        "2": { startedAt: 2000, endedAt: 3000 },
        "3": { startedAt: 3000 },
      },
    },
    createdAt: 10,
    updatedAt: 20,
    ...overrides,
  };
}

function persistedSession(id: string, board: BoardRow[]): PersistedSession {
  return {
    id,
    state: {} as PersistedSession["state"],
    messageHistory: [],
    pendingMessages: [],
    pendingPermissions: [],
    board,
  };
}

function testDeps(): WorkBoardStateDeps {
  return {
    getBoardDispatchableSignature: vi.fn(() => null),
    markNotificationDone: vi.fn(() => true),
    broadcastBoard: vi.fn(),
    persistSession: vi.fn(),
    notifyReview: vi.fn(),
  };
}

async function withStore<T>(fn: (store: SessionStore, dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "journey-v2-cutover-"));
  try {
    return await fn(new SessionStore(dir), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Quest Journey v2 data-preserving cutover", () => {
  it("reloads legacy persisted board rows without rewriting phase data or adding migration metadata", async () => {
    await withStore(async (store, dir) => {
      const session = persistedSession("leader-1", [legacyRow()]);
      await store.saveSync(session);
      const before = await readFile(join(dir, "leader-1.json"), "utf-8");

      const [loaded] = await store.loadAll();
      expect(loaded?.board).toEqual(session.board);
      const after = await readFile(join(dir, "leader-1.json"), "utf-8");

      expect(after).toBe(before);
      expect(after).not.toContain("v2Migration");
    });
  });

  it("keeps existing legacy rows readable under their stored labels and finishable without rewriting to v2", () => {
    const session = {
      id: "leader-1",
      board: new Map([["q-legacy", legacyRow()]]),
      completedBoard: new Map(),
      boardDispatchStates: new Map(),
      boardStallStates: new Map(),
      attentionRecords: [],
      state: {},
    };
    const deps = testDeps();

    const [readable] = getBoard(session);
    expect(readable.journey?.phaseIds).toEqual(["alignment", "implement", "code-review", "port", "memory"]);
    expect(readable.journey?.phaseNotes).toMatchObject({
      "1": "Legacy implement note",
      "2": "Legacy review note",
      "3": "Legacy port note",
    });
    expect(readable.journey).not.toHaveProperty("v2Migration");

    let result = advanceBoardRow(session, "q-legacy", QUEST_JOURNEY_STATES, deps);
    expect(result).toMatchObject({ removed: false, previousState: "IMPLEMENTING", newState: "CODE_REVIEWING" });
    expect(session.board.get("q-legacy")?.journey?.phaseIds).toEqual([
      "alignment",
      "implement",
      "code-review",
      "port",
      "memory",
    ]);
    expect(session.board.get("q-legacy")?.status).toBe("CODE_REVIEWING");

    result = advanceBoardRow(session, "q-legacy", QUEST_JOURNEY_STATES, deps);
    expect(result).toMatchObject({ removed: false, previousState: "CODE_REVIEWING", newState: "PORTING" });
    result = advanceBoardRow(session, "q-legacy", QUEST_JOURNEY_STATES, deps);
    expect(result).toMatchObject({ removed: false, previousState: "PORTING", newState: "MEMORY" });
    result = advanceBoardRow(session, "q-legacy", QUEST_JOURNEY_STATES, deps);
    expect(result).toMatchObject({ removed: true, previousState: "MEMORY" });
    expect(session.completedBoard.get("q-legacy")?.journey?.phaseIds).toEqual([
      "alignment",
      "implement",
      "code-review",
      "port",
      "memory",
    ]);
  });

  it("keeps active discovery and new-row validation v2-only while accepting stored legacy rows", () => {
    expect(QUEST_JOURNEY_PHASES.map((phase) => phase.id)).toEqual(["alignment", "work", "user-checkpoint", "memory"]);

    const invalid = getInvalidQuestJourneyPhaseIds(["alignment", "implement", "code-review", "memory"]);
    expect(invalid).toEqual(["implement", "code-review"]);
    expect(validateQuestJourneyPhaseSequence(["alignment", "implement", "memory"])).toContain(
      "Legacy v1 phase IDs are historical-read only",
    );

    const normalizedLegacy = normalizeQuestJourneyPlan(legacyRow().journey, "IMPLEMENTING");
    expect(normalizedLegacy.phaseIds).toEqual(["alignment", "implement", "code-review", "port", "memory"]);
    expect(normalizedLegacy.phaseNotes?.["2"]).toBe("Legacy review note");
    expect(normalizedLegacy).not.toHaveProperty("v2Migration");
  });

  it("does not wire a startup active-row migration into server startup", async () => {
    const indexSource = await readFile(new URL("./index.ts", import.meta.url), "utf-8");

    expect(indexSource).not.toContain("quest-journey-v2-migration");
    expect(indexSource).not.toContain("migrateQuestJourneyV2BoardRows");
    expect(indexSource).not.toContain("Migrated Quest Journey board rows to v2");
  });
});
