import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { readQuestFixture, writeQuestStoreFixture } from "./test-fixtures/quest-store-fixture.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestCodeCommitEvidenceReplacementInput } from "./quest-store.js";

const OLD_SHA = "1".repeat(40);
const SECOND_OLD_SHA = "2".repeat(40);
const NEW_SHA = "3".repeat(40);
const APPENDED_SHA = "4".repeat(40);

let tempDir: string;
let questStore: typeof import("./quest-store.js");

const mockHomedir = vi.hoisted(() => {
  let dir = "";
  return {
    get: () => dir,
    set: (value: string) => {
      dir = value;
    },
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => mockHomedir.get() };
});

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), "quest-code-evidence-replacement-test-"));
  mockHomedir.set(tempDir);
  vi.resetModules();
  questStore = await import("./quest-store.js");
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function replacementInput(
  overrides: Partial<QuestCodeCommitEvidenceReplacementInput> = {},
): QuestCodeCommitEvidenceReplacementInput {
  return {
    expectedCommitShas: [OLD_SHA],
    replacementCommitShas: [NEW_SHA],
    reason: "Correct invalid synchronized delivery evidence",
    journeyRunId: "board-leader-1-100",
    phaseOccurrenceId: "board-leader-1-100:p1",
    verifiedTargetBranch: "jiayi",
    verifiedTargetHeadSha: NEW_SHA,
    ...overrides,
  };
}

async function createActiveQuestWithEvidence(commitShas: string[] = [OLD_SHA]): Promise<void> {
  await questStore.createQuest({ title: "Repair delivery evidence", description: "Ready", status: "refined" });
  await questStore.claimQuest("q-1", "worker-1");
  await questStore.completeQuest("q-1", [], { commitShas });
  await questStore.transitionQuest("q-1", { status: "in_progress", sessionId: "worker-1" });
}

function writeLiveStoreFixture(quest: Record<string, unknown>): void {
  writeQuestStoreFixture(join(tempDir, ".companion"), {
    nextQuestNumber: 2,
    quests: [
      {
        id: "q-1",
        questId: "q-1",
        version: 3,
        title: "Active Work",
        status: "in_progress",
        description: "Ready",
        sessionId: "worker-1",
        claimedAt: 200,
        createdAt: 100,
        statusChangedAt: 200,
        ...quest,
      },
    ],
  });
}

