import { api } from "./api.js";
import { useStore } from "./store.js";
import type { SdkSessionInfo } from "./types.js";
import {
  setSdkSessionsWithNotificationFreshness,
  shouldApplyAttentionReasonWithNotificationFreshness,
} from "./notification-status.js";
import { questOwnsSessionName } from "./utils/quest-helpers.js";
import { sessionTaskHistoryEqual, stringArrayEqual } from "./store-equality.js";

export const ACTIVE_SESSION_METADATA_STALE_REFRESH_MS = 3 * 60_000;
export const SIDEBAR_SESSION_POLL_INTERVAL_MS = 5_000;
export const SIDEBAR_SESSION_STALE_REFRESH_MS = 3 * 60_000;

const FORCE_REFRESH_AFTER_HIDDEN_MS = 60_000;

export interface HydrateSessionListOptions {
  preserveMissingArchived?: boolean;
}

export interface ActiveSessionMetadataRefreshOptions {
  force?: boolean;
  includeTreeGroups?: boolean;
}

let activeSessionMetadataRefreshInFlight: Promise<void> | null = null;
let lastActiveSessionMetadataRefreshStartedAt = 0;

export function hydrateSessionList(list: SdkSessionInfo[], options: HydrateSessionListOptions = {}): void {
  const store = useStore.getState();
  const strippedList = list.map(stripSearchMetadata);
  const nextSdkSessions = options.preserveMissingArchived
    ? mergeActiveSnapshotWithExistingArchived(strippedList, store.sdkSessions)
    : strippedList;
  setSdkSessionsWithNotificationFreshness(nextSdkSessions);

  let batchedAttention: Map<string, "action" | "error" | "review" | null> | null = null;
  for (const session of list) {
    hydrateSessionDerivedMetadata(store, session);
    batchedAttention = collectAttentionUpdate(store, session, batchedAttention);
  }
  if (batchedAttention) {
    useStore.setState({ sessionAttention: batchedAttention });
  }
}

export async function refreshTreeGroups(): Promise<void> {
  const treeGroupState = await api.getTreeGroups();
  useStore.getState().setTreeGroups(treeGroupState.groups, treeGroupState.assignments, treeGroupState.nodeOrder ?? {});
}

export function refreshActiveSessionMetadata(options: ActiveSessionMetadataRefreshOptions = {}): Promise<void> {
  const now = Date.now();
  if (!options.force && now - lastActiveSessionMetadataRefreshStartedAt < ACTIVE_SESSION_METADATA_STALE_REFRESH_MS) {
    return activeSessionMetadataRefreshInFlight ?? Promise.resolve();
  }
  if (activeSessionMetadataRefreshInFlight) return activeSessionMetadataRefreshInFlight;

  lastActiveSessionMetadataRefreshStartedAt = now;
  const refresh = runActiveSessionMetadataRefresh(options).finally(() => {
    if (activeSessionMetadataRefreshInFlight === refresh) {
      activeSessionMetadataRefreshInFlight = null;
    }
  });
  activeSessionMetadataRefreshInFlight = refresh;
  return refresh;
}

export function installActiveSessionMetadataRefreshListeners(): () => void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return () => {};
  }

  let hiddenAt: number | null = document.visibilityState === "hidden" ? Date.now() : null;
  void refreshActiveSessionMetadata({ force: true, includeTreeGroups: true });

  const refreshIfVisible = (options: ActiveSessionMetadataRefreshOptions = {}) => {
    if (document.visibilityState === "hidden") return;
    void refreshActiveSessionMetadata({ includeTreeGroups: true, ...options });
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
      return;
    }
    const hiddenDuration = hiddenAt == null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    refreshIfVisible({ force: hiddenDuration >= FORCE_REFRESH_AFTER_HIDDEN_MS });
  };
  const handlePageShow = (event: PageTransitionEvent) => {
    const persisted = "persisted" in event && event.persisted === true;
    refreshIfVisible({ force: persisted });
  };
  const handleFocus = () => refreshIfVisible();
  const handleOnline = () => refreshIfVisible({ force: true });

  window.addEventListener("focus", handleFocus);
  window.addEventListener("pageshow", handlePageShow);
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    window.removeEventListener("focus", handleFocus);
    window.removeEventListener("pageshow", handlePageShow);
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
  };
}

