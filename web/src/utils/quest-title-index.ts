import type { QuestTitlePreview, QuestmasterTask } from "../types.js";

interface QuestTitleCandidate {
  title: string;
  version: number;
  updatedAt: number;
  sourceRank: number;
}

function normalizedQuestTitle(title: string | undefined): string {
  return title?.trim() ?? "";
}

export function isQuestIdOnlyTitle(title: string | undefined, questId: string): boolean {
  const normalizedTitle = normalizedQuestTitle(title).toLowerCase();
  const normalizedQuestId = questId.trim().toLowerCase();
  if (!normalizedTitle || !normalizedQuestId) return true;
  if (normalizedTitle === normalizedQuestId) return true;
  return (
    normalizedTitle === `${normalizedQuestId} ${normalizedQuestId}` ||
    normalizedTitle === `${normalizedQuestId}: ${normalizedQuestId}`
  );
}

function taskCandidate(task: QuestmasterTask, sourceRank: number): QuestTitleCandidate | null {
  const title = normalizedQuestTitle(task.title);
  if (isQuestIdOnlyTitle(title, task.questId)) return null;
  return {
    title,
    version: typeof task.version === "number" ? task.version : 0,
    updatedAt: task.updatedAt ?? task.statusChangedAt ?? task.createdAt ?? 0,
    sourceRank,
  };
}

function previewCandidate(preview: QuestTitlePreview): QuestTitleCandidate | null {
  const title = normalizedQuestTitle(preview.title);
  if (isQuestIdOnlyTitle(title, preview.questId)) return null;
  return {
    title,
    version: preview.version,
    updatedAt: preview.updatedAt ?? 0,
    sourceRank: 3,
  };
}

function shouldReplaceTitle(current: QuestTitleCandidate | undefined, incoming: QuestTitleCandidate): boolean {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  if (incoming.updatedAt !== current.updatedAt) return incoming.updatedAt > current.updatedAt;
  return incoming.sourceRank >= current.sourceRank;
}

export function selectCanonicalQuestTitle({
  questId,
  listQuest,
  detailQuest,
  titlePreview,
  titlePreviewKnown = false,
}: {
  questId: string;
  listQuest?: QuestmasterTask | null;
  detailQuest?: QuestmasterTask | null;
  titlePreview?: QuestTitlePreview | null;
  titlePreviewKnown?: boolean;
}): string | null {
  let candidate: QuestTitleCandidate | undefined;
  const merge = (incoming: QuestTitleCandidate | null) => {
    if (incoming && shouldReplaceTitle(candidate, incoming)) candidate = incoming;
  };
  if (listQuest) merge(taskCandidate(listQuest, 1));
  if (detailQuest) merge(taskCandidate(detailQuest, 2));
  if (titlePreviewKnown) {
    if (!titlePreview) return null;
    merge(previewCandidate(titlePreview));
  }
  return candidate?.title ?? null;
}

/**
 * Build one canonical quest-title index from progressively loaded Questmaster
 * bodies and the bounded title-only projection used by retained leader tabs.
 * Later fallback-shaped records never erase an existing real title.
 */
export function buildCanonicalQuestTitleIndex({
  quests,
  questDetails,
  questTitlePreviews,
}: {
  quests: ReadonlyArray<QuestmasterTask>;
  questDetails?: ReadonlyMap<string, QuestmasterTask>;
  questTitlePreviews?: ReadonlyMap<string, QuestTitlePreview | null>;
}): Map<string, string> {
  const candidates = new Map<string, QuestTitleCandidate>();
  const merge = (questId: string, candidate: QuestTitleCandidate | null) => {
    if (!candidate) return;
    const key = questId.trim().toLowerCase();
    if (!key || !shouldReplaceTitle(candidates.get(key), candidate)) return;
    candidates.set(key, candidate);
  };

  for (const quest of quests) merge(quest.questId, taskCandidate(quest, 1));
  for (const quest of questDetails?.values() ?? []) merge(quest.questId, taskCandidate(quest, 2));
  for (const [questId, preview] of questTitlePreviews ?? []) {
    if (!preview) {
      // An explicit missing result from the bounded server projection is a
      // tombstone for stale lower-level browser caches, not a network error.
      candidates.delete(questId.trim().toLowerCase());
      continue;
    }
    merge(preview.questId, previewCandidate(preview));
  }

  return new Map([...candidates].map(([questId, candidate]) => [questId, candidate.title]));
}

export function applyCanonicalQuestTitles<T extends { threadKey: string; questId?: string; title: string }>(
  rows: ReadonlyArray<T>,
  titleByQuestId: ReadonlyMap<string, string>,
): T[] {
  let changed = false;
  const next = rows.map((row) => {
    const questId = (row.questId ?? row.threadKey).trim().toLowerCase();
    const canonicalTitle = titleByQuestId.get(questId);
    if (!canonicalTitle || canonicalTitle === row.title) return row;
    changed = true;
    return { ...row, title: canonicalTitle };
  });
  return changed ? next : (rows as T[]);
}
