import { api } from "./api.js";
import { useStore } from "./store.js";
import type { SdkSessionInfo } from "./types.js";
import { setSdkSessionsWithNotificationFreshness } from "./notification-status.js";
import { sessionTaskHistoryEqual, stringArrayEqual } from "./store-equality.js";
import {
  SESSION_NAVIGATION_PROJECTION,
  sessionNavigationFieldsFromSession,
  sessionNavigationProjectionToSessionFields,
} from "../shared/session-navigation-projection.js";
import {
  SYNCED_PROJECTION_DESCRIPTORS,
  SYNCED_PROJECTION_DESCRIPTOR_LIST,
  isSyncedProjectionEligibleForSession,
  type AnySyncedProjectionDescriptor,
} from "../shared/synced-projection-registry.js";
import { syncedProjectionEntryId, type SyncedProjectionSubscriptionIdentity } from "../shared/synced-projection.js";
import { getSyncedProjectionValue, hasSyncedProjectionValue } from "./store-synced-projections.js";

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
    for (const descriptor of SYNCED_PROJECTION_DESCRIPTOR_LIST) {
      if (!projectionEligibleForStoredSession(descriptor, session, state)) continue;
      if (!acceptedIds.has(syncedProjectionEntryId(descriptor.projection, session.sessionId))) {
        rejectedSubscriptions.push({ projection: descriptor.projection, key: session.sessionId });
      }
    }
  }

  useStore.setState((current) => {
    let changed = false;
    const sdkSessions = current.sdkSessions.map((session) => {
      let next = session;
      for (const descriptor of SYNCED_PROJECTION_DESCRIPTOR_LIST) {
        if (
          !hasOwnProjectionEnvelope(session, descriptor) ||
          acceptedIds.has(syncedProjectionEntryId(descriptor.projection, session.sessionId))
        ) {
          continue;
        }
        if (next === session) next = { ...session };
        deleteProjectionEnvelope(next, descriptor);
        changed = true;
      }
      return next;
    });
    return changed ? { sdkSessions } : current;
  });
  return rejectedSubscriptions;
}

export function hydrateSessionList(list: SdkSessionInfo[], options: HydrateSessionListOptions = {}): void {
  const store = useStore.getState();
  const currentSessionsById = new Map(store.sdkSessions.map((session) => [session.sessionId, session]));
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
  nextSdkSessions = nextSdkSessions.map((session) => {
    const navigationDescriptor = SYNCED_PROJECTION_DESCRIPTORS[SESSION_NAVIGATION_PROJECTION];
    const preserveCurrentNavigation =
      hasOwnProjectionEnvelope(session, navigationDescriptor) &&
      isRestProjectionFenced(session, navigationDescriptor, projectionState, options.activeSnapshotRequestSequence);
    const stripped = stripRestFencedProjectionSnapshots(
      session,
      projectionState,
      options.activeSnapshotRequestSequence,
    );
    if (!effectiveActiveSessionIds.has(session.sessionId)) return stripped;
    const navigation = getSyncedProjectionValue(projectionState, SESSION_NAVIGATION_PROJECTION, session.sessionId);
    if (navigation) return { ...stripped, ...sessionNavigationProjectionToSessionFields(navigation) };
    const current = preserveCurrentNavigation ? currentSessionsById.get(session.sessionId) : undefined;
    return current ? { ...stripped, ...sessionNavigationFieldsFromSession(current) } : stripped;
  });

  setSdkSessionsWithNotificationFreshness(nextSdkSessions);

  for (const session of list) {
    hydrateSessionDerivedMetadata(store, session);
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
  activeSessionListRequestSequence = 0;
  authoritativeArchiveRequestFences.clear();
}

function hasOwnProjectionEnvelope(session: SdkSessionInfo, descriptor: AnySyncedProjectionDescriptor): boolean {
  return Object.prototype.hasOwnProperty.call(session, descriptor.restField);
}

function projectionEnvelopeFromSession(session: SdkSessionInfo, descriptor: AnySyncedProjectionDescriptor): unknown {
  return session[descriptor.restField];
}

function deleteProjectionEnvelope(session: SdkSessionInfo, descriptor: AnySyncedProjectionDescriptor): void {
  delete session[descriptor.restField];
}

function projectionEligibleForStoredSession(
  descriptor: AnySyncedProjectionDescriptor,
  session: SdkSessionInfo,
  state: Pick<ReturnType<typeof useStore.getState>, "sessions" | "syncedProjectionKeys">,
): boolean {
  const isOrchestrator =
    session.isOrchestrator === true || state.sessions.get(session.sessionId)?.isOrchestrator === true;
  if (isSyncedProjectionEligibleForSession(descriptor, { isOrchestrator })) return true;

  // Preserve an already-observed leader projection until the exact replacement
  // ACK decides its authority, even if a partial REST row omitted role metadata.
  const entryId = syncedProjectionEntryId(descriptor.projection, session.sessionId);
  return state.syncedProjectionKeys.has(entryId) || hasOwnProjectionEnvelope(session, descriptor);
}

function stripStoredProjectionSnapshots(session: SdkSessionInfo): SdkSessionInfo {
  const next = { ...session };
  for (const descriptor of SYNCED_PROJECTION_DESCRIPTOR_LIST) {
    deleteProjectionEnvelope(next, descriptor);
  }
  return next;
}

function isRestProjectionFenced(
  session: SdkSessionInfo,
  descriptor: AnySyncedProjectionDescriptor,
  state: Pick<ReturnType<typeof useStore.getState>, "syncedProjectionKeys" | "syncedProjectionOrderings">,
  activeRequestSequence?: number,
): boolean {
  const entryId = syncedProjectionEntryId(descriptor.projection, session.sessionId);
  if (state.syncedProjectionKeys.has(entryId)) return false;
  const ordering = state.syncedProjectionOrderings.get(entryId);
  if (ordering?.subscriptionRejected) return true;
  const barrier = ordering?.liveRequestSequenceBarrier;
  const requestSequence =
    typeof activeRequestSequence === "number" &&
    Number.isSafeInteger(activeRequestSequence) &&
    activeRequestSequence >= 0
      ? activeRequestSequence
      : undefined;
  return barrier !== undefined && (requestSequence === undefined || requestSequence <= barrier);
}

function stripRestFencedProjectionSnapshots(
  session: SdkSessionInfo,
  state: Pick<ReturnType<typeof useStore.getState>, "syncedProjectionKeys" | "syncedProjectionOrderings">,
  activeRequestSequence?: number,
): SdkSessionInfo {
  let next = session;
  for (const descriptor of SYNCED_PROJECTION_DESCRIPTOR_LIST) {
    if (
      !hasOwnProjectionEnvelope(session, descriptor) ||
      !isRestProjectionFenced(session, descriptor, state, activeRequestSequence)
    ) {
      continue;
    }
    if (next === session) next = { ...session };
    deleteProjectionEnvelope(next, descriptor);
  }
  return next;
}

function sessionProjectionSnapshotsFromSession(session: SdkSessionInfo): unknown[] {
  const snapshots: unknown[] = [];
  for (const descriptor of SYNCED_PROJECTION_DESCRIPTOR_LIST) {
    if (hasOwnProjectionEnvelope(session, descriptor)) {
      snapshots.push(projectionEnvelopeFromSession(session, descriptor));
    }
  }
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
