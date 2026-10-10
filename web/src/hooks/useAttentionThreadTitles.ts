import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { buildCanonicalQuestTitleIndex } from "../utils/quest-title-index.js";

/** Title of a session's thread tab: `(sessionId, threadKey) => title`. */
export type ThreadTitleFor = (sessionId: string, threadKey: string) => string | undefined;

/** Thread tab lookups for the attention lists' second lines. */
export interface AttentionThreadTitles {
  titleFor: ThreadTitleFor;
  /** Whether the session has thread tabs (a leader); others have no Main tab to name. */
  hasThreadTabs: (sessionId: string) => boolean;
}

const QUEST_THREAD = /^q-\d+$/i;

/**
 * Thread tab titles for the attention lists' second lines: the title the
 * leader's tab shows, from its tab projection, else the quest's title from
 * the canonical quest title index. Missing quest titles are fetched once
 * through the bounded title projection; until they arrive the row shows the
 * quest ID.
 */
export function useAttentionThreadTitles(items: readonly NextAttentionItem[]): AttentionThreadTitles {
  const state = useStore(
    useShallow((s) => ({
      quests: s.quests,
      questDetails: s.questDetails,
      questTitlePreviews: s.questTitlePreviews,
      hydrateQuestTitles: s.hydrateQuestTitles,
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
      sdkSessions: s.sdkSessions,
    })),
  );
  const { quests, questDetails, questTitlePreviews, hydrateQuestTitles } = state;
  const questTitles = useMemo(
    () => buildCanonicalQuestTitleIndex({ quests: quests ?? [], questDetails, questTitlePreviews }),
    [questDetails, questTitlePreviews, quests],
  );
  const titleFor = useMemo<ThreadTitleFor>(
    () => (sessionId, threadKey) => {
      const key = threadKey.toLowerCase();
      const tabs = resolveLeaderThreadTabsProjection(state, sessionId);
      const tab = tabs.projectionState === "accepted" ? tabs.value.tabs.find((entry) => entry.threadKey === key) : null;
      return tab?.title || questTitles.get(key);
    },
    [questTitles, state],
  );
  const missing = useMemo(() => {
    const ids = new Set<string>();
    for (const item of items) {
      const key = item.threadKey?.toLowerCase();
      if (key && QUEST_THREAD.test(key) && !titleFor(item.sessionId, key)) ids.add(key);
    }
    return [...ids].sort().join(",");
  }, [items, titleFor]);

  useEffect(() => {
    if (missing && hydrateQuestTitles) void hydrateQuestTitles(missing.split(","));
  }, [hydrateQuestTitles, missing]);

  const hasThreadTabs = useMemo(
    () => (sessionId: string) =>
      state.sdkSessions?.find((session) => session.sessionId === sessionId)?.isOrchestrator === true ||
      resolveLeaderThreadTabsProjection(state, sessionId).projectionState === "accepted",
    [state],
  );
  return useMemo(() => ({ titleFor, hasThreadTabs }), [hasThreadTabs, titleFor]);
}
