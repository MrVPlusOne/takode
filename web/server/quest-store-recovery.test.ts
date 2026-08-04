import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
  tempDir = mkdtempSync(join(tmpdir(), "quest-recovery-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("quest recovery audit metadata", () => {
  it("persists leader completion recovery events on completed quests", async () => {
    await questStore.createQuest({ title: "Recover completion", description: "Ready", status: "refined" });
    await questStore.claimQuest("q-1", "worker-1", { leaderSessionId: "leader-1" });

    const completed = await questStore.completeQuest("q-1", [], {
      commitShas: ["abc1234"],
      debrief: "Final outcome.",
      debriefTldr: "Final TLDR.",
      recoveryEvent: {
        operation: "leader_complete",
        actorSessionId: "leader-1",
        reason: "worker archived after accepted Memory",
        previousStatus: "in_progress",
        previousOwnerSessionId: "worker-1",
        previousLeaderSessionId: "leader-1",
        boardRows: [{ leaderSessionId: "leader-1", status: "MEMORY", workerSessionId: "worker-1" }],
        workerState: { sessionId: "worker-1", known: true, archived: true },
        supplied: {
          verificationItemCount: 0,
          commitShas: ["abc1234"],
          memoryCommitShas: [],
          hasDebrief: true,
          hasDebriefTldr: true,
        },
        bypassedChecks: ["v2 Memory completion guard and worker git/worktree checks were unavailable"],
      },
    });

    expect(completed?.status).toBe("done");
    expect(completed?.recoveryEvents).toHaveLength(1);
    expect(completed?.recoveryEvents?.[0]).toMatchObject({
      operation: "leader_complete",
      actorSessionId: "leader-1",
      reason: "worker archived after accepted Memory",
      previousOwnerSessionId: "worker-1",
      workerState: { sessionId: "worker-1", known: true, archived: true },
      supplied: { commitShas: ["abc1234"], hasDebrief: true, hasDebriefTldr: true },
    });
    expect(completed?.recoveryEvents?.[0]?.ts).toBeGreaterThan(0);
  });
});
