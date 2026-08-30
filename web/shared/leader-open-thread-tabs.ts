import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeSelectedFeedThreadKey } from "./thread-window.js";

export const LEADER_OPEN_THREAD_TABS_VERSION = 1;
export const MAX_LEADER_OPEN_THREAD_TABS = 50;
export const MAX_LEADER_CLOSED_THREAD_TOMBSTONES = 200;
export const MAX_LEADER_SERVER_CANDIDATE_PROMOTIONS = 200;

export interface LeaderClosedThreadTombstone {
  threadKey: string;
  closedAt: number;
}

export interface LeaderOpenThreadTabsState {
  version: typeof LEADER_OPEN_THREAD_TABS_VERSION;
  orderedOpenThreadKeys: string[];
  closedThreadTombstones: LeaderClosedThreadTombstone[];
  updatedAt: number;
  migratedFromLocalStorageAt?: number;
  /** Latest explicit browser ordering action; newer server candidates may still surface ahead of it. */
  explicitOrderUpdatedAt?: number;
  /** Latest accepted server-candidate event across the rail, independent of visual mutation time. */
  latestServerCandidateEventAt?: number;
  /** Bounded per-thread freshness fence for edge-triggered server promotions. */
  serverCandidatePromotedAt?: Record<string, number>;
}

export type LeaderThreadTabUpdate =
  | {
      type: "migrate";
      orderedOpenThreadKeys: string[];
      migratedAt?: number;
    }
  | {
      type: "open";
      threadKey: string;
      placement?: "first" | "last";
      source?: "user" | "route" | "server_candidate";
      eventAt?: number;
    }
  | {
      type: "close";
      threadKey: string;
      closedAt?: number;
    }
  | {
      type: "reorder";
      orderedOpenThreadKeys: string[];
    }
  | {
      /**
       * Legacy browser operation removed from the product model. Keep it as a
       * runtime no-op so stale clients cannot clear authoritative server state.
       */
      type: "auto_close";
      threadKeys?: unknown[];
    };

export function shouldPersistLeaderThreadTab(threadKey: string): boolean {
  const normalized = normalizeLeaderThreadKey(threadKey);
  return normalized !== MAIN_THREAD_KEY && normalized !== ALL_THREADS_KEY;
}

export function normalizeLeaderThreadKey(threadKey: string): string {
  return normalizeSelectedFeedThreadKey(threadKey);
}

export function normalizeLeaderOpenThreadKeys(threadKeys: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of threadKeys) {
    const rawKey = threadKeyFromLegacyValue(value);
    if (!rawKey) continue;
    const key = normalizeLeaderThreadKey(rawKey);
    if (!shouldPersistLeaderThreadTab(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length >= MAX_LEADER_OPEN_THREAD_TABS) break;
  }
  return result;
}

export function normalizeLeaderOpenThreadTabsState(candidate: unknown): LeaderOpenThreadTabsState | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Partial<LeaderOpenThreadTabsState>;
  if (record.version !== LEADER_OPEN_THREAD_TABS_VERSION) return undefined;
  const updatedAt =
    typeof record.updatedAt === "number" && Number.isFinite(record.updatedAt) ? Math.max(0, record.updatedAt) : 0;
  const migratedFromLocalStorageAt =
    typeof record.migratedFromLocalStorageAt === "number" && Number.isFinite(record.migratedFromLocalStorageAt)
      ? Math.max(0, record.migratedFromLocalStorageAt)
      : undefined;
  const explicitOrderUpdatedAt =
    typeof record.explicitOrderUpdatedAt === "number" && Number.isFinite(record.explicitOrderUpdatedAt)
      ? Math.max(0, record.explicitOrderUpdatedAt)
      : undefined;
  const latestServerCandidateEventAt = validTimestamp(record.latestServerCandidateEventAt);
  const serverCandidatePromotedAt = normalizeServerCandidatePromotedAt(record.serverCandidatePromotedAt);
  return {
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: normalizeLeaderOpenThreadKeys(record.orderedOpenThreadKeys ?? []),
    closedThreadTombstones: normalizeClosedThreadTombstones(record.closedThreadTombstones ?? []),
    updatedAt,
    ...(migratedFromLocalStorageAt !== undefined ? { migratedFromLocalStorageAt } : {}),
    ...(explicitOrderUpdatedAt !== undefined ? { explicitOrderUpdatedAt } : {}),
    ...(latestServerCandidateEventAt !== undefined ? { latestServerCandidateEventAt } : {}),
    ...(Object.keys(serverCandidatePromotedAt).length > 0 ? { serverCandidatePromotedAt } : {}),
  };
}

