import type { QuestRelatedQuest, QuestRelatedQuestKind, QuestRelationships, QuestmasterTask } from "./quest-types.js";

type MutableQuest = QuestmasterTask & {
  relatedQuests?: QuestRelatedQuest[];
  relationships?: QuestRelationships;
};

const QUEST_REFERENCE_RE = /\bq-(\d+)\b/gi;

export function normalizeQuestRelationshipId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^q-(\d+)$/i.exec(value.trim());
  return match ? `q-${Number.parseInt(match[1], 10)}` : null;
}

export function normalizeQuestRelationships(value: unknown, ownQuestId?: string): QuestRelationships | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as { followUpOf?: unknown };
  const followUpOf = normalizeQuestIdList(raw.followUpOf, ownQuestId);
  return followUpOf.length > 0 ? { followUpOf } : undefined;
}

export function stripDerivedQuestRelationships<T extends QuestmasterTask | null | undefined>(quest: T): T {
  if (!quest || !("relatedQuests" in quest)) return quest;
  const { relatedQuests: _relatedQuests, ...rest } = quest as MutableQuest;
  return rest as T;
}

export function withQuestRelationshipSummaries<T extends QuestmasterTask>(quests: T[]): T[] {
  const knownQuestIds = new Set(quests.map((quest) => quest.questId.toLowerCase()));
  const relatedByQuestId = new Map<string, QuestRelatedQuest[]>();
  const explicitlyRelatedPairs = new Set<string>();

  for (const quest of quests) {
    for (const targetQuestId of quest.relationships?.followUpOf ?? []) {
      if (!knownQuestIds.has(targetQuestId.toLowerCase()) || sameQuestId(quest.questId, targetQuestId)) continue;
      addRelated(relatedByQuestId, quest.questId, {
        questId: targetQuestId,
        kind: "follow_up_of",
        explicit: true,
      });
      addRelated(relatedByQuestId, targetQuestId, {
        questId: quest.questId,
        kind: "has_follow_up",
        explicit: true,
      });
      explicitlyRelatedPairs.add(pairKey(quest.questId, targetQuestId));
    }
  }

  for (const quest of quests) {
    for (const targetQuestId of extractQuestReferencesFromQuest(quest)) {
      if (!knownQuestIds.has(targetQuestId.toLowerCase()) || sameQuestId(quest.questId, targetQuestId)) continue;
      if (explicitlyRelatedPairs.has(pairKey(quest.questId, targetQuestId))) continue;
      addRelated(relatedByQuestId, quest.questId, {
        questId: targetQuestId,
        kind: "references",
        explicit: false,
      });
      addRelated(relatedByQuestId, targetQuestId, {
        questId: quest.questId,
        kind: "referenced_by",
        explicit: false,
      });
    }
  }

  return quests.map((quest) => {
    const relatedQuests = relatedByQuestId.get(quest.questId.toLowerCase());
    if (!relatedQuests?.length) return stripDerivedQuestRelationships(quest);
    return { ...stripDerivedQuestRelationships(quest), relatedQuests: sortRelatedQuests(relatedQuests) };
  });
}

export function questRelationshipSearchText(quest: QuestmasterTask): string {
  const related = quest.relatedQuests ?? [];
  const explicit = quest.relationships?.followUpOf ?? [];
  return [...explicit, ...related.map((entry) => `${entry.kind} ${entry.questId}`)].join("\n");
}

function normalizeQuestIdList(value: unknown, ownQuestId?: string): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const normalized = values
    .map(normalizeQuestRelationshipId)
    .filter((questId): questId is string => !!questId && !sameQuestId(questId, ownQuestId));
  return Array.from(new Set(normalized)).sort(compareQuestIds);
}

function extractQuestReferencesFromQuest(quest: QuestmasterTask): string[] {
  const textParts = [
    quest.title,
    quest.tldr,
    "description" in quest ? quest.description : undefined,
    quest.status === "done" ? quest.debrief : undefined,
    quest.status === "done" ? quest.debriefTldr : undefined,
    "notes" in quest ? quest.notes : undefined,
    ...(quest.feedback ?? []).flatMap((entry) => [entry.text, entry.tldr]),
  ];
  const references = textParts.flatMap((text) => extractQuestReferenceIds(text));
  return Array.from(new Set(references)).sort(compareQuestIds);
}

function extractQuestReferenceIds(text: string | undefined): string[] {
  if (!text) return [];
  const matches: string[] = [];
  for (const match of text.matchAll(QUEST_REFERENCE_RE)) {
    matches.push(`q-${Number.parseInt(match[1]!, 10)}`);
  }
  return matches;
}

function addRelated(map: Map<string, QuestRelatedQuest[]>, questId: string, entry: QuestRelatedQuest): void {
  const key = questId.toLowerCase();
  const existing = map.get(key) ?? [];
  if (existing.some((candidate) => sameQuestId(candidate.questId, entry.questId) && candidate.kind === entry.kind)) {
    return;
  }
  map.set(key, [...existing, entry]);
}

function sortRelatedQuests(entries: QuestRelatedQuest[]): QuestRelatedQuest[] {
  const kindRank: Record<QuestRelatedQuestKind, number> = {
    follow_up_of: 0,
    has_follow_up: 1,
    referenced_by: 2,
    references: 3,
  };
  return [...entries].sort((left, right) => {
    const kindDiff = kindRank[left.kind] - kindRank[right.kind];
    return kindDiff || compareQuestIds(left.questId, right.questId);
  });
}

function pairKey(leftQuestId: string, rightQuestId: string): string {
  return [leftQuestId, rightQuestId]
    .map((questId) => questId.toLowerCase())
    .sort()
    .join("\0");
}

function sameQuestId(left: string | undefined, right: string | undefined): boolean {
  return !!left && !!right && left.toLowerCase() === right.toLowerCase();
}

function compareQuestIds(left: string, right: string): number {
  return questIdNumber(left) - questIdNumber(right) || left.localeCompare(right, undefined, { numeric: true });
}

function questIdNumber(questId: string): number {
  const match = /^q-(\d+)$/i.exec(questId);
  return match ? Number.parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
}
