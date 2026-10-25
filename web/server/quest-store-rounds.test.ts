import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempDir: string;
let questStore: typeof import("./quest-store.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (d: string) => {
      dir = d;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir.get() };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-rounds-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Rounds through the real quest store (in a disposable HOME): creation opens
 * round 1, reopening closes it with the debrief as its outcome and opens the
 * next, and round edits and Journey run closing persist.
 */
describe("quest-store rounds", () => {
  it("opens round 1 at creation and keeps rounds through status changes", async () => {
    const created = await questStore.createQuest({ title: "Rounds", description: "Standing brief", status: "refined" });
    expect(created.rounds).toEqual([{ openedAt: created.createdAt }]);
    await questStore.claimQuest("q-1", "worker");
    const done = await questStore.completeQuest("q-1", [], { debrief: "Round one done.", debriefTldr: "One." });
    expect(done?.rounds).toEqual(created.rounds);
  });

  it("reopens a done quest into a new round and closes its active Journey runs", async () => {
    await questStore.createQuest({ title: "Rounds", description: "Standing brief", status: "refined" });
    await questStore.claimQuest("q-1", "worker");
    await questStore.patchQuest("q-1", {
      journeyRuns: [
        {
          runId: "r1",
          source: "board",
          phaseIds: ["work"],
          status: "active",
          createdAt: 1,
          updatedAt: 1,
          phaseOccurrences: [],
        },
      ],
    });
    const done = await questStore.completeQuest("q-1", [], { debrief: "Round one done.", debriefTldr: "One." });
    // Completion ends the quest's Journey runs instead of leaving them "active".
    expect(done?.journeyRuns?.[0]).toMatchObject({ status: "completed" });
    await questStore.patchQuest("q-1", { feedback: [{ author: "human", text: "Now do round two.", ts: Date.now() }] });

    const reopened = await questStore.transitionQuest("q-1", {
      status: "refined",
      openRound: { title: "Round two", brief: "Only the second step.", requests: [0] },
    });
    expect(reopened?.status).toBe("refined");
    expect(reopened?.rounds).toHaveLength(2);
    expect(reopened?.rounds?.[0]).toMatchObject({
      closedAt: (done as { completedAt: number }).completedAt,
      outcome: "Round one done.",
    });
    expect(reopened?.rounds?.[1]).toMatchObject({ title: "Round two", brief: "Only the second step.", requests: [0] });

    const edited = await questStore.patchQuest("q-1", { round: { number: 2, title: "Second step" } });
    expect(edited?.rounds?.[1]).toMatchObject({ title: "Second step", brief: "Only the second step." });
  });

  it("refuses to open a round outside a reopening to refined, or before the current round started", async () => {
    await questStore.createQuest({ title: "Rounds", description: "Standing brief", status: "refined" });
    await expect(
      questStore.transitionQuest("q-1", { status: "refined", openRound: { title: "Too early" } }),
    ).rejects.toThrow("has not started its current round");
    await questStore.claimQuest("q-1", "worker");
    await expect(
      questStore.transitionQuest("q-1", { status: "in_progress", openRound: { title: "Wrong status" } }),
    ).rejects.toThrow("only when reopening to refined");
  });
});
