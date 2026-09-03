import { describe, expect, it } from "vitest";
import type { QuestInProgress } from "../quest-types.js";
import { buildQuestTitlePreview } from "./quest-helpers.js";

describe("legacy Quest Outcome title-preview isolation", () => {
  it("does not expose revision data from opaque legacy payloads", () => {
    const quest: QuestInProgress = {
      id: "q-42",
      questId: "q-42",
      version: 2,
      title: "Legacy preview isolation",
      description: "Test",
      status: "in_progress",
      sessionId: "worker",
      claimedAt: 1,
      createdAt: 1,
      updatedAt: 50,
      outcome: {
        currentRevisionId: "r2",
        revisions: [{ revisionId: "r1" }, { revisionId: "r2", future: true }],
      },
    };

    const preview = buildQuestTitlePreview(quest);
    expect(preview).toEqual({
      questId: "q-42",
      title: "Legacy preview isolation",
      version: 2,
      updatedAt: 50,
      commitShas: [],
    });
    expect(preview).not.toHaveProperty("outcomeRevision");
  });
});
