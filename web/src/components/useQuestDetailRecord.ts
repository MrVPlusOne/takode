import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";

export interface QuestDetailRecord {
  quest: QuestmasterTask | null;
  fetchedQuest: QuestmasterTask | null;
  setFetchedQuest: (quest: QuestmasterTask | null) => void;
  questLoading: boolean;
  questLoadError: string;
}

export function useQuestDetailRecord(questOverlayId: string | null): QuestDetailRecord {
  const quests = useStore((s) => s.quests);
  const questDetails = useStore((s) => s.questDetails);
  const storeQuest = useMemo(
    () =>
      questOverlayId
        ? (questDetails.get(questOverlayId.toLowerCase()) ?? quests.find((q) => q.questId === questOverlayId) ?? null)
        : null,
    [questDetails, quests, questOverlayId],
  );
  const [fetchedQuest, setFetchedQuest] = useState<QuestmasterTask | null>(null);
  const [questLoading, setQuestLoading] = useState(false);
  const [questLoadError, setQuestLoadError] = useState("");
  const quest = storeQuest ?? (fetchedQuest?.questId === questOverlayId ? fetchedQuest : null);

  const revalidateQuest = useCallback(
    async (options: { showLoading: boolean; signal?: AbortSignal }) => {
      if (!questOverlayId) return;
      const currentState = useStore.getState();
      const currentEtag = currentState.questDetailEtags.get(questOverlayId.toLowerCase()) ?? null;
      const hasCachedBody =
        currentState.questDetails.has(questOverlayId.toLowerCase()) ||
        currentState.quests.some((item) => item.questId === questOverlayId);
      if (options.showLoading && !hasCachedBody) setQuestLoading(true);
      setQuestLoadError("");
      try {
        const result = await api.getQuestValidated(questOverlayId, currentEtag);
        if (options.signal?.aborted) return;
        if (result.status === "fresh") {
          setFetchedQuest(result.data);
          useStore.getState().upsertQuestDetail(result.data, { etag: result.etag });
        }
      } catch (e) {
        if (options.signal?.aborted) return;
        setQuestLoadError(e instanceof Error ? e.message : "Failed to load quest");
      } finally {
        if (!options.signal?.aborted) setQuestLoading(false);
      }
    },
    [questOverlayId],
  );

  useEffect(() => {
    if (!questOverlayId) {
      setFetchedQuest(null);
      setQuestLoading(false);
      setQuestLoadError("");
      return;
    }
    const controller = new AbortController();
    void revalidateQuest({ showLoading: true, signal: controller.signal });
    return () => controller.abort();
  }, [questOverlayId, revalidateQuest]);

  useEffect(() => {
    if (!questOverlayId) return;
    const revalidateVisibleQuest = () => {
      if (document.visibilityState === "hidden") return;
      void revalidateQuest({ showLoading: false });
    };
    window.addEventListener("focus", revalidateVisibleQuest);
    document.addEventListener("visibilitychange", revalidateVisibleQuest);
    return () => {
      window.removeEventListener("focus", revalidateVisibleQuest);
      document.removeEventListener("visibilitychange", revalidateVisibleQuest);
    };
  }, [questOverlayId, revalidateQuest]);

  return {
    quest,
    fetchedQuest,
    setFetchedQuest,
    questLoading,
    questLoadError,
  };
}
