import { describe, expect, it } from "vitest";
import type { QuestmasterTask } from "../types.js";
import { findSessionQuestContextCandidate } from "./session-quest-context.js";

function findFor(sessionId: string, quests: QuestmasterTask[]) {
  return findSessionQuestContextCandidate({
    sessionId,
    quests,
    sessionBoards: new Map(),
    sessionCompletedBoards: new Map(),
    rowStatuses: new Map(),
  });
}

describe("findSessionQuestContextCandidate owner identity", () => {
  it("does not attach a Codex-owned quest to a Takode session with the same raw ID", () => {
    const quest = {
      id: "q-1",
      questId: "q-1",
      version: 1,
      title: "Codex-owned quest",
      status: "in_progress",
      description: "Provider identity must remain distinct.",
      createdAt: 1,
      claimedAt: 2,
      ownerKind: "codex",
      sessionId: "same-id",
    } satisfies QuestmasterTask;

    expect(findFor("same-id", [quest])).toBeNull();
  });

  it("keeps legacy Takode ownership discoverable", () => {
    const quest = {
      id: "q-2",
      questId: "q-2",
      version: 1,
      title: "Legacy Takode quest",
      status: "in_progress",
      description: "Missing owner kind remains Takode.",
      createdAt: 1,
      claimedAt: 2,
      sessionId: "same-id",
    } satisfies QuestmasterTask;

    expect(findFor("same-id", [quest])?.quest?.questId).toBe("q-2");
  });
});
