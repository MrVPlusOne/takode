import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import type { NextAttentionItem } from "../utils/next-attention.js";
import { buildCanonicalQuestTitleIndex } from "../utils/quest-title-index.js";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import { loadLeaderNamesOnce, useTopicKeyNamer } from "../utils/leader-topics.js";

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
 * the canonical quest title index, else a topic conversation's or user
 * thread's name. Missing quest titles are fetched once through the bounded
 * title projection, and a leader's threads once; until they arrive the row
 * shows the quest ID.
 */
export function useAttentionThreadTitles(
  items: readonly Pick<NextAttentionItem, "sessionId" | "threadKey">[],
): AttentionThreadTitles {
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
  const topicKeyName = useTopicKeyNamer();
  const titleFor = useMemo<ThreadTitleFor>(
    () => (sessionId, threadKey) => {
      const key = threadKey.toLowerCase();
      // A topic conversation or user thread is named by itself; a tab made for it may carry the
      // title of a question asked there instead.
      if (isTopicViewKey(key)) return topicKeyName(sessionId, key)?.name;
      const tabs = resolveLeaderThreadTabsProjection(state, sessionId);
      const tab = tabs.projectionState === "accepted" ? tabs.value.tabs.find((entry) => entry.threadKey === key) : null;
      return tab?.title || questTitles.get(key);
    },
    [questTitles, state, topicKeyName],
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

  // A user thread's name comes with its leader's thread list, which only its tab bar loads.
  const unnamedThreadLeaders = useMemo(() => {
    const leaders = new Set<string>();
    for (const item of items) {
      if (item.threadKey && isTopicViewKey(item.threadKey) && !titleFor(item.sessionId, item.threadKey))
        leaders.add(item.sessionId);
    }
    return [...leaders].sort().join(",");
  }, [items, titleFor]);
  useEffect(() => {
    for (const leaderId of unnamedThreadLeaders ? unnamedThreadLeaders.split(",") : []) loadLeaderNamesOnce(leaderId);
  }, [unnamedThreadLeaders]);

  const hasThreadTabs = useMemo(
    () => (sessionId: string) =>
      state.sdkSessions?.find((session) => session.sessionId === sessionId)?.isOrchestrator === true ||
      resolveLeaderThreadTabsProjection(state, sessionId).projectionState === "accepted",
    [state],
  );
  return useMemo(() => ({ titleFor, hasThreadTabs }), [hasThreadTabs, titleFor]);
}
