import { api } from "./api.js";
import { useStore } from "./store.js";
import type { SdkSessionInfo } from "./types.js";
import type { BoardRowData } from "./components/BoardTable.js";
import {
  setSdkSessionsWithNotificationFreshness,
  shouldApplyAttentionReasonWithNotificationFreshness,
} from "./notification-status.js";
import { questOwnsSessionName } from "./utils/quest-helpers.js";
import { sessionTaskHistoryEqual, stringArrayEqual } from "./store-equality.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId, type SyncedProjectionSubscriptionIdentity } from "../shared/synced-projection.js";
import { hasSessionAttentionProjection } from "./store-synced-projections.js";

export const ACTIVE_SESSION_METADATA_STALE_REFRESH_MS = 3 * 60_000;
export const SIDEBAR_SESSION_POLL_INTERVAL_MS = 5_000;
export const SIDEBAR_SESSION_STALE_REFRESH_MS = 3 * 60_000;

const FORCE_REFRESH_AFTER_HIDDEN_MS = 60_000;

export interface HydrateSessionListOptions {
  activeSnapshotRequestSequence?: number;
  preserveMissingArchived?: boolean;
  preserveMissingSessions?: boolean;
}

export interface ActiveSessionMetadataRefreshOptions {
  force?: boolean;
  includeTreeGroups?: boolean;
}

let activeSessionMetadataRefreshInFlight: Promise<void> | null = null;
let lastActiveSessionMetadataRefreshStartedAt = 0;
let activeSessionListRequestSequence = 0;
const authoritativeArchiveRequestFences = new Map<string, number>();

export function beginActiveSessionListRequest(): number {
  return ++activeSessionListRequestSequence;
}

export function getCurrentActiveSessionListRequestSequence(): number {
  return activeSessionListRequestSequence;
}

export function applyAuthoritativeSessionArchive(sessionId: string, archivedAt?: number): void {
  authoritativeArchiveRequestFences.set(sessionId, activeSessionListRequestSequence);
  useStore.setState((state) => {
    const index = state.sdkSessions.findIndex((session) => session.sessionId === sessionId);
    if (index === -1) return state;
    const sdkSessions = state.sdkSessions.slice();
    sdkSessions[index] = {
      ...stripStoredProjectionSnapshots(sdkSessions[index]!),
      archived: true,
      ...(typeof archivedAt === "number" ? { archivedAt } : {}),
    };
    return { sdkSessions };
  });
  useStore.getState().clearSyncedProjectionsForKey(sessionId);
}

/** Reconcile transport-only REST envelopes to the projection identities accepted by the server. */
export function reconcileStoredSyncedProjectionSnapshots(
  acceptedSubscriptions: readonly SyncedProjectionSubscriptionIdentity[],
): SyncedProjectionSubscriptionIdentity[] {
  const acceptedIds = new Set(
    acceptedSubscriptions.map(({ projection, key }) => syncedProjectionEntryId(projection, key)),
  );
  const state = useStore.getState();
  const rejectedSubscriptions: SyncedProjectionSubscriptionIdentity[] = [];
  const seenSessionIds = new Set<string>();
  for (const session of state.sdkSessions) {
    if (session.archived || seenSessionIds.has(session.sessionId)) continue;
    seenSessionIds.add(session.sessionId);
    const projectionNames: string[] = [SESSION_ATTENTION_PROJECTION, SESSION_NAVIGATION_PROJECTION];
    if (
      session.isOrchestrator === true ||
      state.sessions.get(session.sessionId)?.isOrchestrator === true ||
      state.syncedProjectionKeys.has(syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, session.sessionId)) ||
      Object.prototype.hasOwnProperty.call(session, "leaderThreadTabsProjection")
    ) {
      projectionNames.push(LEADER_THREAD_TABS_PROJECTION);
    }
    for (const projection of projectionNames) {
      if (!acceptedIds.has(syncedProjectionEntryId(projection, session.sessionId))) {
        rejectedSubscriptions.push({ projection, key: session.sessionId });
      }
    }
  }

  useStore.setState((current) => {
    let changed = false;
    const sdkSessions = current.sdkSessions.map((session) => {
      const removeAttention =
        Object.prototype.hasOwnProperty.call(session, "sessionAttentionProjection") &&
        !acceptedIds.has(syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, session.sessionId));
      const removeNavigation =
        Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection") &&
        !acceptedIds.has(syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, session.sessionId));
      const removeLeaderThreadTabs =
        Object.prototype.hasOwnProperty.call(session, "leaderThreadTabsProjection") &&
        !acceptedIds.has(syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, session.sessionId));
      if (!removeAttention && !removeNavigation && !removeLeaderThreadTabs) return session;
      changed = true;
      const next = { ...session };
      if (removeAttention) delete next.sessionAttentionProjection;
      if (removeNavigation) delete next.sessionNavigationProjection;
      if (removeLeaderThreadTabs) delete next.leaderThreadTabsProjection;
      return next;
    });
    return changed ? { sdkSessions } : current;
  });
  return rejectedSubscriptions;
}

