import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { buildCanonicalQuestTitleIndex } from "../utils/quest-title-index.js";

const QUEST_THREAD = /^q-\d+$/i;

/** The quest an attention item's question or result belongs to, or null for Main and session-level items. */
export function attentionQuestId(item: NextAttentionItem): string | null {
  return item.threadKey && QUEST_THREAD.test(item.threadKey) ? item.threadKey.toLowerCase() : null;
}

/**
 * Quest titles for the attention lists' second lines, from the browser's
 * canonical quest title index. Missing titles are fetched once through the
 * bounded title projection; until they arrive the row shows the quest ID.
 */
export function useAttentionQuestTitles(items: readonly NextAttentionItem[]): (questId: string) => string | undefined {
  const { quests, questDetails, questTitlePreviews, hydrateQuestTitles } = useStore(
    useShallow((s) => ({
      quests: s.quests,
      questDetails: s.questDetails,
      questTitlePreviews: s.questTitlePreviews,
      hydrateQuestTitles: s.hydrateQuestTitles,
    })),
  );
  const titles = useMemo(
    () => buildCanonicalQuestTitleIndex({ quests: quests ?? [], questDetails, questTitlePreviews }),
    [questDetails, questTitlePreviews, quests],
  );
  const missing = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      const questId = attentionQuestId(item);
      if (questId && !titles.has(questId)) ids.add(questId);
    }
    return [...ids].sort().join(",");
  }, [items, titles]);

  useEffect(() => {
    if (missing && hydrateQuestTitles) void hydrateQuestTitles(missing.split(","));
  }, [hydrateQuestTitles, missing]);

  return useMemo(() => (questId: string) => titles.get(questId.toLowerCase()), [titles]);
}
