import { describe, expect, it } from "vitest";
import { formatQuestDetail } from "./quest-format.js";
import type { QuestmasterTask } from "../server/quest-types.js";

describe("formatQuestDetail ownership audit", () => {
  it("shows ownership audit events in the human-readable quest detail", () => {
    const quest: QuestmasterTask = {
      id: "q-1",
      questId: "q-1",
      version: 3,
      title: "Ownership",
      status: "in_progress",
      description: "Ready",
      createdAt: Date.now(),
      statusChangedAt: Date.now(),
      sessionId: "new-worker",
      claimedAt: Date.now(),
      previousOwnerSessionIds: ["old-worker"],
      ownershipEvents: [
        {
          operation: "force_claim",
          actorSessionId: "new-worker",
          previousOwnerSessionId: "old-worker",
          newOwnerSessionId: "new-worker",
          ts: Date.now(),
          reason: "board assigned this phase",
        },
      ],
    };

    const detail = formatQuestDetail(quest);

    expect(detail).toContain("Ownership:   1 event(s)");
    expect(detail).toContain("force_claim");
    expect(detail).toContain("old-work -> new-work by new-work");
    expect(detail).toContain("reason: board assigned this phase");
  });
});