describe("replaceQuestCodeCommitEvidenceForOwner", () => {
  it("replaces the exact ordered evidence once and preserves its audit through later append and completion", async () => {
    await createActiveQuestWithEvidence();

    const replaced = await questStore.replaceQuestCodeCommitEvidenceForOwner(
      "q-1",
      { kind: "takode", sessionId: "worker-1" },
      replacementInput({
        expectedCommitShas: [OLD_SHA.toUpperCase()],
        replacementCommitShas: [NEW_SHA.toUpperCase(), NEW_SHA],
        verifiedTargetHeadSha: NEW_SHA.toUpperCase(),
      }),
    );

    expect(replaced?.commitShas).toEqual([NEW_SHA]);
    expect(replaced?.codeCommitEvidenceReplacementEvents).toEqual([
      {
        operation: "replace_code_commit_evidence",
        actorSessionId: "worker-1",
        reason: "Correct invalid synchronized delivery evidence",
        previousCommitShas: [OLD_SHA],
        replacementCommitShas: [NEW_SHA],
        journeyRunId: "board-leader-1-100",
        phaseOccurrenceId: "board-leader-1-100:p1",
        verifiedTargetBranch: "jiayi",
        verifiedTargetHeadSha: NEW_SHA,
        ts: expect.any(Number),
      },
    ]);
    expect(replaced?.updatedAt).toBe(replaced?.codeCommitEvidenceReplacementEvents?.[0]?.ts);

    await expect(
      questStore.replaceQuestCodeCommitEvidenceForOwner(
        "q-1",
        { kind: "takode", sessionId: "worker-1" },
        replacementInput(),
      ),
    ).rejects.toThrow("expected ordered commits");

    await questStore.appendQuestCodeCommitEvidenceForOwner("q-1", { kind: "takode", sessionId: "worker-1" }, [
      APPENDED_SHA,
    ]);
    const completed = await questStore.completeQuest("q-1", []);
    expect(completed?.commitShas).toEqual([NEW_SHA, APPENDED_SHA]);
    expect(completed?.codeCommitEvidenceReplacementEvents).toHaveLength(1);
  });

  it("rejects stale ordering, wrong provider-aware owners, and completed quests without mutation", async () => {
    await createActiveQuestWithEvidence([OLD_SHA, SECOND_OLD_SHA]);

    await expect(
      questStore.replaceQuestCodeCommitEvidenceForOwner(
        "q-1",
        { kind: "takode", sessionId: "worker-1" },
        replacementInput({
          expectedCommitShas: [SECOND_OLD_SHA, OLD_SHA],
          replacementCommitShas: [NEW_SHA, APPENDED_SHA],
        }),
      ),
    ).rejects.toThrow("expected ordered commits");
    await expect(
      questStore.replaceQuestCodeCommitEvidenceForOwner(
        "q-1",
        { kind: "codex", sessionId: "worker-1" },
        replacementInput({
          expectedCommitShas: [OLD_SHA, SECOND_OLD_SHA],
          replacementCommitShas: [NEW_SHA, APPENDED_SHA],
        }),
      ),
    ).rejects.toThrow("exact active quest owner");
    expect((await questStore.getQuest("q-1"))?.codeCommitEvidenceReplacementEvents).toBeUndefined();

    await questStore.completeQuest("q-1", []);
    await expect(
      questStore.replaceQuestCodeCommitEvidenceForOwner(
        "q-1",
        { kind: "takode", sessionId: "worker-1" },
        replacementInput({
          expectedCommitShas: [OLD_SHA, SECOND_OLD_SHA],
          replacementCommitShas: [NEW_SHA, APPENDED_SHA],
        }),
      ),
    ).rejects.toThrow("in-progress quest");
  });

  it.each([
    ["empty expected evidence", { expectedCommitShas: [] }, "Existing code commit evidence must be non-empty"],
    ["empty replacement evidence", { replacementCommitShas: [] }, "Replacement code commit evidence must be non-empty"],
    [
      "shorter replacement evidence",
      { expectedCommitShas: [OLD_SHA, SECOND_OLD_SHA], replacementCommitShas: [NEW_SHA] },
      "cannot contain fewer commits",
    ],
    [
      "too many commits",
      {
        expectedCommitShas: Array.from({ length: 51 }, (_, index) => index.toString(16).padStart(40, "0")),
        replacementCommitShas: Array.from({ length: 51 }, (_, index) => (index + 51).toString(16).padStart(40, "0")),
      },
      "at most 50 commits",
    ],
    ["unchanged evidence", { replacementCommitShas: [OLD_SHA] }, "must differ"],
    ["blank reason", { reason: " " }, "replacement reason is required"],
    ["overlong reason", { reason: "x".repeat(1001) }, "1000 characters or fewer"],
    ["blank run", { journeyRunId: " " }, "journeyRunId is required"],
    ["blank occurrence", { phaseOccurrenceId: " " }, "phaseOccurrenceId is required"],
    ["blank target branch", { verifiedTargetBranch: " " }, "Verified target branch is required"],
    ["abbreviated target head", { verifiedTargetHeadSha: "abc1234" }, "full 40-character commit SHA"],
  ])("rejects %s", async (_label, overrides, expectedError) => {
    await createActiveQuestWithEvidence();

    await expect(
      questStore.replaceQuestCodeCommitEvidenceForOwner(
        "q-1",
        { kind: "takode", sessionId: "worker-1" },
        replacementInput(overrides),
      ),
    ).rejects.toThrow(expectedError);
    expect((await questStore.getQuest("q-1"))?.commitShas).toEqual([OLD_SHA]);
  });

  it("preserves the correction audit when the quest is cancelled", async () => {
    await createActiveQuestWithEvidence();
    await questStore.replaceQuestCodeCommitEvidenceForOwner(
      "q-1",
      { kind: "takode", sessionId: "worker-1" },
      replacementInput(),
    );

    const cancelled = await questStore.cancelQuest("q-1", "No longer needed");
    expect(cancelled?.codeCommitEvidenceReplacementEvents).toHaveLength(1);
    expect(cancelled?.commitShas).toEqual([NEW_SHA]);
  });

  it("uses the live-store mutation journal and persists the change and audit records atomically", async () => {
    writeLiveStoreFixture({ commitShas: [OLD_SHA] });

    await questStore.replaceQuestCodeCommitEvidenceForOwner(
      "q-1",
      { kind: "takode", sessionId: "worker-1" },
      replacementInput(),
    );

    const persisted = readQuestFixture(join(tempDir, ".companion"), "q-1");
    expect(persisted?.commitShas).toEqual([NEW_SHA]);
    expect(persisted?.codeCommitEvidenceReplacementEvents).toHaveLength(1);

    const journalDir = join(tempDir, ".companion", "questmaster-backups", "text", "journal");
    const journalFiles = readdirSync(journalDir);
    expect(journalFiles).toHaveLength(1);
    const records = readFileSync(join(journalDir, journalFiles[0]!), "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records).toHaveLength(1);
    // The journal records the change; the earlier SHAs stay in the audit event and the preceding snapshot.
    expect(records[0].quests[0].set.commitShas).toEqual([NEW_SHA]);
    expect(records[0].quests[0].set.codeCommitEvidenceReplacementEvents).toHaveLength(1);
    expect(JSON.stringify(records[0].quests[0].set.codeCommitEvidenceReplacementEvents)).toContain(OLD_SHA);
  });

  it("normalizes valid persisted correction events and drops malformed audit rows", async () => {
    writeLiveStoreFixture({
      commitShas: [NEW_SHA],
      codeCommitEvidenceReplacementEvents: [
        {
          operation: "replace_code_commit_evidence",
          actorSessionId: " worker-1 ",
          reason: " corrected evidence ",
          previousCommitShas: [OLD_SHA.toUpperCase()],
          replacementCommitShas: [NEW_SHA.toUpperCase(), NEW_SHA],
          journeyRunId: " run-1 ",
          phaseOccurrenceId: " run-1:p1 ",
          verifiedTargetBranch: " jiayi ",
          verifiedTargetHeadSha: NEW_SHA.toUpperCase(),
          ts: 123,
        },
        {
          operation: "replace_code_commit_evidence",
          actorSessionId: "worker-1",
          reason: "shrinks evidence",
          previousCommitShas: [OLD_SHA, SECOND_OLD_SHA],
          replacementCommitShas: [NEW_SHA],
          journeyRunId: "run-1",
          phaseOccurrenceId: "run-1:p1",
          verifiedTargetBranch: "jiayi",
          verifiedTargetHeadSha: NEW_SHA,
          ts: 124,
        },
        {
          operation: "replace_code_commit_evidence",
          actorSessionId: "worker-1",
          reason: "",
          previousCommitShas: [OLD_SHA],
          replacementCommitShas: [NEW_SHA],
          journeyRunId: "run-1",
          phaseOccurrenceId: "run-1:p1",
          verifiedTargetBranch: "jiayi",
          verifiedTargetHeadSha: NEW_SHA,
          ts: 124,
        },
        {
          operation: "replace_code_commit_evidence",
          actorSessionId: "worker-1",
          reason: "x".repeat(1001),
          previousCommitShas: [OLD_SHA],
          replacementCommitShas: [NEW_SHA],
          journeyRunId: "run-1",
          phaseOccurrenceId: "run-1:p1",
          verifiedTargetBranch: "jiayi",
          verifiedTargetHeadSha: NEW_SHA,
          ts: 125,
        },
      ],
    });

    const quest = await questStore.getQuest("q-1");
    expect(quest?.codeCommitEvidenceReplacementEvents).toEqual([
      {
        operation: "replace_code_commit_evidence",
        actorSessionId: "worker-1",
        reason: "corrected evidence",
        previousCommitShas: [OLD_SHA],
        replacementCommitShas: [NEW_SHA],
        journeyRunId: "run-1",
        phaseOccurrenceId: "run-1:p1",
        verifiedTargetBranch: "jiayi",
        verifiedTargetHeadSha: NEW_SHA,
        ts: 123,
      },
    ]);
  });
});
