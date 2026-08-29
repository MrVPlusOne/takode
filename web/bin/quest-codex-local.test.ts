import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QuestmasterTask } from "../server/quest-types.js";

const storeMocks = vi.hoisted(() => ({
  appendQuestFeedback: vi.fn(),
  getQuest: vi.fn(),
  patchQuestForOwner: vi.fn(),
}));

vi.mock("../server/quest-store.js", () => storeMocks);

import { editCodexQuestFeedback, toggleCodexQuestFeedbackAddressed } from "./quest-codex-local.js";

const context = {
  sessionId: "codex-task",
  turnId: "turn-1",
  toolUseId: "tool-1",
  cwd: "/repo",
};

function directQuest(): QuestmasterTask {
  return {
    id: "q-1-v1",
    questId: "q-1",
    version: 1,
    title: "Direct Codex quest",
    createdAt: 1,
    status: "in_progress",
    description: "Test direct feedback mutations.",
    ownerKind: "codex",
    sessionId: "codex-task",
    claimedAt: 1,
    feedback: [
      { author: "human", text: "", ts: 1, deletedAt: 2 },
      { author: "agent", text: "Live feedback", ts: 3 },
    ],
  } as QuestmasterTask;
}

describe("direct Codex feedback tombstones", () => {
  beforeEach(() => {
    storeMocks.appendQuestFeedback.mockReset();
    storeMocks.getQuest.mockReset();
    storeMocks.patchQuestForOwner.mockReset();
  });

  it("rejects editing or addressing a deleted feedback slot", async () => {
    storeMocks.getQuest.mockResolvedValue(directQuest());

    await expect(editCodexQuestFeedback(context, "q-1", 0, { text: "Resurrected" })).rejects.toThrow(
      "Feedback entry was deleted",
    );
    await expect(toggleCodexQuestFeedbackAddressed(context, "q-1", 0)).rejects.toThrow("Feedback entry was deleted");
    expect(storeMocks.patchQuestForOwner).not.toHaveBeenCalled();
  });

  it("keeps a later live entry at its original raw index", async () => {
    storeMocks.getQuest.mockResolvedValue(directQuest());
    storeMocks.patchQuestForOwner.mockImplementation(async (_questId, _owner, patch) => patch);

    await editCodexQuestFeedback(context, "q-1", 1, { text: "Updated live feedback" });

    expect(storeMocks.patchQuestForOwner).toHaveBeenCalledWith(
      "q-1",
      expect.objectContaining({ kind: "codex", sessionId: "codex-task" }),
      expect.objectContaining({
        feedback: [
          expect.objectContaining({ deletedAt: 2, text: "" }),
          expect.objectContaining({ text: "Updated live feedback" }),
        ],
      }),
    );
  });
});
