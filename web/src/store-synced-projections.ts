import type { StateCreator } from "zustand";
import {
  SYNCED_PROJECTION_SCHEMA_VERSION,
  isValidSyncedProjectionIdentity,
  isValidSyncedProjectionRevision,
  syncedProjectionEntryId,
  type SyncedProjectionEnvelope,
  type SyncedProjectionVersion,
} from "../shared/synced-projection.js";
import {
  SESSION_ATTENTION_PROJECTION,
  isSessionAttentionProjectionValue,
  sessionAttentionProjectionEqual,
  type SessionAttentionProjectionValue,
} from "../shared/session-attention-projection.js";
import type { AppState } from "./store-types.js";
import type { LeaderProjectionSnapshot } from "./types.js";

export interface SyncedProjectionApplyResult {
  /** At least one cache/version/compatibility map changed. */
  applied: boolean;
  /** The envelope was a usable authoritative value rather than stale or malformed input. */
  accepted: boolean;
  /** The carrier transport should request one deduplicated snapshot for this key. */
  requestResync: boolean;
}

export type SyncedProjectionSnapshotSource = "live" | "rest";

export interface SyncedProjectionSnapshotApplyOptions {
  /** Accept a same-revision replacement only for a transport-correlated resync response. */
  acceptSameRevisionConflict?: boolean;
  /** Distinguishes selected-carrier snapshots from REST cache hydration. */
  source?: SyncedProjectionSnapshotSource;
  /** Active-list request sequence visible when this authoritative payload was received or requested. */
  activeRequestSequence?: number;
}

export interface SyncedProjectionUpdateApplyOptions {
  /** Active-list request sequence visible when this selected-carrier update was received. */
  activeRequestSequence?: number;
}

export interface SyncedProjectionOrderingState {
  /** Newest active-list request whose valid envelope was observed for this key. */
  latestRestRequestSequence?: number;
  /** Requests at or below this sequence predate selected-carrier authority. */
  liveRequestSequenceBarrier?: number;
}

export interface SyncedProjectionCacheState {
  syncedProjectionValues: Map<string, unknown>;
  syncedProjectionVersions: Map<string, SyncedProjectionVersion>;
  syncedProjectionKeys: Set<string>;
  syncedProjectionOrderings: Map<string, SyncedProjectionOrderingState>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
}

export interface SyncedProjectionCacheApplication {
  state: SyncedProjectionCacheState;
  result: SyncedProjectionApplyResult;
  projection?: string;
  key?: string;
}

type ProjectionDescriptor = {
  isValue: (value: unknown) => boolean;
  equal: (left: unknown, right: unknown) => boolean;
};

const INVALID_RESULT: SyncedProjectionApplyResult = {
  applied: false,
  accepted: false,
  requestResync: false,
};
const STALE_RESULT: SyncedProjectionApplyResult = {
  applied: false,
  accepted: false,
  requestResync: false,
};
const UNCHANGED_RESULT: SyncedProjectionApplyResult = {
  applied: false,
  accepted: true,
  requestResync: false,
};
const RESYNC_RESULT: SyncedProjectionApplyResult = {
  applied: false,
  accepted: false,
  requestResync: true,
};

function descriptorForProjection(projection: string): ProjectionDescriptor | null {
  if (projection !== SESSION_ATTENTION_PROJECTION) return null;
  return {
    isValue: isSessionAttentionProjectionValue,
    equal: (left, right) =>
      sessionAttentionProjectionEqual(
        left as SessionAttentionProjectionValue,
        right as SessionAttentionProjectionValue,
      ),
  };
}

function parseKnownEnvelope(input: unknown): {
  envelope: SyncedProjectionEnvelope<unknown>;
  descriptor: ProjectionDescriptor;
} | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as Partial<SyncedProjectionEnvelope<unknown>>;
  if (candidate.schemaVersion !== SYNCED_PROJECTION_SCHEMA_VERSION) return null;
  if (!isValidSyncedProjectionIdentity(candidate.projection)) return null;
  if (!isValidSyncedProjectionIdentity(candidate.key)) return null;
  if (!isValidSyncedProjectionIdentity(candidate.generation)) return null;
  if (!isValidSyncedProjectionRevision(candidate.revision)) return null;
  if (!("value" in candidate)) return null;
  const descriptor = descriptorForProjection(candidate.projection);
  if (!descriptor || !descriptor.isValue(candidate.value)) return null;
  return {
    envelope: candidate as SyncedProjectionEnvelope<unknown>,
    descriptor,
  };
}

