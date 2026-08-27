import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

function enableLiveStore(): void {
  const liveDir = join(tempDir, ".companion", "questmaster-live");
  mkdirSync(liveDir, { recursive: true });
  writeFileSync(
    join(liveDir, "store.json"),
    JSON.stringify({
      format: "mutable_current_record",
      version: 1,
      nextQuestNumber: 1,
      quests: [],
      updatedAt: 1,
    }),
    "utf-8",
  );
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

describe("cross-provider quest ownership", () => {
  async function createRefinedQuest(title: string): Promise<string> {
    const quest = await questStore.createQuest({ title, description: "Ready", status: "refined" });
    return quest.questId;
  }

  it("persists Codex ownership and keeps it out of Takode compatibility lookups", async () => {
    const questId = await createRefinedQuest("Codex claim");

    const claimed = await questStore.claimQuest(questId, "codex-session", { ownerKind: "codex" });

    expect(claimed).toMatchObject({
      status: "in_progress",
      sessionId: "codex-session",
      ownerKind: "codex",
    });
    expect((await questStore.getActiveQuestForOwner({ kind: "codex", sessionId: "codex-session" }))?.questId).toBe(
      questId,
    );
    expect(await questStore.getActiveQuestForSession("codex-session")).toBeNull();
  });

  it("enforces one active quest per Codex owner", async () => {
    const firstId = await createRefinedQuest("First Codex quest");
    const secondId = await createRefinedQuest("Second Codex quest");
    await questStore.claimQuest(firstId, "codex-session", { ownerKind: "codex" });

    await expect(questStore.claimQuest(secondId, "codex-session", { ownerKind: "codex" })).rejects.toThrow(
      `Session already has an active quest: ${firstId}`,
    );
  });

  it("does not collide when Takode and Codex use the same raw session id", async () => {
    const takodeQuestId = await createRefinedQuest("Takode quest");
    const codexQuestId = await createRefinedQuest("Codex quest");

    await questStore.claimQuest(takodeQuestId, "same-id");
    await questStore.claimQuest(codexQuestId, "same-id", { ownerKind: "codex" });

    expect((await questStore.getActiveQuestForSession("same-id"))?.questId).toBe(takodeQuestId);
    expect((await questStore.getActiveQuestForOwner({ kind: "codex", sessionId: "same-id" }))?.questId).toBe(
      codexQuestId,
    );
  });

  it("rejects cross-provider takeover before Takode force or archive policies", async () => {
    const questId = await createRefinedQuest("Provider boundary");
    await questStore.claimQuest(questId, "takode-owner");

    await expect(
      questStore.claimQuest(questId, "codex-owner", {
        ownerKind: "codex",
        allowArchivedOwnerTakeover: true,
        force: true,
        isSessionArchived: () => true,
        ownershipEvent: {
          operation: "force_claim",
          actorSessionId: "codex-owner",
          previousOwnerSessionId: "takode-owner",
          newOwnerSessionId: "codex-owner",
          reason: "must remain rejected",
        },
      }),
    ).rejects.toThrow("cross-provider takeover");
  });

  it("moves completed and cancelled Codex owners into canonical history", async () => {
    const completedId = await createRefinedQuest("Complete Codex quest");
    await questStore.claimQuest(completedId, "codex-complete", { ownerKind: "codex" });
    const completed = await questStore.transitionQuest(completedId, { status: "done", verificationItems: [] });

    expect(completed?.previousOwners).toEqual([{ kind: "codex", sessionId: "codex-complete" }]);
    expect(completed?.previousOwnerSessionIds).toBeUndefined();
    expect("ownerKind" in (completed ?? {})).toBe(false);

    const cancelledId = await createRefinedQuest("Cancel Codex quest");
    await questStore.claimQuest(cancelledId, "codex-cancel", { ownerKind: "codex" });
    const cancelled = await questStore.cancelQuest(cancelledId);

    expect(cancelled?.previousOwners).toEqual([{ kind: "codex", sessionId: "codex-cancel" }]);
    expect(cancelled?.previousOwnerSessionIds).toBeUndefined();
  });

  it("keeps all-Takode history in the legacy projection", async () => {
    const questId = await createRefinedQuest("Legacy history");
    const claimed = await questStore.claimQuest(questId, "takode-owner");
    const completed = await questStore.transitionQuest(questId, { status: "done", verificationItems: [] });

    expect(claimed?.status === "in_progress" ? claimed.ownerKind : undefined).toBeUndefined();
    expect(completed?.previousOwnerSessionIds).toEqual(["takode-owner"]);
    expect(completed?.previousOwners).toBeUndefined();
  });
});

describe("atomic live-store Quest mutations", () => {
  beforeEach(() => {
    enableLiveStore();
  });

  it("preserves both feedback entries appended concurrently", async () => {
    // Feedback arrays are derived inside the live-store write lock so one
    // sidecar note cannot replace another note read from the same old snapshot.
    const quest = await questStore.createQuest({ title: "Concurrent notes" });

    await Promise.all([
      questStore.appendQuestFeedback(quest.questId, { author: "agent", text: "First note", ts: 10 }),
      questStore.appendQuestFeedback(quest.questId, { author: "agent", text: "Second note", ts: 11 }),
    ]);

    expect((await questStore.getQuest(quest.questId))?.feedback?.map((entry) => entry.text).sort()).toEqual([
      "First note",
      "Second note",
    ]);
  });

  it("allows only one of two concurrent Codex owners to claim the same quest", async () => {
    // Both requests start together, but ownership validation and transition
    // occur in one locked mutation, so the second caller observes the winner.
    const quest = await questStore.createQuest({
      title: "Concurrent direct claims",
      description: "Ready",
      status: "refined",
    });

    const outcomes = await Promise.allSettled([
      questStore.claimQuest(quest.questId, "codex-a", { ownerKind: "codex" }),
      questStore.claimQuest(quest.questId, "codex-b", { ownerKind: "codex" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const winner = outcomes.find((outcome) => outcome.status === "fulfilled");
    const claimed = winner?.status === "fulfilled" ? winner.value : null;
    const persisted = await questStore.getQuest(quest.questId);
    expect(persisted).toMatchObject({
      status: "in_progress",
      sessionId: claimed?.status === "in_progress" ? claimed.sessionId : undefined,
      ownerKind: "codex",
    });
  });

  it("keeps one active quest when one Codex owner claims two quests concurrently", async () => {
    // The one-active-quest invariant is checked against the same locked store
    // snapshot used for the winning transition.
    const first = await questStore.createQuest({ title: "First", description: "Ready", status: "refined" });
    const second = await questStore.createQuest({ title: "Second", description: "Ready", status: "refined" });

    const outcomes = await Promise.allSettled([
      questStore.claimQuest(first.questId, "codex-owner", { ownerKind: "codex" }),
      questStore.claimQuest(second.questId, "codex-owner", { ownerKind: "codex" }),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    const active = (await questStore.listQuests()).filter(
      (candidate) =>
        candidate.status === "in_progress" && candidate.ownerKind === "codex" && candidate.sessionId === "codex-owner",
    );
    expect(active).toHaveLength(1);
  });

  it("guards sidecar patches by provider-aware active ownership", async () => {
    // A raw-ID match across providers is not authority. Unowned and exact
    // Codex-owned quests remain editable through the direct sidecar primitive.
    const takodeQuest = await questStore.createQuest({
      title: "Takode-owned",
      description: "Original",
      status: "refined",
    });
    await questStore.claimQuest(takodeQuest.questId, "same-id");
    await expect(
      questStore.patchQuestForOwner(
        takodeQuest.questId,
        { kind: "codex", sessionId: "same-id" },
        {
          description: "Rejected",
        },
      ),
    ).rejects.toThrow("owned by takode owner same-id");

    const unowned = await questStore.createQuest({ title: "Unowned", description: "Original", status: "refined" });
    await expect(
      questStore.patchQuestForOwner(
        unowned.questId,
        { kind: "codex", sessionId: "same-id" },
        {
          description: "Allowed while unowned",
        },
      ),
    ).resolves.toMatchObject({ description: "Allowed while unowned" });

    const codexQuest = await questStore.createQuest({
      title: "Codex-owned",
      description: "Original",
      status: "refined",
    });
    await questStore.claimQuest(codexQuest.questId, "same-id", { ownerKind: "codex" });
    await expect(
      questStore.patchQuestForOwner(
        codexQuest.questId,
        { kind: "codex", sessionId: "same-id" },
        {
          description: "Allowed for owner",
        },
      ),
    ).resolves.toMatchObject({ description: "Allowed for owner" });
  });

  it("guards cancellation by provider-aware active ownership", async () => {
    // Identical raw IDs do not make a Codex task the owner of a Takode claim.
    const quest = await questStore.createQuest({
      title: "Provider-aware cancellation",
      description: "Ready",
      status: "refined",
    });
    await questStore.claimQuest(quest.questId, "same-id");

    await expect(
      questStore.cancelQuestForOwner(quest.questId, { kind: "codex", sessionId: "same-id" }),
    ).rejects.toThrow("owned by takode owner same-id");
    expect(await questStore.getQuest(quest.questId)).toMatchObject({
      status: "in_progress",
      sessionId: "same-id",
    });
  });

  it("does not let a concurrent Codex cancellation overwrite a Takode claim", async () => {
    // Whichever request enters the lock first, the final store must preserve
    // the Takode claim: cancellation either precedes that claim or observes it
    // and fails its exact-owner check.
    const quest = await questStore.createQuest({
      title: "Claim cancellation race",
      description: "Ready",
      status: "refined",
    });

    const [claimResult] = await Promise.allSettled([
      questStore.claimQuest(quest.questId, "same-id"),
      questStore.cancelQuestForOwner(quest.questId, { kind: "codex", sessionId: "same-id" }),
    ]);

    expect(claimResult.status).toBe("fulfilled");
    expect(await questStore.getQuest(quest.questId)).toMatchObject({
      status: "in_progress",
      sessionId: "same-id",
    });
  });
});
