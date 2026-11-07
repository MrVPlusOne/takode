import type {
  QuestRelatedQuest,
  QuestRelatedQuestKind,
  QuestRelationships,
  QuestStartedFrom,
  QuestmasterTask,
} from "./quest-types.js";
import { liveQuestFeedbackEntries } from "../shared/quest-feedback.js";

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
  const raw = value as { followUpOf?: unknown; startedFrom?: unknown };
  const followUpOf = normalizeQuestIdList(raw.followUpOf, ownQuestId);
  const startedFrom = normalizeStartedFrom(raw.startedFrom);
  if (followUpOf.length === 0 && !startedFrom) return undefined;
  return { ...(followUpOf.length > 0 ? { followUpOf } : {}), ...(startedFrom ? { startedFrom } : {}) };
}

/**
 * Apply a relationships edit key by key, so clearing follow-ups keeps the message a quest
 * was started from and recording that message keeps the follow-ups.
 */
export function mergeQuestRelationships(
  current: QuestRelationships | undefined,
  edit: QuestRelationships,
  ownQuestId?: string,
): QuestRelationships | undefined {
  return normalizeQuestRelationships({ ...current, ...edit }, ownQuestId);
}

function normalizeStartedFrom(value: unknown): QuestStartedFrom | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<Record<keyof QuestStartedFrom, unknown>>;
  const text = (field: unknown) => (typeof field === "string" && field.trim() ? field.trim() : null);
  const sessionId = text(raw.sessionId);
  const messageId = text(raw.messageId);
  const threadKey = text(raw.threadKey)?.toLowerCase();
  if (!sessionId || !messageId || !threadKey) return undefined;
  if (typeof raw.timestamp !== "number" || !Number.isFinite(raw.timestamp)) return undefined;
  return { sessionId, messageId, threadKey, timestamp: raw.timestamp };
}

export function stripDerivedQuestRelationships<T extends QuestmasterTask | null | undefined>(quest: T): T {
  if (!quest || !("relatedQuests" in quest)) return quest;
  const { relatedQuests: _relatedQuests, ...rest } = quest as MutableQuest;
  return rest as T;
}

export function withQuestRelationshipSummaries<T extends QuestmasterTask>(quests: T[]): T[] {
  const knownQuestIds = new Set(quests.map((quest) => quest.questId.toLowerCase()));
  const relatedByQuestId: RelatedByQuestId = new Map();
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
    for (const targetQuestId of questReferences(quest)) {
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
    const relatedQuests = relatedByQuestId.get(quest.questId.toLowerCase())?.entries;
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

/** Text references per quest object. Only frozen (cached, immutable) quests are memoized. */
const referencesByQuest = new WeakMap<QuestmasterTask, string[]>();

function questReferences(quest: QuestmasterTask): string[] {
  if (!Object.isFrozen(quest)) return extractQuestReferencesFromQuest(quest);
  let references = referencesByQuest.get(quest);
  if (!references) {
    references = extractQuestReferencesFromQuest(quest);
    referencesByQuest.set(quest, references);
  }
  return references;
}

function extractQuestReferencesFromQuest(quest: QuestmasterTask): string[] {
  const textParts = [
    quest.title,
    quest.tldr,
    "description" in quest ? quest.description : undefined,
    quest.status === "done" ? quest.debrief : undefined,
    quest.status === "done" ? quest.debriefTldr : undefined,
    "notes" in quest ? quest.notes : undefined,
    ...liveQuestFeedbackEntries(quest.feedback).flatMap((entry) => [entry.text, entry.tldr]),
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

/** Each quest's related quests, with the (quest, kind) pairs already listed, so a quest with many links adds each in constant time. */
type RelatedByQuestId = Map<string, { entries: QuestRelatedQuest[]; seen: Set<string> }>;

function addRelated(map: RelatedByQuestId, questId: string, entry: QuestRelatedQuest): void {
  const key = questId.toLowerCase();
  let related = map.get(key);
  if (!related) map.set(key, (related = { entries: [], seen: new Set() }));
  const seenKey = `${entry.kind}\0${entry.questId.toLowerCase()}`;
  if (related.seen.has(seenKey)) return;
  related.seen.add(seenKey);
  related.entries.push(entry);
}

function sortRelatedQuests(entries: QuestRelatedQuest[]): QuestRelatedQuest[] {
  const kindRank: Record<QuestRelatedQuestKind, number> = {
    follow_up_of: 0,
    has_follow_up: 1,
    referenced_by: 2,
    references: 3,
  };
  // Quest numbers are parsed once per entry rather than in every comparison: a quest with thousands of links
  // otherwise spent most of each store write parsing them.
  return entries
    .map((entry) => ({ entry, rank: kindRank[entry.kind], number: questIdNumber(entry.questId) }))
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.number - right.number ||
        left.entry.questId.localeCompare(right.entry.questId, undefined, { numeric: true }),
    )
    .map(({ entry }) => entry);
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