/** True when a fully valid snapshot is already covered by same-generation cache authority. */
export function cacheCoversSyncedProjectionSnapshot(
  state: Pick<AppState, "syncedProjectionKeys" | "syncedProjectionVersions">,
  input: unknown,
): boolean {
  const parsed = parseKnownEnvelope(input);
  if (!parsed) return false;
  const { envelope } = parsed;
  const entryId = syncedProjectionEntryId(envelope.projection, envelope.key);
  const current = state.syncedProjectionVersions.get(entryId);
  return (
    state.syncedProjectionKeys.has(entryId) &&
    current?.generation === envelope.generation &&
    current.revision >= envelope.revision
  );
}

function normalizeActiveRequestSequence(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function applyOrderingMetadata(
  state: SyncedProjectionCacheState,
  envelope: SyncedProjectionEnvelope<unknown>,
  options: Pick<SyncedProjectionSnapshotApplyOptions, "source" | "activeRequestSequence">,
): { state: SyncedProjectionCacheState; rejectSnapshot: boolean } {
  const entryId = syncedProjectionEntryId(envelope.projection, envelope.key);
  const current = state.syncedProjectionOrderings.get(entryId);
  const requestSequence = normalizeActiveRequestSequence(options.activeRequestSequence);
  let next = current;
  let rejectSnapshot = false;

  if (options.source === "live") {
    const liveRequestSequenceBarrier = requestSequence ?? 0;
    if (
      current?.liveRequestSequenceBarrier === undefined ||
      liveRequestSequenceBarrier > current.liveRequestSequenceBarrier
    ) {
      next = { ...current, liveRequestSequenceBarrier };
    }
  } else if (options.source === "rest") {
    if (
      requestSequence !== undefined &&
      current?.latestRestRequestSequence !== undefined &&
      requestSequence < current.latestRestRequestSequence
    ) {
      return { state, rejectSnapshot: true };
    }
    if (requestSequence !== undefined && current?.latestRestRequestSequence !== requestSequence) {
      next = { ...current, latestRestRequestSequence: requestSequence };
    }

    const currentVersion = state.syncedProjectionVersions.get(entryId);
    if (
      state.syncedProjectionKeys.has(entryId) &&
      currentVersion &&
      currentVersion.generation !== envelope.generation &&
      current?.liveRequestSequenceBarrier !== undefined &&
      (requestSequence === undefined || requestSequence <= current.liveRequestSequenceBarrier)
    ) {
      rejectSnapshot = true;
    }
  }

  if (next === current) return { state, rejectSnapshot };
  const syncedProjectionOrderings = new Map(state.syncedProjectionOrderings);
  syncedProjectionOrderings.set(entryId, next ?? {});
  return {
    state: { ...state, syncedProjectionOrderings },
    rejectSnapshot,
  };
}

function applicationWithResult(
  state: SyncedProjectionCacheState,
  result: SyncedProjectionApplyResult,
  projection: string,
  key: string,
): SyncedProjectionCacheApplication {
  return {
    state,
    // Ordering metadata is transport bookkeeping, not a visible cache/value application.
    result,
    projection,
    key,
  };
}

function commitEnvelope(
  state: SyncedProjectionCacheState,
  envelope: SyncedProjectionEnvelope<unknown>,
  descriptor: ProjectionDescriptor,
  options: { requestResync: boolean },
): SyncedProjectionCacheApplication {
  const entryId = syncedProjectionEntryId(envelope.projection, envelope.key);
  const hadAuthority = state.syncedProjectionKeys.has(entryId);
  const currentValue = state.syncedProjectionValues.get(entryId);
  const valueEqual =
    hadAuthority && state.syncedProjectionValues.has(entryId) && descriptor.equal(currentValue, envelope.value);

  let syncedProjectionValues = state.syncedProjectionValues;
  if (!valueEqual) {
    syncedProjectionValues = new Map(syncedProjectionValues);
    syncedProjectionValues.set(entryId, envelope.value);
  }

  let syncedProjectionVersions = state.syncedProjectionVersions;
  const currentVersion = syncedProjectionVersions.get(entryId);
  if (currentVersion?.generation !== envelope.generation || currentVersion?.revision !== envelope.revision) {
    syncedProjectionVersions = new Map(syncedProjectionVersions);
    syncedProjectionVersions.set(entryId, {
      generation: envelope.generation,
      revision: envelope.revision,
    });
  }

  let syncedProjectionKeys = state.syncedProjectionKeys;
  if (!hadAuthority) {
    syncedProjectionKeys = new Set(syncedProjectionKeys);
    syncedProjectionKeys.add(entryId);
  }

  let sessionAttention = state.sessionAttention;
  if (envelope.projection === SESSION_ATTENTION_PROJECTION) {
    const attentionReason = (envelope.value as SessionAttentionProjectionValue).attentionReason;
    if (!sessionAttention.has(envelope.key) || sessionAttention.get(envelope.key) !== attentionReason) {
      sessionAttention = new Map(sessionAttention);
      sessionAttention.set(envelope.key, attentionReason);
    }
  }

  const changed =
    syncedProjectionValues !== state.syncedProjectionValues ||
    syncedProjectionVersions !== state.syncedProjectionVersions ||
    syncedProjectionKeys !== state.syncedProjectionKeys ||
    sessionAttention !== state.sessionAttention;
  return {
    state: {
      syncedProjectionValues,
      syncedProjectionVersions,
      syncedProjectionKeys,
      syncedProjectionOrderings: state.syncedProjectionOrderings,
      sessionAttention,
    },
    result: {
      applied: changed,
      accepted: true,
      requestResync: options.requestResync,
    },
    projection: envelope.projection,
    key: envelope.key,
  };
}

/** Pure cache reducer for an authoritative snapshot. */
export function applySyncedProjectionSnapshotToCache(
  state: SyncedProjectionCacheState,
  input: unknown,
  options: SyncedProjectionSnapshotApplyOptions = {},
): SyncedProjectionCacheApplication {
  const parsed = parseKnownEnvelope(input);
  if (!parsed) return { state, result: INVALID_RESULT };
  const { envelope, descriptor } = parsed;
  const ordered = applyOrderingMetadata(state, envelope, options);
  const orderedState = ordered.state;
  const entryId = syncedProjectionEntryId(envelope.projection, envelope.key);
  const hasAuthority = orderedState.syncedProjectionKeys.has(entryId);
  const currentVersion = orderedState.syncedProjectionVersions.get(entryId);

  if (ordered.rejectSnapshot) {
    return applicationWithResult(orderedState, STALE_RESULT, envelope.projection, envelope.key);
  }
  if (hasAuthority && currentVersion?.generation === envelope.generation) {
    if (envelope.revision < currentVersion.revision) {
      return applicationWithResult(orderedState, STALE_RESULT, envelope.projection, envelope.key);
    }
    if (envelope.revision === currentVersion.revision) {
      const currentValue = orderedState.syncedProjectionValues.get(entryId);
      if (!orderedState.syncedProjectionValues.has(entryId) || !descriptor.equal(currentValue, envelope.value)) {
        if (options.acceptSameRevisionConflict) {
          return commitEnvelope(orderedState, envelope, descriptor, { requestResync: false });
        }
        return applicationWithResult(orderedState, RESYNC_RESULT, envelope.projection, envelope.key);
      }
      return applicationWithResult(orderedState, UNCHANGED_RESULT, envelope.projection, envelope.key);
    }
  }

  // Current-socket snapshots are the authority for adopting a server
  // generation. REST snapshots may do so only when request/source ordering has
  // not proven them older than selected-carrier authority.
  return commitEnvelope(orderedState, envelope, descriptor, { requestResync: false });
}

/** Pure cache reducer for one full-replacement projection update. */
export function applySyncedProjectionUpdateToCache(
  state: SyncedProjectionCacheState,
  input: unknown,
  options: SyncedProjectionUpdateApplyOptions = {},
): SyncedProjectionCacheApplication {
  const parsed = parseKnownEnvelope(input);
  if (!parsed) return { state, result: INVALID_RESULT };
  const { envelope, descriptor } = parsed;
  const entryId = syncedProjectionEntryId(envelope.projection, envelope.key);
  const ordered = state.syncedProjectionKeys.has(entryId)
    ? applyOrderingMetadata(state, envelope, {
        source: "live",
        activeRequestSequence: options.activeRequestSequence,
      })
    : { state, rejectSnapshot: false };
  const orderedState = ordered.state;
  const hasAuthority = orderedState.syncedProjectionKeys.has(entryId);
  const currentVersion = orderedState.syncedProjectionVersions.get(entryId);

  // A live update cannot establish or switch generation authority. Ask the
  // carrier for a snapshot and retain the last accepted value until it arrives.
  if (!hasAuthority || !currentVersion || currentVersion.generation !== envelope.generation) {
    return applicationWithResult(orderedState, RESYNC_RESULT, envelope.projection, envelope.key);
  }
  if (envelope.revision < currentVersion.revision) {
    return applicationWithResult(orderedState, STALE_RESULT, envelope.projection, envelope.key);
  }
  if (envelope.revision === currentVersion.revision) {
    const currentValue = orderedState.syncedProjectionValues.get(entryId);
    if (!orderedState.syncedProjectionValues.has(entryId) || !descriptor.equal(currentValue, envelope.value)) {
      return applicationWithResult(orderedState, RESYNC_RESULT, envelope.projection, envelope.key);
    }
    return applicationWithResult(orderedState, UNCHANGED_RESULT, envelope.projection, envelope.key);
  }

  const isContiguous = envelope.revision === currentVersion.revision + 1;
  return commitEnvelope(orderedState, envelope, descriptor, { requestResync: !isContiguous });
}

export function getSyncedProjectionValue<T = unknown>(
  state: Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys">,
  projection: string,
  key: string,
): T | undefined {
  const entryId = syncedProjectionEntryId(projection, key);
  if (!state.syncedProjectionKeys?.has(entryId)) return undefined;
  return state.syncedProjectionValues?.get(entryId) as T | undefined;
}

export function hasSyncedProjectionValue(
  state: Pick<AppState, "syncedProjectionKeys">,
  projection: string,
  key: string,
): boolean {
  return state.syncedProjectionKeys?.has(syncedProjectionEntryId(projection, key)) ?? false;
}

export function getSessionAttentionProjection(
  state: Pick<AppState, "syncedProjectionValues" | "syncedProjectionKeys">,
  sessionId: string,
): SessionAttentionProjectionValue | undefined {
  return getSyncedProjectionValue<SessionAttentionProjectionValue>(state, SESSION_ATTENTION_PROJECTION, sessionId);
}

export function hasSessionAttentionProjection(
  state: Pick<AppState, "syncedProjectionKeys">,
  sessionId: string,
): boolean {
  return hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, sessionId);
}