export function hydrateSessionList(list: SdkSessionInfo[], options: HydrateSessionListOptions = {}): void {
  const store = useStore.getState();
  const strippedList = list.map(stripSearchMetadata);
  let nextSdkSessions = options.preserveMissingSessions
    ? mergePartialSnapshotWithExistingSessions(strippedList, store.sdkSessions)
    : options.preserveMissingArchived
      ? mergeActiveSnapshotWithExistingArchived(strippedList, store.sdkSessions, options.activeSnapshotRequestSequence)
      : strippedList;
  const effectiveActiveSessionIds = new Set(
    nextSdkSessions.filter((session) => !session.archived).map((session) => session.sessionId),
  );

  // Projection snapshots are one-way cache hydration. Apply the response as
  // one store transaction before publishing or deriving legacy session-list
  // fields, so mixed responses cannot transiently replace newer authority or
  // notify navigation subscribers once per session.
  const projectionSnapshots = list.flatMap((session) =>
    effectiveActiveSessionIds.has(session.sessionId) ? sessionProjectionSnapshotsFromSession(session) : [],
  );
  if (projectionSnapshots.length > 0) {
    store.applySyncedProjectionSnapshots(projectionSnapshots, {
      source: "rest",
      activeRequestSequence: options.activeSnapshotRequestSequence,
    });
  }
  const projectionState = useStore.getState();
  nextSdkSessions = nextSdkSessions.map((session) =>
    stripRestFencedProjectionSnapshots(session, projectionState, options.activeSnapshotRequestSequence),
  );

  setSdkSessionsWithNotificationFreshness(nextSdkSessions);

  for (const session of list) {
    hydrateSessionDerivedMetadata(store, session);
  }

  const attentionStore = useStore.getState();
  const effectiveSessionsById = new Map(nextSdkSessions.map((session) => [session.sessionId, session]));
  let batchedAttention: Map<string, "action" | "error" | "review" | null> | null = null;
  for (const listedSession of list) {
    if (!effectiveActiveSessionIds.has(listedSession.sessionId)) continue;
    const session = effectiveSessionsById.get(listedSession.sessionId) ?? listedSession;
    if (sessionAttentionProjectionFromSession(session).present) continue;
    batchedAttention = collectAttentionUpdate(attentionStore, session, batchedAttention);
  }
  if (batchedAttention) useStore.setState({ sessionAttention: batchedAttention });
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
  activeSessionListRequestSequence = 0;
  authoritativeArchiveRequestFences.clear();
}

function hasStoredProjectionSnapshot(session: SdkSessionInfo): boolean {
  return (
    Object.prototype.hasOwnProperty.call(session, "sessionAttentionProjection") ||
    Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection") ||
    Object.prototype.hasOwnProperty.call(session, "leaderThreadTabsProjection")
  );
}

function stripStoredProjectionSnapshots(session: SdkSessionInfo): SdkSessionInfo {
  const {
    sessionAttentionProjection: _sessionAttentionProjection,
    sessionNavigationProjection: _sessionNavigationProjection,
    leaderThreadTabsProjection: _leaderThreadTabsProjection,
    ...rest
  } = session;
  return rest;
}

function stripRestFencedProjectionSnapshots(
  session: SdkSessionInfo,
  state: Pick<ReturnType<typeof useStore.getState>, "syncedProjectionKeys" | "syncedProjectionOrderings">,
  activeRequestSequence?: number,
): SdkSessionInfo {
  const requestSequence =
    typeof activeRequestSequence === "number" &&
    Number.isSafeInteger(activeRequestSequence) &&
    activeRequestSequence >= 0
      ? activeRequestSequence
      : undefined;
  const isFenced = (projection: string) => {
    const entryId = syncedProjectionEntryId(projection, session.sessionId);
    if (state.syncedProjectionKeys.has(entryId)) return false;
    const ordering = state.syncedProjectionOrderings.get(entryId);
    if (ordering?.subscriptionRejected) return true;
    const barrier = ordering?.liveRequestSequenceBarrier;
    return barrier !== undefined && (requestSequence === undefined || requestSequence <= barrier);
  };
  const removeAttention =
    Object.prototype.hasOwnProperty.call(session, "sessionAttentionProjection") &&
    isFenced(SESSION_ATTENTION_PROJECTION);
  const removeNavigation =
    Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection") &&
    isFenced(SESSION_NAVIGATION_PROJECTION);
  const removeLeaderThreadTabs =
    Object.prototype.hasOwnProperty.call(session, "leaderThreadTabsProjection") &&
    isFenced(LEADER_THREAD_TABS_PROJECTION);
  if (!removeAttention && !removeNavigation && !removeLeaderThreadTabs) return session;
  const next = { ...session };
  if (removeAttention) delete next.sessionAttentionProjection;
  if (removeNavigation) delete next.sessionNavigationProjection;
  if (removeLeaderThreadTabs) delete next.leaderThreadTabsProjection;
  return next;
}

function sessionAttentionProjectionFromSession(session: SdkSessionInfo): { present: boolean; value?: unknown } {
  if (!("sessionAttentionProjection" in session)) return { present: false };
  return {
    present: true,
    value: session.sessionAttentionProjection,
  };
}