export function createLeaderOpenThreadTabsState(now = Date.now()): LeaderOpenThreadTabsState {
  return {
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: [],
    closedThreadTombstones: [],
    updatedAt: now,
  };
}

export function placeLeaderOpenThreadTabKey(
  existingThreadKeys: ReadonlyArray<string>,
  threadKey: string,
  placement: "first" | "last" = "first",
): string[] {
  const normalized = normalizeLeaderThreadKey(threadKey);
  if (!shouldPersistLeaderThreadTab(normalized)) return normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const normalizedExisting = normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const alreadyOpen = normalizedExisting.includes(normalized);
  if (placement === "last" && !alreadyOpen && normalizedExisting.length >= MAX_LEADER_OPEN_THREAD_TABS) {
    return normalizedExisting;
  }
  const withoutTarget = normalizedExisting.filter((key) => key !== normalized);
  const nextKeys = placement === "first" ? [normalized, ...withoutTarget] : [...withoutTarget, normalized];
  return normalizeLeaderOpenThreadKeys(nextKeys);
}

export function placeLeaderOpenThreadTabBeforeKeys(
  existingThreadKeys: ReadonlyArray<string>,
  threadKey: string,
  beforeThreadKeys: ReadonlySet<string>,
): string[] {
  const normalized = normalizeLeaderThreadKey(threadKey);
  if (!shouldPersistLeaderThreadTab(normalized)) return normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const normalizedExisting = normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const originalIndex = normalizedExisting.indexOf(normalized);
  const withoutTarget = normalizedExisting.filter((key) => key !== normalized);
  const boundaryIndex = withoutTarget.findIndex((key) => beforeThreadKeys.has(key));
  const insertionIndex =
    originalIndex >= 0
      ? Math.min(originalIndex, boundaryIndex < 0 ? originalIndex : boundaryIndex)
      : boundaryIndex < 0
        ? withoutTarget.length
        : boundaryIndex;
  const nextKeys = [...withoutTarget.slice(0, insertionIndex), normalized, ...withoutTarget.slice(insertionIndex)];
  return normalizeLeaderOpenThreadKeys(nextKeys.slice(0, MAX_LEADER_OPEN_THREAD_TABS));
}

export function reorderLeaderOpenThreadKeys(
  existingThreadKeys: ReadonlyArray<string>,
  requestedOrder: ReadonlyArray<unknown>,
): string[] {
  const existing = normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const existingSet = new Set(existing);
  const requested = normalizeLeaderOpenThreadKeys(requestedOrder).filter((key) => existingSet.has(key));
  const requestedSet = new Set(requested);
  return [...requested, ...existing.filter((key) => !requestedSet.has(key))];
}

export function canServerCandidateOpenThread(
  state: LeaderOpenThreadTabsState | undefined,
  threadKey: string,
  eventAt: number | undefined,
  options: { allowTombstoneReopen?: boolean } = {},
): boolean {
  const normalized = normalizeLeaderThreadKey(threadKey);
  if (!shouldPersistLeaderThreadTab(normalized)) return false;
  const tombstone = state?.closedThreadTombstones.find((entry) => entry.threadKey === normalized);
  if (!tombstone) return true;
  if (options.allowTombstoneReopen === false) return false;
  return typeof eventAt === "number" && Number.isFinite(eventAt) && eventAt > tombstone.closedAt;
}

