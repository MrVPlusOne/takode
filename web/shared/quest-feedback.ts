import type { QuestFeedbackEntry } from "../server/quest-types.js";

export interface IndexedQuestFeedbackEntry extends QuestFeedbackEntry {
  index: number;
}

export function isDeletedQuestFeedbackEntry(entry: QuestFeedbackEntry | undefined): boolean {
  return typeof entry?.deletedAt === "number";
}

export function liveQuestFeedbackEntries(entries: readonly QuestFeedbackEntry[] | undefined): QuestFeedbackEntry[] {
  return (entries ?? []).filter((entry) => !isDeletedQuestFeedbackEntry(entry));
}

export function indexedLiveQuestFeedbackEntries(
  entries: readonly QuestFeedbackEntry[] | undefined,
): IndexedQuestFeedbackEntry[] {
  return (entries ?? []).flatMap((entry, index) => (isDeletedQuestFeedbackEntry(entry) ? [] : [{ ...entry, index }]));
}

export function liveQuestFeedbackEntryAt(
  entries: readonly QuestFeedbackEntry[] | undefined,
  index: number,
): QuestFeedbackEntry | undefined {
  const entry = entries?.[index];
  return isDeletedQuestFeedbackEntry(entry) ? undefined : entry;
}

export function tombstoneQuestFeedbackEntry(entry: QuestFeedbackEntry, deletedAt: number): QuestFeedbackEntry {
  return {
    ...(entry.entryId ? { entryId: entry.entryId } : {}),
    author: entry.author,
    text: "",
    ts: entry.ts,
    deletedAt,
  };
}
