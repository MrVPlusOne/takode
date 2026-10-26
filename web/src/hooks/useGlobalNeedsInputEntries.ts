import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { api } from "../api.js";
import { applySessionNotifications, type NotificationStatusSnapshot } from "../notification-status.js";
import { useStore } from "../store.js";
import {
  getGlobalMutedNeedsInputEntries,
  getGlobalNeedsInputEntries,
  isLeaderDirected,
  type GlobalNeedsInputState,
} from "../utils/global-needs-input.js";

interface NeedsInputFetchRequest {
  key: string;
  sessionId: string;
  status: NotificationStatusSnapshot;
}

/** Session keys whose notifications were already requested, shared by every hook instance. */
const fetchedNeedsInputKeys = new Set<string>();

/**
 * Active and muted needs-input entries across sessions. Loads each session's
 * notification list when its server summary says it has prompts (or, for a leader,
 * unread answers); every caller shares one request per summary version.
 */
export function useGlobalNeedsInputEntries() {
  const { sessionNotifications, sdkSessions } = useStore(
    useShallow((s) => ({
      sessionNotifications: s.sessionNotifications,
      sdkSessions: s.sdkSessions,
    })),
  );
  const state = useMemo(() => ({ sessionNotifications, sdkSessions }), [sessionNotifications, sdkSessions]);
  const entries = useMemo(() => getGlobalNeedsInputEntries(state), [state]);
  const mutedEntries = useMemo(() => getGlobalMutedNeedsInputEntries(state), [state]);
  const fetchRequests = useMemo(() => needsInputFetchRequests(state), [state]);

  useEffect(() => {
    for (const request of fetchRequests) {
      if (fetchedNeedsInputKeys.has(request.key)) continue;
      fetchedNeedsInputKeys.add(request.key);
      api
        .getSessionNotifications(request.sessionId)
        .then((notifications) => applySessionNotifications(request.sessionId, notifications, request.status))
        .catch((error) => {
          console.warn("Failed to load global needs-input notifications", error);
          fetchedNeedsInputKeys.delete(request.key);
        });
    }
  }, [fetchRequests]);

  return { entries, mutedEntries, sdkSessions };
}

function needsInputFetchRequests(state: GlobalNeedsInputState): NeedsInputFetchRequest[] {
  return state.sdkSessions
    .filter((session) => {
      if (session.archived || isLeaderDirected(session)) return false;
      const activeNeedsInputCount =
        session.activeNeedsInputNotificationCount ??
        (session.notificationUrgency === "needs-input" ? (session.activeNotificationCount ?? 0) : 0);
      // A leader's unread answers are items of the attention list too, one per message.
      const unreadResults = session.isOrchestrator ? (session.activeReviewNotificationCount ?? 0) : 0;
      return activeNeedsInputCount > 0 || (session.mutedNeedsInputNotificationCount ?? 0) > 0 || unreadResults > 0;
    })
    .map((session) => {
      const status: NotificationStatusSnapshot = {
        notificationUrgency: session.notificationUrgency,
        activeNotificationCount: session.activeNotificationCount,
        activeNeedsInputNotificationCount: session.activeNeedsInputNotificationCount,
        activeReviewNotificationCount: session.activeReviewNotificationCount,
        mutedNeedsInputNotificationCount: session.mutedNeedsInputNotificationCount,
        notificationStatusVersion: session.notificationStatusVersion,
        notificationStatusUpdatedAt: session.notificationStatusUpdatedAt,
      };
      return {
        key: `${session.sessionId}:${session.notificationStatusVersion ?? ""}:${session.notificationStatusUpdatedAt ?? ""}`,
        sessionId: session.sessionId,
        status,
      };
    });
}
