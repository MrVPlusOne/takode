import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { api } from "../api.js";
import { fetchThreadMonitoring } from "../api/thread-monitoring.js";
import { useGlobalNeedsInputEntries } from "../components/GlobalNeedsInputMenu.js";
import { openNotifyMeEntry, useNotifyMeSummary } from "../components/GlobalNotifyMeMenu.js";
import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";
import {
  buildNextAttentionQueue,
  collectUnreadAttention,
  pickNextAttention,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import { navigateToNotification } from "../utils/notification-navigation.js";
import {
  navigateToSession,
  navigateToSessionThread,
  routeSessionRefForId,
  threadRouteFromHash,
} from "../utils/routing.js";

export interface NextAttentionLanding {
  item: NextAttentionItem;
  sessionNum: number | null;
  /** 1-based position of the opened item in the queue. */
  position: number;
  total: number;
}

/**
 * The cross-session "Next" queue and the action that opens its next item.
 * See `utils/next-attention.ts` for what is included and in which order.
 */
export function useNextAttention(): { count: number; goNext: () => NextAttentionLanding | null } {
  const { entries: needsInput, sdkSessions } = useGlobalNeedsInputEntries();
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
  const lastKeyRef = useRef<string | null>(null);

  const goNext = useCallback((): NextAttentionLanding | null => {
    const location = {
      sessionId: useStore.getState().currentSessionId,
      threadKey: threadRouteFromHash(window.location.hash).threadKey,
    };
    const next = pickNextAttention(queue, location, lastKeyRef.current);
    if (!next) return null;
    lastKeyRef.current = next.item.key;
    openAttentionItem(next.item, sdkSessions);
    const sessionNum = sdkSessions.find((session) => session.sessionId === next.item.sessionId)?.sessionNum ?? null;
    return { item: next.item, sessionNum, position: next.position + 1, total: queue.length };
  }, [queue, sdkSessions]);

  return { count: queue.length, goNext };
}

/** Open an attention item: shared by Next and the session feed's attention chip. */
export function openAttentionItem(item: NextAttentionItem, sdkSessions: SdkSessionInfo[]) {
  if (item.kind === "needs-input") {
    navigateToNotification(item.sessionId, item.entry.notification, sdkSessions);
    return;
  }
  if (item.kind === "notify-me") {
    openNotifyMeEntry(item.entry, sdkSessions);
    return;
  }
  if (item.threadKey) {
    navigateToSessionThread(item.sessionId, item.threadKey, false, routeSessionRefForId(item.sessionId, sdkSessions));
    return;
  }
  // Same as choosing the session in the sidebar: opening it reads its unread result.
  api.markSessionRead?.(item.sessionId, { mode: "session-view" }).catch(() => {});
  navigateToSession(item.sessionId);
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
