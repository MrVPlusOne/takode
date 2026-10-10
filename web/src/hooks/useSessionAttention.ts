import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { THREAD_MONITORING_PROJECTION, type ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import { useStore } from "../store.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import type { SessionNotification } from "../types.js";
import {
  buildSessionAttentionQueue,
  collectUnreadAttention,
  type NextAttentionItem,
  type UnreadAttentionCandidate,
} from "../utils/next-attention.js";
import { useAttentionNavigator, type AttentionNavigator } from "./useAttentionNavigator.js";
import { usePendingNotifyMeEntries } from "./useNextAttention.js";

/** Fixed Notify Me and unread data for the Playground, which has no server; steps then do not navigate. */
export interface SessionAttentionPreview {
  notifyMe: ThreadMonitoringEntry[];
  unread: UnreadAttentionCandidate[];
}

/**
 * The per-session counterpart of `useNextAttention`, for the feed's attention
 * chip: this session's unmuted needs-input prompts, then its pending Notify Me
 * results, then its unread results. `needsInput` is the session's active
 * prompts, which the chip already loads for its inbox.
 */
export function useSessionAttention(
  sessionId: string,
  needsInput: readonly SessionNotification[],
  preview?: SessionAttentionPreview,
): AttentionNavigator & { queue: NextAttentionItem[] } {
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
  return { queue, ...useAttentionNavigator(`session:${sessionId}`, queue, { navigate: !preview }) };
}
