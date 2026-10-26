import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { fetchThreadMonitoring } from "../api/thread-monitoring.js";
import { useNotifyMeSummary } from "../components/NotifyMe.js";
import { useGlobalNeedsInputEntries } from "./useGlobalNeedsInputEntries.js";
import { useStore } from "../store.js";
import { buildNextAttentionQueue, collectUnreadAttention, type NextAttentionItem } from "../utils/next-attention.js";
import { useAttentionNavigator, type AttentionNavigator } from "./useAttentionNavigator.js";
import { useQuestTopicsOf } from "../utils/leader-topics.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";

export { openAttentionItem, type NextAttentionLanding } from "./useAttentionNavigator.js";

/**
 * Everything across sessions that needs the user, for the top bar's attention
 * list, plus its Next step. See `utils/next-attention.ts` for what is included
 * and in which order.
 */
export function useNextAttention(): AttentionNavigator & { queue: NextAttentionItem[] } {
  const { entries: needsInput } = useGlobalNeedsInputEntries();
  const { pending, signature } = useNotifyMeSummary();
  const notifyMe = usePendingNotifyMeEntries(pending, signature);
  const unreadSource = useStore(
    useShallow((s) => ({
      sdkSessions: s.sdkSessions,
      sessionAttention: s.sessionAttention,
      sessionNotifications: s.sessionNotifications,
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
    })),
  );
  const unread = useMemo(() => collectUnreadAttention(unreadSource), [unreadSource]);
  // Unread answers group by their quest's Library topic, looked up per leader.
  const topicOfQuest = useQuestTopicsOf(
    unread.flatMap((candidate) =>
      candidate.threadKey && isQuestThreadKey(candidate.threadKey)
        ? [{ leaderId: candidate.sessionId, questId: candidate.threadKey }]
        : [],
    ),
  );
  const queue = useMemo(
    () =>
      buildNextAttentionQueue({
        needsInput,
        notifyMe,
        unread,
        topicOf: (sessionId, threadKey) =>
          threadKey && isQuestThreadKey(threadKey) ? (topicOfQuest(sessionId, threadKey) ?? null) : null,
      }),
    [needsInput, notifyMe, unread, topicOfQuest],
  );
  return { queue, ...useAttentionNavigator("global", queue) };
}

/**
 * Pending Notify Me results, refetched whenever `signature` (the synchronized
 * monitoring revisions the caller watches) changes. Nothing loads while `pending` is 0.
 */
export function usePendingNotifyMeEntries(pending: number, signature: string): ThreadMonitoringEntry[] {
  const [entries, setEntries] = useState<ThreadMonitoringEntry[]>([]);

  useEffect(() => {
    if (pending === 0) {
      setEntries([]);
      return;
    }
    const controller = new AbortController();
    fetchThreadMonitoring("pending", 0, controller.signal)
      .then((page) => {
        if (!controller.signal.aborted) setEntries(page.entries);
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("[next-attention] Notify Me results failed to load:", error);
      });
    return () => controller.abort();
  }, [pending, signature]);

  return entries;
}

/**
 * Every tracked Notify Me thread, across all result pages, loaded while
 * `enabled` and refetched when `signature` changes. The last list stays while
 * disabled, so reopening shows it at once and then refreshes.
 */
export function useTrackedNotifyMeEntries(enabled: boolean, signature: string): ThreadMonitoringEntry[] {
  const [entries, setEntries] = useState<ThreadMonitoringEntry[]>([]);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetchAllTrackedEntries(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setEntries(loaded);
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn("[next-attention] Tracked Notify Me tasks failed to load:", error);
      });
    return () => controller.abort();
  }, [enabled, signature]);

  return entries;
}

async function fetchAllTrackedEntries(signal: AbortSignal): Promise<ThreadMonitoringEntry[]> {
  const entries: ThreadMonitoringEntry[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await fetchThreadMonitoring("all", offset, signal);
    entries.push(...page.entries);
    offset = page.nextOffset;
  }
  return entries;
}
