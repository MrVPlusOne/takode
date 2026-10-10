import { useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { fetchThreadMonitoring } from "../api/thread-monitoring.js";
import { useGlobalNeedsInputEntries } from "../components/GlobalNeedsInputMenu.js";
import { useNotifyMeSummary } from "../components/GlobalNotifyMeMenu.js";
import { useStore } from "../store.js";
import { buildNextAttentionQueue, collectUnreadAttention, type NextAttentionItem } from "../utils/next-attention.js";
import { useAttentionNavigator, type AttentionNavigator } from "./useAttentionNavigator.js";

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
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
    })),
  );
  const queue = useMemo(
    () => buildNextAttentionQueue({ needsInput, notifyMe, unread: collectUnreadAttention(unreadSource) }),
    [needsInput, notifyMe, unreadSource],
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
