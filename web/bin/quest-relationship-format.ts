import type { QuestRelatedQuestKind, QuestmasterTask } from "../server/quest-types.js";

const LABELS: Record<QuestRelatedQuestKind, string> = {
  follow_up_of: "Follow-up of",
  has_follow_up: "Has follow-up",
  referenced_by: "Referenced by",
  references: "References",
};

export function formatQuestRelationships(quest: QuestmasterTask): string[] {
  const related = quest.relatedQuests ?? [];
  const startedFrom = quest.relationships?.startedFrom;
  if (related.length === 0 && !startedFrom) return [];
  const lines = ["Relationships:"];
  if (startedFrom) {
    const thread = startedFrom.threadKey === "main" ? "Main" : startedFrom.threadKey;
    lines.push(`  Started from: user message in ${thread} (${new Date(startedFrom.timestamp).toLocaleString()})`);
  }
  for (const entry of related) {
    const source = entry.explicit ? "explicit" : "detected";
    lines.push(`  ${LABELS[entry.kind]}: ${entry.questId} (${source})`);
  }
  return lines;
}
