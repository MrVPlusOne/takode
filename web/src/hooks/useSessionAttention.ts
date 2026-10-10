import { useCallback, useEffect, useMemo, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { THREAD_MONITORING_PROJECTION, type ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { useStore } from "../store.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import type { SessionNotification } from "../types.js";
import {
  buildSessionAttentionQueue,
  collectUnreadAttention,
  pickSessionAttention,
  type NextAttentionItem,
  type UnreadAttentionCandidate,
} from "../utils/next-attention.js";
import { openAttentionItem, usePendingNotifyMeEntries, type NextAttentionLanding } from "./useNextAttention.js";

export interface SessionAttention {
  /** Everything in this session that needs the user, in the order Next visits it. */
  queue: NextAttentionItem[];
  /** Open the next item and say where it landed. */
  goNext: () => NextAttentionLanding | null;
  /** Open one item; later Next taps continue after it. */
  open: (item: NextAttentionItem) => void;
}

/** Fixed Notify Me and unread data for the Playground, which has no server; items then do not navigate. */
export interface SessionAttentionPreview {
  notifyMe: ThreadMonitoringEntry[];
  unread: UnreadAttentionCandidate[];
}

/**
 * The per-session counterpart of `useNextAttention`: this session's unmuted
 * needs-input prompts, then its pending Notify Me results, then its unread
 * results, cycled one at a time. `needsInput` is the session's active prompts,
 * which the caller already loads for its inbox.
 */
export function useSessionAttention(
  sessionId: string,
  needsInput: readonly SessionNotification[],
  preview?: SessionAttentionPreview,
): SessionAttention {
  const source = useStore(
    useShallow((s) => ({
      session: s.sdkSessions.find((entry) => entry.sessionId === sessionId),
      sessionAttention: s.sessionAttention,
      syncedProjectionValues: s.syncedProjectionValues,
      syncedProjectionKeys: s.syncedProjectionKeys,
    })),
  );
  const monitoring = getSyncedProjectionValue(source, THREAD_MONITORING_PROJECTION, sessionId);
  const liveNotifyMe = usePendingNotifyMeEntries(monitoring?.pendingCount ?? 0, String(monitoring?.revision ?? ""));
  const queue = useMemo(() => {
    const { session } = source;
    return buildSessionAttentionQueue({
      sessionId,
      sessionName: session?.name ?? "",
      sessionNum: session?.sessionNum ?? null,
      needsInput,
      notifyMe: preview?.notifyMe ?? liveNotifyMe,
      unread: preview?.unread ?? (session ? collectUnreadAttention({ ...source, sdkSessions: [session] }) : []),
    });
  }, [liveNotifyMe, needsInput, preview, sessionId, source]);

  const lastRef = useRef<{ key: string; position: number } | null>(null);
  useEffect(() => {
    lastRef.current = null;
  }, [sessionId]);

  const open = useCallback(
    (item: NextAttentionItem) => {
      const position = queue.findIndex((entry) => entry.key === item.key);
      lastRef.current = { key: item.key, position: Math.max(position, 0) };
      if (!preview) openAttentionItem(item, useStore.getState().sdkSessions);
    },
    [preview, queue],
  );

  const goNext = useCallback((): NextAttentionLanding | null => {
    const next = pickSessionAttention(queue, lastRef.current);
    if (!next) return null;
    lastRef.current = { key: next.item.key, position: next.position };
    if (!preview) openAttentionItem(next.item, useStore.getState().sdkSessions);
    return { item: next.item, sessionNum: null, position: next.position + 1, total: queue.length };
  }, [preview, queue]);

  return { queue, goNext, open };
}
