import type { QuestRelatedQuestKind, QuestmasterTask } from "../server/quest-types.js";

const LABELS: Record<QuestRelatedQuestKind, string> = {
  follow_up_of: "Follow-up of",
  has_follow_up: "Has follow-up",
  referenced_by: "Referenced by",
  references: "References",
};

export function formatQuestRelationships(quest: QuestmasterTask): string[] {
  const related = quest.relatedQuests ?? [];
  if (related.length === 0) return [];
  const lines = ["Relationships:"];
  for (const entry of related) {
    const source = entry.explicit ? "explicit" : "detected";
    lines.push(`  ${LABELS[entry.kind]}: ${entry.questId} (${source})`);
  }
  return lines;
}