export function applyLeaderServerCandidateThreadTabEvent(
  currentState: LeaderOpenThreadTabsState | undefined,
  threadKey: string,
  eventAt: number,
  options: {
    repositionExisting?: boolean;
    placement?: "first" | "last" | "before";
    beforeThreadKeys?: ReadonlySet<string>;
    allowTombstoneReopen?: boolean;
  } = {},
): LeaderOpenThreadTabsState | undefined {
  const state = normalizeLeaderOpenThreadTabsState(currentState);
  const normalizedThreadKey = normalizeLeaderThreadKey(threadKey);
  if (!shouldPersistLeaderThreadTab(normalizedThreadKey)) return currentState ?? state;
  const alreadyOpen = state?.orderedOpenThreadKeys.includes(normalizedThreadKey) === true;
  const lastPromotionAt = state?.serverCandidatePromotedAt?.[normalizedThreadKey] ?? -1;
  if (eventAt <= lastPromotionAt) return currentState ?? state;
  if (alreadyOpen) {
    if (!options.repositionExisting) return currentState ?? state;
    const latestServerCandidateEventAt = state?.latestServerCandidateEventAt ?? state?.updatedAt ?? -1;
    if (eventAt < latestServerCandidateEventAt || eventAt <= (state?.explicitOrderUpdatedAt ?? -1)) {
      return currentState ?? state;
    }
  }
  if (
    !canServerCandidateOpenThread(state, normalizedThreadKey, eventAt, {
      allowTombstoneReopen: options.allowTombstoneReopen,
    })
  ) {
    return currentState ?? state;
  }

  const effectivePlacement =
    !alreadyOpen && state?.explicitOrderUpdatedAt !== undefined && eventAt <= state.explicitOrderUpdatedAt
      ? "last"
      : (options.placement ?? "first");
  const baseState = state ?? createLeaderOpenThreadTabsState(eventAt);
  const orderedOpenThreadKeys =
    effectivePlacement === "before"
      ? placeLeaderOpenThreadTabBeforeKeys(
          baseState.orderedOpenThreadKeys,
          normalizedThreadKey,
          options.beforeThreadKeys ?? new Set<string>(),
        )
      : placeLeaderOpenThreadTabKey(baseState.orderedOpenThreadKeys, normalizedThreadKey, effectivePlacement);
  const closedThreadTombstones = baseState.closedThreadTombstones.filter(
    (entry) => entry.threadKey !== normalizedThreadKey,
  );
  const visualChanged =
    !arraysEqual(baseState.orderedOpenThreadKeys, orderedOpenThreadKeys) ||
    !closedThreadTombstonesEqual(baseState.closedThreadTombstones, closedThreadTombstones);
  return {
    ...baseState,
    orderedOpenThreadKeys,
    closedThreadTombstones,
    updatedAt: visualChanged ? Math.max(baseState.updatedAt, eventAt) : baseState.updatedAt,
    latestServerCandidateEventAt: Math.max(baseState.latestServerCandidateEventAt ?? 0, eventAt),
    serverCandidatePromotedAt: normalizeServerCandidatePromotedAt({
      ...(baseState.serverCandidatePromotedAt ?? {}),
      [normalizedThreadKey]: eventAt,
    }),
  };
}

