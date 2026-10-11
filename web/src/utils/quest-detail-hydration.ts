import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";

const questDetailFetches = new Map<string, Promise<QuestmasterTask | null>>();

function cachedQuestDetail(questId: string): QuestmasterTask | null {
  const key = questId.trim().toLowerCase();
  const state = useStore.getState();
  return state.questDetails?.get(key) ?? state.quests?.find((quest) => quest.questId.toLowerCase() === key) ?? null;
}

/**
 * A cached full quest body that a preview may show while it revalidates, or null when there is
 * none or a newer live version (pushed with quest updates) shows the cached body is out of date.
 */
export function currentCachedQuestDetail(questId: string): QuestmasterTask | null {
  const key = questId.trim().toLowerCase();
  const state = useStore.getState();
  const cached = state.questDetails?.get(key);
  if (!cached) return null;
  const live = state.questTitlePreviews?.get(key);
  if (live === null) return null;
  return live && live.version > cached.version ? null : cached;
}

/** Revalidate one full quest body for a rich hover/detail surface, deduped by id + ETag. */
export function hydrateQuestDetail(questId: string): Promise<QuestmasterTask | null> {
  const key = questId.trim().toLowerCase();
  const state = useStore.getState();
  const currentEtag = state.questDetailEtags?.get(key) ?? null;
  const getQuestValidated = api.getQuestValidated;
  if (typeof getQuestValidated !== "function") return Promise.resolve(cachedQuestDetail(questId));
  const fetchKey = `${key}\0${currentEtag ?? ""}`;
  const existing = questDetailFetches.get(fetchKey);
  if (existing) return existing;

  const request = getQuestValidated(questId, currentEtag)
    .then((result) => {
      if (result.status === "fresh") {
        useStore.getState().upsertQuestDetail?.(result.data, { etag: result.etag });
        return result.data;
      }
      return cachedQuestDetail(questId);
    })
    .finally(() => {
      if (questDetailFetches.get(fetchKey) === request) questDetailFetches.delete(fetchKey);
    });

  questDetailFetches.set(fetchKey, request);
  return request;
}