type StoreSet = Parameters<StateCreator<AppState>>[0];
type SyncedProjectionStoreSlice = Pick<
  AppState,
  | "leaderProjections"
  | "setLeaderProjection"
  | "syncedProjectionValues"
  | "syncedProjectionVersions"
  | "syncedProjectionKeys"
  | "syncedProjectionOrderings"
  | "applySyncedProjectionSnapshot"
  | "applySyncedProjectionUpdate"
  | "clearSyncedProjectionKey"
  | "reconcileSyncedProjectionAuthority"
>;

export function createSyncedProjectionStoreSlice(set: StoreSet): SyncedProjectionStoreSlice {
  const apply = (
    reducer: (state: SyncedProjectionCacheState) => SyncedProjectionCacheApplication,
  ): SyncedProjectionApplyResult => {
    let result = INVALID_RESULT;
    set((state) => {
      const application = reducer(state);
      result = application.result;
      return application.state === state ? state : application.state;
    });
    return result;
  };

  return {
    leaderProjections: new Map(),
    setLeaderProjection: (sessionId: string, projection: LeaderProjectionSnapshot | null) =>
      set((state) => {
        const current = state.leaderProjections.get(sessionId);
        if (projection ? current === projection : !state.leaderProjections.has(sessionId)) return state;
        const leaderProjections = new Map(state.leaderProjections);
        if (projection) leaderProjections.set(sessionId, projection);
        else leaderProjections.delete(sessionId);
        return { leaderProjections };
      }),
    syncedProjectionValues: new Map(),
    syncedProjectionVersions: new Map(),
    syncedProjectionKeys: new Set(),
    syncedProjectionOrderings: new Map(),
    applySyncedProjectionSnapshot: (snapshot, options) =>
      apply((state) => applySyncedProjectionSnapshotToCache(state, snapshot, options)),
    applySyncedProjectionUpdate: (update, options) =>
      apply((state) => applySyncedProjectionUpdateToCache(state, update, options)),
    clearSyncedProjectionKey: (projection, key) =>
      set((state) => {
        const entryId = syncedProjectionEntryId(projection, key);
        if (!state.syncedProjectionKeys.has(entryId) && !state.syncedProjectionOrderings.has(entryId)) return state;
        const syncedProjectionValues = new Map(state.syncedProjectionValues);
        const syncedProjectionVersions = new Map(state.syncedProjectionVersions);
        const syncedProjectionKeys = new Set(state.syncedProjectionKeys);
        const syncedProjectionOrderings = new Map(state.syncedProjectionOrderings);
        syncedProjectionValues.delete(entryId);
        syncedProjectionVersions.delete(entryId);
        syncedProjectionKeys.delete(entryId);
        syncedProjectionOrderings.delete(entryId);

        let sessionAttention = state.sessionAttention;
        if (projection === SESSION_ATTENTION_PROJECTION && sessionAttention.has(key)) {
          sessionAttention = new Map(sessionAttention);
          sessionAttention.delete(key);
        }
        return {
          syncedProjectionValues,
          syncedProjectionVersions,
          syncedProjectionKeys,
          syncedProjectionOrderings,
          sessionAttention,
        };
      }),
    reconcileSyncedProjectionAuthority: (subscriptions) =>
      set((state) => {
        const acceptedIds = new Set(
          subscriptions.map(({ projection, key }) => syncedProjectionEntryId(projection, key)),
        );
        const revokedIds = [
          ...new Set([...state.syncedProjectionKeys, ...state.syncedProjectionOrderings.keys()]),
        ].filter((entryId) => !acceptedIds.has(entryId));
        if (revokedIds.length === 0) return state;

        const syncedProjectionValues = new Map(state.syncedProjectionValues);
        const syncedProjectionVersions = new Map(state.syncedProjectionVersions);
        const syncedProjectionKeys = new Set(state.syncedProjectionKeys);
        const syncedProjectionOrderings = new Map(state.syncedProjectionOrderings);
        let sessionAttention = state.sessionAttention;
        for (const entryId of revokedIds) {
          syncedProjectionValues.delete(entryId);
          syncedProjectionVersions.delete(entryId);
          syncedProjectionKeys.delete(entryId);
          syncedProjectionOrderings.delete(entryId);
          const separator = entryId.indexOf("\u0000");
          const projection = entryId.slice(0, separator);
          const key = entryId.slice(separator + 1);
          if (projection === SESSION_ATTENTION_PROJECTION && sessionAttention.has(key)) {
            if (sessionAttention === state.sessionAttention) sessionAttention = new Map(sessionAttention);
            sessionAttention.delete(key);
          }
        }
        return {
          syncedProjectionValues,
          syncedProjectionVersions,
          syncedProjectionKeys,
          syncedProjectionOrderings,
          sessionAttention,
        };
      }),
  };
}