export function _resetActiveSessionMetadataRefreshForTest(): void {
  activeSessionMetadataRefreshInFlight = null;
  lastActiveSessionMetadataRefreshStartedAt = 0;
}

function stripSearchMetadata(session: SdkSessionInfo): SdkSessionInfo {
  const { taskHistory: _taskHistory, keywords: _keywords, ...rest } = session;
  return rest;
}

function mergeActiveSnapshotWithExistingArchived(
  activeSnapshot: SdkSessionInfo[],
  currentSessions: SdkSessionInfo[],
): SdkSessionInfo[] {
  const activeIds = new Set(activeSnapshot.map((session) => session.sessionId));
  const preservedArchived = currentSessions.filter((session) => session.archived && !activeIds.has(session.sessionId));
  return [...activeSnapshot, ...preservedArchived];
}

function hydrateSessionDerivedMetadata(store: ReturnType<typeof useStore.getState>, session: SdkSessionInfo): void {
  if (session.name) {
    const currentStoreName = store.sessionNames.get(session.sessionId);
    if (currentStoreName !== session.name) {
      const hadRandomName = !!currentStoreName && /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(currentStoreName);
      store.setSessionName(session.sessionId, session.name);
      if (hadRandomName) {
        store.markRecentlyRenamed(session.sessionId);
      }
    }
  }
  if (
    !session.isOrchestrator &&
    questOwnsSessionName(session.claimedQuestStatus ?? undefined, session.claimedQuestVerificationInboxUnread)
  ) {
    store.markQuestNamed(session.sessionId);
  } else {
    store.clearQuestNamed(session.sessionId);
  }
  if (session.lastMessagePreview && !store.sessionPreviews.has(session.sessionId)) {
    store.setSessionPreview(session.sessionId, session.lastMessagePreview);
  }

  const nextTaskHistory = session.taskHistory ?? [];
  const currentTaskHistory = store.sessionTaskHistory.get(session.sessionId);
  if (!sessionTaskHistoryEqual(currentTaskHistory, nextTaskHistory)) {
    store.setSessionTaskHistory(session.sessionId, nextTaskHistory);
  }
  const nextKeywords = session.keywords ?? [];
  const currentKeywords = store.sessionKeywords.get(session.sessionId);
  if (!stringArrayEqual(currentKeywords, nextKeywords)) {
    store.setSessionKeywords(session.sessionId, nextKeywords);
  }
}

function collectAttentionUpdate(
  store: ReturnType<typeof useStore.getState>,
  session: SdkSessionInfo,
  batchedAttention: Map<string, "action" | "error" | "review" | null> | null,
): Map<string, "action" | "error" | "review" | null> | null {
  if (session.attentionReason === undefined) return batchedAttention;
  const shouldApplyAttention = shouldApplyAttentionReasonWithNotificationFreshness(
    session.sessionId,
    session.attentionReason,
    session,
  );
  if (!shouldApplyAttention) return batchedAttention;
  const currentAttention = store.sessionAttention.get(session.sessionId);
  if (currentAttention === session.attentionReason) return batchedAttention;
  if (store.currentSessionId === session.sessionId && session.attentionReason) {
    api.markSessionRead(session.sessionId).catch(() => {});
    return batchedAttention;
  }
  const nextAttention = batchedAttention ?? new Map(store.sessionAttention);
  nextAttention.set(session.sessionId, session.attentionReason ?? null);
  return nextAttention;
}

async function runActiveSessionMetadataRefresh(options: ActiveSessionMetadataRefreshOptions): Promise<void> {
  try {
    const list = await api.listSessions({ includeArchived: false });
    hydrateSessionList(list, { preserveMissingArchived: true });
  } catch (error) {
    console.warn("[sessions] active metadata refresh failed:", error);
  }

  if (options.includeTreeGroups === false) return;
  try {
    await refreshTreeGroups();
  } catch (error) {
    console.warn("[sessions] tree group hydration failed:", error);
  }
}
