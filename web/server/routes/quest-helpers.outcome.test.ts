import { describe, expect, it } from "vitest";
import type { QuestInProgress, QuestTitlePreview } from "../quest-types.js";
import { buildQuestTitlePreview } from "./quest-helpers.js";

function revision(revisionId: string, createdAt: number) {
  return {
    revisionId,
    markdown: `${revisionId} outcome.`,
    summaryMarkdown: `${revisionId} outcome.`,
    summarySource: "derived" as const,
    contentHash: `${revisionId}-hash`,
    createdAt,
    actor: { kind: "human" as const },
    sources: [],
  };
}

describe("Quest title Outcome freshness", () => {
  it("projects a monotonic Outcome revision token even when revisions share one millisecond", () => {
    const quest: QuestInProgress = {
      id: "q-42",
      questId: "q-42",
      version: 2,
      title: "Outcome preview",
      description: "Test",
      status: "in_progress",
      sessionId: "worker",
      claimedAt: 1,
      createdAt: 1,
      updatedAt: 50,
      outcome: {
        currentRevisionId: "r2",
        revisions: [revision("r1", 50), { ...revision("r2", 50), parentRevisionId: "r1" }],
      },
    };

    expect((buildQuestTitlePreview(quest) as QuestTitlePreview & { outcomeRevision?: number }).outcomeRevision).toBe(2);
  });
});