export function applyLeaderThreadTabUpdate(
  currentState: LeaderOpenThreadTabsState | undefined,
  update: LeaderThreadTabUpdate | { type?: unknown },
  now = Date.now(),
): LeaderOpenThreadTabsState | undefined {
  const existingState = normalizeLeaderOpenThreadTabsState(currentState);
  if (!update || typeof update !== "object") return existingState;
  const record = update as Record<string, unknown>;

  switch (record.type) {
    case "migrate": {
      if (!Array.isArray(record.orderedOpenThreadKeys)) return existingState;
      const migratedAt = validTimestamp(record.migratedAt) ?? now;
      return {
        version: LEADER_OPEN_THREAD_TABS_VERSION,
        orderedOpenThreadKeys: normalizeLeaderOpenThreadKeys(record.orderedOpenThreadKeys),
        closedThreadTombstones: [],
        updatedAt: migratedAt,
        migratedFromLocalStorageAt: migratedAt,
      };
    }
    case "open": {
      if (typeof record.threadKey !== "string") return existingState;
      const state = existingState ?? createLeaderOpenThreadTabsState(now);
      const threadKey = normalizeLeaderThreadKey(record.threadKey);
      if (!shouldPersistLeaderThreadTab(threadKey)) return state;
      const source =
        record.source === "server_candidate" ? "server_candidate" : record.source === "route" ? "route" : "user";
      const eventAt = validTimestamp(record.eventAt);
      if (source === "server_candidate" && !canServerCandidateOpenThread(state, threadKey, eventAt)) {
        return state;
      }
      const placement = record.placement === "last" ? "last" : "first";
      const orderedOpenThreadKeys = placeLeaderOpenThreadTabKey(state.orderedOpenThreadKeys, threadKey, placement);
      const closedThreadTombstones = state.closedThreadTombstones.filter((entry) => entry.threadKey !== threadKey);
      if (
        arraysEqual(state.orderedOpenThreadKeys, orderedOpenThreadKeys) &&
        closedThreadTombstones.length === state.closedThreadTombstones.length
      ) {
        return state;
      }
      return {
        ...state,
        orderedOpenThreadKeys,
        closedThreadTombstones,
        updatedAt: now,
        ...(source === "server_candidate" ? {} : { explicitOrderUpdatedAt: now }),
      };
    }
    case "close": {
      if (typeof record.threadKey !== "string") return existingState;
      const state = existingState ?? createLeaderOpenThreadTabsState(now);
      const threadKey = normalizeLeaderThreadKey(record.threadKey);
      if (!shouldPersistLeaderThreadTab(threadKey)) return state;
      const closedAt = validTimestamp(record.closedAt) ?? now;
      return {
        ...state,
        orderedOpenThreadKeys: state.orderedOpenThreadKeys.filter((key) => key !== threadKey),
        closedThreadTombstones: upsertClosedThreadTombstone(state.closedThreadTombstones, { threadKey, closedAt }),
        updatedAt: closedAt,
        explicitOrderUpdatedAt: closedAt,
      };
    }
    case "reorder": {
      if (!existingState || !Array.isArray(record.orderedOpenThreadKeys)) return existingState;
      const orderedOpenThreadKeys = reorderLeaderOpenThreadKeys(
        existingState.orderedOpenThreadKeys,
        record.orderedOpenThreadKeys,
      );
      if (
        arraysEqual(existingState.orderedOpenThreadKeys, orderedOpenThreadKeys) &&
        existingState.explicitOrderUpdatedAt === now
      ) {
        return existingState;
      }
      return {
        ...existingState,
        orderedOpenThreadKeys,
        updatedAt: now,
        explicitOrderUpdatedAt: now,
      };
    }
    case "auto_close":
    default:
      return existingState;
  }
}

function normalizeServerCandidatePromotedAt(candidate: unknown): Record<string, number> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const entries: Array<[string, number]> = [];
  for (const [rawKey, rawTimestamp] of Object.entries(candidate)) {
    const threadKey = normalizeLeaderThreadKey(rawKey);
    const timestamp = validTimestamp(rawTimestamp);
    if (!shouldPersistLeaderThreadTab(threadKey) || timestamp === undefined) continue;
    entries.push([threadKey, timestamp]);
  }
  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return Object.fromEntries(entries.slice(0, MAX_LEADER_SERVER_CANDIDATE_PROMOTIONS));
}

function closedThreadTombstonesEqual(
  left: ReadonlyArray<LeaderClosedThreadTombstone>,
  right: ReadonlyArray<LeaderClosedThreadTombstone>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (value, index) => value.threadKey === right[index]?.threadKey && value.closedAt === right[index]?.closedAt,
    )
  );
}

function arraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeClosedThreadTombstones(candidate: ReadonlyArray<unknown>): LeaderClosedThreadTombstone[] {
  const seen = new Set<string>();
  const result: LeaderClosedThreadTombstone[] = [];
  for (const value of candidate) {
    if (!value || typeof value !== "object") continue;
    const record = value as Partial<LeaderClosedThreadTombstone>;
    const threadKey = typeof record.threadKey === "string" ? normalizeLeaderThreadKey(record.threadKey) : "";
    if (!shouldPersistLeaderThreadTab(threadKey) || seen.has(threadKey)) continue;
    const closedAt = validTimestamp(record.closedAt);
    if (closedAt === undefined) continue;
    seen.add(threadKey);
    result.push({ threadKey, closedAt });
  }
  return result.sort((left, right) => right.closedAt - left.closedAt).slice(0, MAX_LEADER_CLOSED_THREAD_TOMBSTONES);
}

function upsertClosedThreadTombstone(
  existing: ReadonlyArray<LeaderClosedThreadTombstone>,
  next: LeaderClosedThreadTombstone,
): LeaderClosedThreadTombstone[] {
  return normalizeClosedThreadTombstones([next, ...existing.filter((entry) => entry.threadKey !== next.threadKey)]);
}

function validTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function threadKeyFromLegacyValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["threadKey", "questId"]) {
    const candidate = record[key];
    if (typeof candidate === "string") return candidate;
  }
  return null;
}
