import { compareSearchRanks, normalizeForSearch, rankSearchFields } from "../../shared/search-utils.js";
import type { QuestFeedbackEntry, QuestmasterTask } from "../types.js";
import { getQuestDebrief, getQuestDebriefTldr, getQuestFeedback } from "./quest-editor-helpers.js";

type SearchRank = NonNullable<ReturnType<typeof rankSearchFields>>;

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
  if (words.length === 0) return null;
  const fields: SearchField[] = [
    { rank: 0, text: quest.questId },
    { rank: 1, text: quest.title },
    { rank: 2, text: (quest.tags ?? []).join(" ") },
    { rank: 3, text: quest.tldr },
    { rank: 4, text: "description" in quest ? quest.description : undefined },
    { rank: 5, text: getQuestDebriefTldr(quest) },
    { rank: 6, text: getQuestDebrief(quest) },
    ...getQuestFeedback(quest).flatMap((entry) => questFeedbackSearchFields(entry)),
  ];

  return rankSearchFields(fields, query);
}

function questFeedbackSearchFields(entry: QuestFeedbackEntry): SearchField[] {
  return [
    { rank: 7, text: entry.tldr },
    { rank: 8, text: entry.text },
  ];
}

function compareSearchRank(left: SearchRank, right: SearchRank): number {
  return compareSearchRanks(left, right);
}

function compareQuestIds(left: QuestmasterTask, right: QuestmasterTask): number {
  return left.questId.localeCompare(right.questId, undefined, { numeric: true, sensitivity: "base" });
}