function sessionProjectionSnapshotsFromSession(session: SdkSessionInfo): unknown[] {
  const snapshots: unknown[] = [];
  if ("sessionAttentionProjection" in session) snapshots.push(session.sessionAttentionProjection);
  if ("sessionNavigationProjection" in session) snapshots.push(session.sessionNavigationProjection);
  if ("leaderThreadTabsProjection" in session) snapshots.push(session.leaderThreadTabsProjection);
  return snapshots;
}

function stripSearchMetadata(session: SdkSessionInfo): SdkSessionInfo {
  const {
    taskHistory: _taskHistory,
    keywords: _keywords,
    leaderActiveBoardRows: _leaderActiveBoardRows,
    ...rest
  } = session;
  return rest;
}

function mergeActiveSnapshotWithExistingArchived(
  activeSnapshot: SdkSessionInfo[],
  currentSessions: SdkSessionInfo[],
  requestSequence?: number,
): SdkSessionInfo[] {
  const snapshotActiveIds = new Set(activeSnapshot.map((session) => session.sessionId));
  const staleArchivedIds = new Set<string>();
  if (requestSequence !== undefined) {
    for (const session of currentSessions) {
      if (!session.archived) continue;
      const archiveFence = authoritativeArchiveRequestFences.get(session.sessionId);
      if (archiveFence === undefined) continue;
      if (requestSequence <= archiveFence) {
        staleArchivedIds.add(session.sessionId);
      } else if (snapshotActiveIds.has(session.sessionId)) {
        authoritativeArchiveRequestFences.delete(session.sessionId);
      }
    }
  }
  const effectiveActiveSnapshot =
    staleArchivedIds.size === 0
      ? activeSnapshot
      : activeSnapshot.filter((session) => !staleArchivedIds.has(session.sessionId));
  const activeIds = new Set(effectiveActiveSnapshot.map((session) => session.sessionId));
  const preservedArchived = currentSessions.filter((session) => session.archived && !activeIds.has(session.sessionId));
  return [...effectiveActiveSnapshot, ...preservedArchived];
}

function mergePartialSnapshotWithExistingSessions(
  partialSnapshot: SdkSessionInfo[],
  currentSessions: SdkSessionInfo[],
): SdkSessionInfo[] {
  const partialIds = new Set(partialSnapshot.map((session) => session.sessionId));
  const preservedSessions = currentSessions.filter((session) => !partialIds.has(session.sessionId));
  return [...partialSnapshot, ...preservedSessions];
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
  if (session.isOrchestrator === true && Array.isArray(session.leaderActiveBoardRows)) {
    const currentBoardRows = store.sessionBoards.get(session.sessionId);
    if (!boardRowsEqual(currentBoardRows, session.leaderActiveBoardRows)) {
      store.setSessionBoard(session.sessionId, session.leaderActiveBoardRows);
    }
  }
}

function boardRowsEqual(a: BoardRowData[] | undefined, b: BoardRowData[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!boardRowEqual(a[i]!, b[i]!)) return false;
  }
  return true;
}

function boardRowEqual(a: BoardRowData, b: BoardRowData): boolean {
  return (
    a.questId === b.questId &&
    a.title === b.title &&
    a.worker === b.worker &&
    a.workerNum === b.workerNum &&
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.completedAt === b.completedAt &&
    stringArrayEqual(a.waitFor, b.waitFor) &&
    stringArrayEqual(a.waitForInput, b.waitForInput) &&
    JSON.stringify(a.journey ?? null) === JSON.stringify(b.journey ?? null)
  );
}

function collectAttentionUpdate(
  store: ReturnType<typeof useStore.getState>,
  session: SdkSessionInfo,
  batchedAttention: Map<string, "action" | "error" | "review" | null> | null,
): Map<string, "action" | "error" | "review" | null> | null {
  if (hasSessionAttentionProjection(store, session.sessionId) || session.attentionReason === undefined) {
    return batchedAttention;
  }
  const shouldApplyAttention = shouldApplyAttentionReasonWithNotificationFreshness(
    session.sessionId,
    session.attentionReason,
    session,
  );
  if (!shouldApplyAttention) return batchedAttention;
  const currentAttention = store.sessionAttention.get(session.sessionId);
  if (currentAttention === session.attentionReason) return batchedAttention;
  if (store.currentSessionId === session.sessionId && session.attentionReason) {
    api.markSessionRead(session.sessionId, { mode: "session-view" }).catch(() => {});
    return batchedAttention;
  }
  const nextAttention = batchedAttention ?? new Map(store.sessionAttention);
  nextAttention.set(session.sessionId, session.attentionReason ?? null);
  return nextAttention;
}

async function runActiveSessionMetadataRefresh(options: ActiveSessionMetadataRefreshOptions): Promise<void> {
  try {
    const requestSequence = beginActiveSessionListRequest();
    const list = await api.listSessions({ includeArchived: false });
    hydrateSessionList(list, { preserveMissingArchived: true, activeSnapshotRequestSequence: requestSequence });
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
