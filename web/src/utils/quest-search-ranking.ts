import { multiWordMatch, normalizeForSearch } from "../../shared/search-utils.js";
import type { QuestFeedbackEntry, QuestmasterTask } from "../types.js";
import { getQuestDebrief, getQuestDebriefTldr, getQuestFeedback } from "./quest-editor-helpers.js";

type SearchRank = [number, number, number, number];

type SearchField = {
  rank: number;
  text: string | undefined;
};

export function rankQuestsBySearchRelevance(quests: QuestmasterTask[], query: string): QuestmasterTask[] {
  const words = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return quests;

  return quests
    .map((quest) => ({ quest, rank: getQuestSearchRank(quest, query, words) }))
    .filter((entry): entry is { quest: QuestmasterTask; rank: SearchRank } => entry.rank !== null)
    .sort((left, right) => compareSearchRank(left.rank, right.rank) || compareQuestIds(left.quest, right.quest))
    .map((entry) => entry.quest);
}

function getQuestSearchRank(quest: QuestmasterTask, query: string, words: string[]): SearchRank | null {
  const fields: SearchField[] = [
    { rank: 0, text: quest.questId },
    { rank: 1, text: quest.title },
    { rank: 2, text: quest.tldr },
    { rank: 3, text: "description" in quest ? quest.description : undefined },
    { rank: 4, text: getQuestDebriefTldr(quest) },
    { rank: 5, text: getQuestDebrief(quest) },
    ...getQuestFeedback(quest).flatMap((entry) => questFeedbackSearchFields(entry)),
  ];

  let best: SearchRank | null = null;
  for (const field of fields) {
    const rank = getFieldSearchRank(field, query, words);
    if (!rank) continue;
    if (!best || compareSearchRank(rank, best) < 0) best = rank;
  }
  return best;
}

function questFeedbackSearchFields(entry: QuestFeedbackEntry): SearchField[] {
  return [
    { rank: 6, text: entry.tldr },
    { rank: 7, text: entry.text },
  ];
}

function getFieldSearchRank(field: SearchField, query: string, words: string[]): SearchRank | null {
  if (!field.text || !multiWordMatch(field.text, query)) return null;
  const normalized = normalizeForSearch(field.text);
  const phraseIndex = normalized.indexOf(normalizeForSearch(query));
  const positions = words.map((word) => normalized.indexOf(word)).filter((index) => index >= 0);
  const firstIndex = Math.min(...positions);
  const lastIndex = Math.max(...positions);
  const span = lastIndex - firstIndex;
  return [field.rank, phraseIndex >= 0 ? phraseIndex : normalized.length + span, firstIndex, normalized.length];
}

function compareSearchRank(left: SearchRank, right: SearchRank): number {
  for (const index of [0, 1, 2, 3]) {
    const diff = left[index] - right[index];
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareQuestIds(left: QuestmasterTask, right: QuestmasterTask): number {
  return left.questId.localeCompare(right.questId, undefined, { numeric: true, sensitivity: "base" });
}
