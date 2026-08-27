import { describe, expect, it } from "vitest";
import { evaluateQuestStatusMutationGuard, getQuestStatusOwnerSessionIds } from "./quest-status-guard.js";
import type { QuestmasterTask } from "./quest-types.js";

function inProgressQuest(ownerKind?: "codex"): QuestmasterTask {
  return {
    id: "q-1",
    questId: "q-1",
    version: 1,
    title: "Provider-aware guard",
    status: "in_progress",
    description: "Guard provider identity.",
    sessionId: "same-id",
    ...(ownerKind ? { ownerKind } : {}),
    claimedAt: 2,
    createdAt: 1,
  };
}

describe("quest status ownership guard", () => {
  it("keeps missing ownerKind compatible with Takode sessions", () => {
    // Legacy records intentionally omit ownerKind, so the existing owner is
    // still authorized without requiring a data rewrite.
    const quest = inProgressQuest();

    expect(getQuestStatusOwnerSessionIds(quest)).toEqual(["same-id"]);
    expect(evaluateQuestStatusMutationGuard(quest, { callerSessionId: "same-id" })).toEqual({ ok: true });
  });

  it("does not authorize a Takode caller that shares a Codex owner's raw ID", () => {
    // Provider identity is part of ownership. Leader and target-session
    // shortcuts must not turn a raw-ID collision into Codex quest authority.
    const quest = inProgressQuest("codex");

    expect(getQuestStatusOwnerSessionIds(quest)).toEqual([]);
    expect(
      evaluateQuestStatusMutationGuard(quest, {
        callerSessionId: "same-id",
        callerIsLeader: true,
        callerLeadsCurrentOwner: true,
        targetSessionId: "same-id",
      }),
    ).toMatchObject({ ok: false, message: expect.stringContaining("direct Codex task") });
  });

  it("uses the newest provider-aware historical owner for done quests", () => {
    // Legacy Takode history may contain the same raw ID as a later Codex owner;
    // status routing follows the newest provider-aware record instead.
    const quest: QuestmasterTask = {
      id: "q-1",
      questId: "q-1",
      version: 1,
      title: "Provider-aware guard",
      status: "done",
      description: "Guard provider identity.",
      claimedAt: 2,
      createdAt: 1,
      completedAt: 3,
      verificationItems: [],
      previousOwnerSessionIds: ["same-id"],
      previousOwners: [
        { kind: "takode", sessionId: "same-id" },
        { kind: "codex", sessionId: "same-id" },
      ],
    };

    expect(getQuestStatusOwnerSessionIds(quest)).toEqual([]);
    expect(evaluateQuestStatusMutationGuard(quest, { callerSessionId: "same-id" }).ok).toBe(false);
  });
});
