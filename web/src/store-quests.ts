import type { StateCreator } from "zustand";
import { api } from "./api.js";
import { reconcileQuestList } from "./store-equality.js";
import type { AppState } from "./store-types.js";
import type { QuestAutocompleteCandidate, QuestTitlePreview, QuestmasterTask } from "./types.js";

type StoreSet = Parameters<StateCreator<AppState>>[0];
type QuestStoreSlice = Pick<
  AppState,
  | "questDetails"
  | "questDetailEtags"
  | "questTitlePreviews"
  | "quests"
  | "questAutocompleteCandidates"
  | "questAutocompleteEtag"
  | "questAutocompleteLoaded"
  | "questAutocompleteLoading"
  | "questSummary"
  | "questSummaryEtag"
  | "questsLoadedFull"
  | "questsLoading"
  | "setQuests"
  | "upsertQuestDetail"
  | "removeQuestDetail"
  | "hydrateQuestTitles"
  | "replaceQuest"
  | "refreshQuests"
  | "refreshQuestSummary"
  | "refreshQuestAutocompleteCandidates"
  | "invalidateQuestAutocompleteCandidates"
>;

function shouldPauseQuestBackgroundRefresh(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function summarizeQuestList(quests: QuestmasterTask[]): import("./api.js").QuestSummary {
  const counts = {
    all: quests.length,
    idea: 0,
    refined: 0,
    in_progress: 0,
    done: 0,
  };
  for (const quest of quests) {
    counts[quest.status] += 1;
  }
  return {
    total: counts.all,
    active: counts.idea + counts.refined + counts.in_progress,
    counts,
  };
}

function withQuestDetail(details: Map<string, QuestmasterTask>, quest: QuestmasterTask): Map<string, QuestmasterTask> {
  const key = quest.questId.toLowerCase();
  if (details.get(key) === quest) return details;
  const next = new Map(details);
  next.set(key, quest);
  return next;
}

function withoutQuestDetail(details: Map<string, QuestmasterTask>, questId: string): Map<string, QuestmasterTask> {
  const key = questId.toLowerCase();
  if (!details.has(key)) return details;
  const next = new Map(details);
  next.delete(key);
  return next;
}

function withQuestDetailEtag(etags: Map<string, string>, questId: string, etag: string | null | undefined) {
  if (!etag) return etags;
  const key = questId.toLowerCase();
  if (etags.get(key) === etag) return etags;
  const next = new Map(etags);
  next.set(key, etag);
  return next;
}

function withoutQuestDetailEtag(etags: Map<string, string>, questId: string): Map<string, string> {
  const key = questId.toLowerCase();
  if (!etags.has(key)) return etags;
  const next = new Map(etags);
  next.delete(key);
  return next;
}

function questTitlePreviewFromTask(quest: QuestmasterTask): QuestTitlePreview {
  return {
    questId: quest.questId,
    title: quest.title,
    version: quest.version,
    ...(quest.updatedAt !== undefined ? { updatedAt: quest.updatedAt } : {}),
  };
}

function shouldReplaceQuestTitlePreview(
  current: QuestTitlePreview | null | undefined,
  incoming: QuestTitlePreview,
): boolean {
  if (!current) return true;
  if (incoming.version !== current.version) return incoming.version > current.version;
  return (incoming.updatedAt ?? 0) >= (current.updatedAt ?? 0);
}

function withQuestTitlePreviews(
  previews: Map<string, QuestTitlePreview | null>,
  incoming: ReadonlyArray<QuestTitlePreview>,
  requestedQuestIds: ReadonlyArray<string> = [],
): Map<string, QuestTitlePreview | null> {
  let next: Map<string, QuestTitlePreview | null> | null = null;
  const target = () => (next ??= new Map(previews));
  const found = new Set<string>();

  for (const preview of incoming) {
    const key = preview.questId.trim().toLowerCase();
    if (!key) continue;
    found.add(key);
    if (!shouldReplaceQuestTitlePreview(previews.get(key), preview)) continue;
    const current = previews.get(key);
    if (
      current &&
      current.questId === preview.questId &&
      current.title === preview.title &&
      current.version === preview.version &&
      current.updatedAt === preview.updatedAt
    ) {
      continue;
    }
    target().set(key, preview);
  }

  for (const questId of requestedQuestIds) {
    const key = questId.trim().toLowerCase();
    if (!key || found.has(key) || previews.get(key) === null) continue;
    target().set(key, null);
  }

  return next ?? previews;
}

const QUEST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 2_000;
let pendingQuestBackgroundRefresh: Promise<void> | null = null;
let lastQuestBackgroundRefreshAt = 0;
let pendingQuestAutocompleteRefresh: Promise<void> | null = null;
const pendingQuestTitleHydrations = new Map<string, Promise<void>>();
const pendingQuestTitleForcedFollowups = new Map<Promise<void>, { questIds: Set<string>; promise: Promise<void> }>();
const QUEST_TITLE_HYDRATION_BATCH_SIZE = 50;

export function resetQuestRefreshStateForTests(): void {
  pendingQuestBackgroundRefresh = null;
  lastQuestBackgroundRefreshAt = 0;
  pendingQuestAutocompleteRefresh = null;
  pendingQuestTitleHydrations.clear();
  pendingQuestTitleForcedFollowups.clear();
}

function reconcileQuestAutocompleteCandidates(
  current: QuestAutocompleteCandidate[],
  incoming: QuestAutocompleteCandidate[],
): QuestAutocompleteCandidate[] {
  const deduped = new Map<string, QuestAutocompleteCandidate>();
  for (const candidate of incoming) {
    const questId = candidate.questId?.trim();
    if (!questId) continue;
    const key = questId.toLowerCase();
    if (deduped.has(key)) continue;
    deduped.set(key, {
      questId,
      title: candidate.title?.trim() || questId,
    });
  }
  const next = Array.from(deduped.values());
  if (
    current.length === next.length &&
    current.every((candidate, index) => {
      const nextCandidate = next[index];
      return candidate.questId === nextCandidate?.questId && candidate.title === nextCandidate.title;
    })
  ) {
    return current;
  }
  return next;
}

export function createQuestStoreSlice(set: StoreSet, getState: () => AppState): QuestStoreSlice {
  return {
    questDetails: new Map(),
    questDetailEtags: new Map(),
    questTitlePreviews: new Map(),
    quests: [],
    questAutocompleteCandidates: [],
    questAutocompleteEtag: null,
    questAutocompleteLoaded: false,
    questAutocompleteLoading: false,
    questSummary: null,
    questSummaryEtag: null,
    questsLoadedFull: false,
    questsLoading: false,
    setQuests: (quests) =>
      set((state) => {
        const nextQuests = reconcileQuestList(state.quests, quests);
        const nextDetails = new Map(state.questDetails);
        for (const quest of nextQuests) nextDetails.set(quest.questId.toLowerCase(), quest);
        return {
          quests: nextQuests,
          questDetails: nextDetails,
          questTitlePreviews: withQuestTitlePreviews(
            state.questTitlePreviews,
            nextQuests.map(questTitlePreviewFromTask),
          ),
          questSummary: summarizeQuestList(nextQuests),
          questSummaryEtag: null,
          questsLoadedFull: true,
        };
      }),
    upsertQuestDetail: (updated, opts) => {
      set((state) => {
        const hasExisting = state.quests.some((q) => q.questId === updated.questId);
        const quests = hasExisting
          ? state.quests.map((q) => (q.questId === updated.questId ? updated : q))
          : state.quests;
        const nextQuests = reconcileQuestList(state.quests, quests);
        return {
          questDetails: withQuestDetail(state.questDetails, updated),
          questTitlePreviews: withQuestTitlePreviews(state.questTitlePreviews, [questTitlePreviewFromTask(updated)]),
          questDetailEtags: withQuestDetailEtag(state.questDetailEtags, updated.questId, opts?.etag),
          ...(state.questsLoadedFull && nextQuests !== state.quests
            ? { quests: nextQuests, questSummary: summarizeQuestList(nextQuests), questSummaryEtag: null }
            : nextQuests !== state.quests
              ? { quests: nextQuests }
              : {}),
        };
      });
    },
    removeQuestDetail: (questId) => {
      set((state) => {
        const nextQuests = state.quests.filter((quest) => quest.questId !== questId);
        return {
          questDetails: withoutQuestDetail(state.questDetails, questId),
          questDetailEtags: withoutQuestDetailEtag(state.questDetailEtags, questId),
          ...(nextQuests.length !== state.quests.length
            ? state.questsLoadedFull
              ? { quests: nextQuests, questSummary: summarizeQuestList(nextQuests), questSummaryEtag: null }
              : { quests: nextQuests }
            : {}),
        };
      });
    },
    hydrateQuestTitles: async (questIds, opts) => {
      const normalizedIds = [...new Set(questIds.map((questId) => questId.trim().toLowerCase()))].filter((questId) =>
        /^q-\d+$/.test(questId),
      );
      if (normalizedIds.length === 0) return;

      const waits = new Set<Promise<void>>();
      const state = getState();
      const idsToFetch: string[] = [];
      for (const questId of normalizedIds) {
        const pending = pendingQuestTitleHydrations.get(questId);
        if (pending) {
          if (!opts?.force) {
            waits.add(pending);
            continue;
          }

          let followup = pendingQuestTitleForcedFollowups.get(pending);
          if (!followup) {
            const questIds = new Set<string>();
            let promise: Promise<void>;
            promise = pending
              .then(() => getState().hydrateQuestTitles([...questIds], { force: true }))
              .finally(() => {
                if (pendingQuestTitleForcedFollowups.get(pending)?.promise === promise) {
                  pendingQuestTitleForcedFollowups.delete(pending);
                }
              });
            followup = { questIds, promise };
            pendingQuestTitleForcedFollowups.set(pending, followup);
          }
          followup.questIds.add(questId);
          waits.add(followup.promise);
          continue;
        }
        if (!opts?.force && state.questTitlePreviews.has(questId)) continue;
        idsToFetch.push(questId);
      }

      for (let index = 0; index < idsToFetch.length; index += QUEST_TITLE_HYDRATION_BATCH_SIZE) {
        const batch = idsToFetch.slice(index, index + QUEST_TITLE_HYDRATION_BATCH_SIZE);
        let request: Promise<void>;
        request = api
          .getQuestTitles(batch)
          .then((response) => {
            set((current) => ({
              questTitlePreviews: withQuestTitlePreviews(
                current.questTitlePreviews,
                response.quests,
                response.missingQuestIds,
              ),
            }));
          })
          .catch(() => {
            // Retain any known canonical title and let a later reconnect or quest update retry.
          })
          .finally(() => {
            for (const questId of batch) {
              if (pendingQuestTitleHydrations.get(questId) === request) pendingQuestTitleHydrations.delete(questId);
            }
          });
        for (const questId of batch) pendingQuestTitleHydrations.set(questId, request);
        waits.add(request);
      }

      await Promise.all(waits);
    },
    replaceQuest: (updated) => {
      getState().upsertQuestDetail(updated);
    },
    refreshQuests: async (opts) => {
      if (opts?.background) {
        if (shouldPauseQuestBackgroundRefresh()) return;
        if (!opts.force && pendingQuestBackgroundRefresh) return pendingQuestBackgroundRefresh;
        if (!opts.force && Date.now() - lastQuestBackgroundRefreshAt < QUEST_BACKGROUND_REFRESH_MIN_INTERVAL_MS) return;
        lastQuestBackgroundRefreshAt = Date.now();
        const refreshPromise = refreshQuestSummaryFromServer(set, getState, "snapshot");
        pendingQuestBackgroundRefresh = trackQuestRefresh(refreshPromise);
        return pendingQuestBackgroundRefresh;
      }

      if (!opts?.background) set({ questsLoading: true });
      try {
        const page = await api.listQuests();
        set({
          questSummary: {
            total: page.counts.all,
            active: page.counts.idea + page.counts.refined + page.counts.in_progress,
            counts: page.counts,
          },
          questSummaryEtag: null,
          questsLoadedFull: false,
          questsLoading: false,
        });
      } catch {
        set({ questsLoading: false });
      }
    },
    refreshQuestSummary: async (opts) => {
      if (shouldPauseQuestBackgroundRefresh()) return;
      if (!opts?.force && pendingQuestBackgroundRefresh) return pendingQuestBackgroundRefresh;
      if (!opts?.force && Date.now() - lastQuestBackgroundRefreshAt < QUEST_BACKGROUND_REFRESH_MIN_INTERVAL_MS) return;
      lastQuestBackgroundRefreshAt = Date.now();
      const refreshPromise = refreshQuestSummaryFromServer(set, getState, "badge");
      pendingQuestBackgroundRefresh = trackQuestRefresh(refreshPromise);
      return pendingQuestBackgroundRefresh;
    },
    refreshQuestAutocompleteCandidates: async (opts) => {
      const state = getState();
      if (!opts?.force && state.questAutocompleteLoaded) return;
      if (!opts?.force && pendingQuestAutocompleteRefresh) return pendingQuestAutocompleteRefresh;
      const refreshPromise = refreshQuestAutocompleteCandidatesFromServer(set, getState);
      pendingQuestAutocompleteRefresh = trackQuestAutocompleteRefresh(refreshPromise);
      return pendingQuestAutocompleteRefresh;
    },
    invalidateQuestAutocompleteCandidates: () => {
      set({
        questAutocompleteLoaded: false,
        questAutocompleteEtag: null,
      });
    },
  };
}

async function refreshQuestSummaryFromServer(
  set: StoreSet,
  getState: () => AppState,
  reason: "snapshot" | "badge",
): Promise<void> {
  try {
    const currentEtag = getState().questSummaryEtag;
    const result = await api.getQuestSummaryValidated(currentEtag);
    if (result.status === "fresh") {
      set({ questSummary: result.data, questSummaryEtag: result.etag });
    } else if (result.etag && result.etag !== currentEtag) {
      set({ questSummaryEtag: result.etag });
    }
  } catch {
    // Background summary refresh failures should not disturb the visible quest cache.
    void reason;
  }
}

function trackQuestRefresh(refreshPromise: Promise<void>): Promise<void> {
  const trackedRefresh = refreshPromise.finally(() => {
    if (pendingQuestBackgroundRefresh === trackedRefresh) {
      pendingQuestBackgroundRefresh = null;
    }
  });
  return trackedRefresh;
}

async function refreshQuestAutocompleteCandidatesFromServer(set: StoreSet, getState: () => AppState): Promise<void> {
  set({ questAutocompleteLoading: true });
  try {
    const currentEtag = getState().questAutocompleteEtag;
    const result = await api.listQuestAutocompleteCandidatesValidated(currentEtag);
    if (result.status === "fresh") {
      set((state) => ({
        questAutocompleteCandidates: reconcileQuestAutocompleteCandidates(
          state.questAutocompleteCandidates,
          result.data,
        ),
        questAutocompleteEtag: result.etag,
        questAutocompleteLoaded: true,
        questAutocompleteLoading: false,
      }));
      return;
    }
    set({
      questAutocompleteLoaded: true,
      questAutocompleteLoading: false,
      ...(result.etag ? { questAutocompleteEtag: result.etag } : {}),
    });
  } catch {
    // Preserve any stale candidates for autocomplete and avoid a perpetual loading state.
    set({ questAutocompleteLoaded: true, questAutocompleteLoading: false });
  }
}

function trackQuestAutocompleteRefresh(refreshPromise: Promise<void>): Promise<void> {
  const trackedRefresh = refreshPromise.finally(() => {
    if (pendingQuestAutocompleteRefresh === trackedRefresh) {
      pendingQuestAutocompleteRefresh = null;
    }
  });
  return trackedRefresh;
}
