import type { StateCreator } from "zustand";
import { api } from "./api.js";
import { reconcileQuestList } from "./store-equality.js";
import type { AppState } from "./store-types.js";
import type { QuestmasterTask } from "./types.js";

type StoreSet = Parameters<StateCreator<AppState>>[0];
type QuestStoreSlice = Pick<
  AppState,
  | "questDetails"
  | "questDetailEtags"
  | "quests"
  | "questSummary"
  | "questSummaryEtag"
  | "questsLoadedFull"
  | "questsLoading"
  | "setQuests"
  | "upsertQuestDetail"
  | "removeQuestDetail"
  | "replaceQuest"
  | "refreshQuests"
  | "refreshQuestSummary"
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

const QUEST_BACKGROUND_REFRESH_MIN_INTERVAL_MS = 2_000;
let pendingQuestBackgroundRefresh: Promise<void> | null = null;
let lastQuestBackgroundRefreshAt = 0;

export function resetQuestRefreshStateForTests(): void {
  pendingQuestBackgroundRefresh = null;
  lastQuestBackgroundRefreshAt = 0;
}

export function createQuestStoreSlice(set: StoreSet, getState: () => AppState): QuestStoreSlice {
  return {
    questDetails: new Map(),
    questDetailEtags: new Map(),
    quests: [],
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
