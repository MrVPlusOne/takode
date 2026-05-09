import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
  return {
    ...actual,
    homedir: () => mockHomedir.get(),
  };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-ownership-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

async function createClaimedQuest(): Promise<void> {
  await questStore.createQuest({ title: "Transfer", description: "Ready", status: "refined" });
  await questStore.claimQuest("q-1", "sess-1", { leaderSessionId: "leader-1" });
}

describe("quest ownership audit", () => {
  it("records explicit force-claim audit data and preserves compact previous ownership", async () => {
    await createClaimedQuest();

    const claimed = await questStore.claimQuest("q-1", "sess-2", {
      force: true,
      leaderSessionId: "leader-2",
      ownershipEvent: {
        operation: "force_claim",
        actorSessionId: "sess-2",
        previousOwnerSessionId: "sess-1",
        newOwnerSessionId: "sess-2",
        previousLeaderSessionId: "leader-1",
        newLeaderSessionId: "leader-2",
        reason: "board assigned this phase",
      },
    });

    expect(claimed?.status).toBe("in_progress");
    if (claimed?.status !== "in_progress") throw new Error("expected in_progress quest");
    expect(claimed.sessionId).toBe("sess-2");
    expect(claimed.previousOwnerSessionIds).toEqual(["sess-1"]);
    expect(claimed.ownershipEvents).toEqual([
      expect.objectContaining({
        operation: "force_claim",
        actorSessionId: "sess-2",
        previousOwnerSessionId: "sess-1",
        newOwnerSessionId: "sess-2",
        previousLeaderSessionId: "leader-1",
        newLeaderSessionId: "leader-2",
        reason: "board assigned this phase",
        ts: expect.any(Number),
      }),
    ]);

    const completed = await questStore.transitionQuest("q-1", { status: "done", verificationItems: [] });
    expect(completed?.ownershipEvents).toHaveLength(1);
  });

  it("rejects explicit force takeover without audit data", async () => {
    await createClaimedQuest();

    await expect(questStore.claimQuest("q-1", "sess-2", { force: true })).rejects.toThrow(
      "Ownership takeover audit event is required",
    );
  });

  it("records archived-owner compatibility takeover as an audit event", async () => {
    await createClaimedQuest();

    const claimed = await questStore.claimQuest("q-1", "sess-2", {
      allowArchivedOwnerTakeover: true,
      isSessionArchived: (sid) => sid === "sess-1",
      leaderSessionId: "leader-2",
    });

    expect(claimed?.ownershipEvents).toEqual([
      expect.objectContaining({
        operation: "archived_owner_takeover",
        actorSessionId: "sess-2",
        previousOwnerSessionId: "sess-1",
        newOwnerSessionId: "sess-2",
        previousLeaderSessionId: "leader-1",
        newLeaderSessionId: "leader-2",
        reason: "previous owner archived",
      }),
    ]);
  });
});
