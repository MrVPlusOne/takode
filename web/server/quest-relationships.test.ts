import type { QuestmasterTask } from "./quest-types.js";
import { normalizeQuestRelationships, withQuestRelationshipSummaries } from "./quest-relationships.js";

function quest(overrides: Partial<QuestmasterTask> & { questId: string; title: string }): QuestmasterTask {
  const { questId, title, ...rest } = overrides;
  return {
    id: `${questId}-v1`,
    questId,
    version: 1,
    status: "idea",
    title,
    createdAt: 1,
    ...rest,
  } as QuestmasterTask;
}

describe("quest relationship summaries", () => {
  it("derives explicit follow-up direction and reverse links", () => {
    // Validates explicit persisted follow-up data produces both forward and reverse read-model links.
    const earlier = quest({ questId: "q-1", title: "Original" });
    const followUp = quest({
      questId: "q-2",
      title: "Follow-up",
      relationships: { followUpOf: ["q-1"] },
    });

    const [first, second] = withQuestRelationshipSummaries([earlier, followUp]);

    expect(first.relatedQuests).toEqual([{ questId: "q-2", kind: "has_follow_up", explicit: true }]);
    expect(second.relatedQuests).toEqual([{ questId: "q-1", kind: "follow_up_of", explicit: true }]);
  });

  it("adds detected reference backlinks without duplicating explicit follow-ups", () => {
    // Guards the supplemental backlink rule: text references are useful unless an explicit relationship already covers the pair.
    const target = quest({ questId: "q-1", title: "Original" });
    const explicit = quest({
      questId: "q-2",
      title: "Explicit follow-up mentions q-1",
      relationships: { followUpOf: ["q-1"] },
    });
    const detected = quest({
      questId: "q-3",
      title: "Related context",
      description: "This references [q-1](quest:q-1) for prior context.",
    });

    const [first, second, third] = withQuestRelationshipSummaries([target, explicit, detected]);

    expect(first.relatedQuests).toEqual([
      { questId: "q-2", kind: "has_follow_up", explicit: true },
      { questId: "q-3", kind: "referenced_by", explicit: false },
    ]);
    expect(second.relatedQuests).toEqual([{ questId: "q-1", kind: "follow_up_of", explicit: true }]);
    expect(third.relatedQuests).toEqual([{ questId: "q-1", kind: "references", explicit: false }]);
  });

  it("normalizes relationship IDs and drops self-links", () => {
    // Keeps storage canonical so CLI/user input like Q-001 does not create duplicate relationship IDs.
    expect(normalizeQuestRelationships({ followUpOf: ["Q-001", "q-1", "q-2", "bad"] }, "q-2")).toEqual({
      followUpOf: ["q-1"],
    });
  });
});
