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
  | { type: "migrate"; orderedOpenThreadKeys: string[]; migratedAt?: number }
  | { type: "open"; threadKey: string; placement?: "first" | "last" }
  | { type: "close"; threadKey: string; closedAt?: number }
  | { type: "reorder"; orderedOpenThreadKeys: string[] };

type ServerCandidateOptions = {
  repositionExisting?: boolean;
  placement?: "first" | "last" | "before";
  beforeThreadKeys?: ReadonlySet<string>;
  allowTombstoneReopen?: boolean;
};

const OPTIONAL_TIMESTAMP_FIELDS = [
  "migratedFromLocalStorageAt",
  "explicitOrderUpdatedAt",
  "latestServerCandidateEventAt",
] as const;

export const normalizeLeaderThreadKey = normalizeSelectedFeedThreadKey;

export function shouldPersistLeaderThreadTab(threadKey: string): boolean {
  const normalized = normalizeLeaderThreadKey(threadKey);
  return normalized !== MAIN_THREAD_KEY && normalized !== ALL_THREADS_KEY;
}

export function normalizeLeaderOpenThreadKeys(threadKeys: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of threadKeys) {
    const record = value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
    const rawKey =
      typeof value === "string"
        ? value
        : typeof record?.threadKey === "string"
          ? record.threadKey
          : typeof record?.questId === "string"
            ? record.questId
            : undefined;
    if (!rawKey) continue;
    const key = normalizeLeaderThreadKey(rawKey);
    if (!shouldPersistLeaderThreadTab(key) || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
    if (result.length === MAX_LEADER_OPEN_THREAD_TABS) break;
  }
  return result;
}

export function normalizeLeaderOpenThreadTabsState(candidate: unknown): LeaderOpenThreadTabsState | undefined {
  if (!candidate || typeof candidate !== "object") return undefined;
  const record = candidate as Record<string, unknown>;
  if (record.version !== LEADER_OPEN_THREAD_TABS_VERSION) return undefined;
  const state: LeaderOpenThreadTabsState = {
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: normalizeLeaderOpenThreadKeys(
      Array.isArray(record.orderedOpenThreadKeys) ? record.orderedOpenThreadKeys : [],
    ),
    closedThreadTombstones: normalizeClosedThreadTombstones(record.closedThreadTombstones),
    updatedAt: validTimestamp(record.updatedAt) ?? 0,
  };
  for (const field of OPTIONAL_TIMESTAMP_FIELDS) {
    const value = validTimestamp(record[field]);
    if (value !== undefined) state[field] = value;
  }
  const promotions = normalizeServerCandidatePromotedAt(record.serverCandidatePromotedAt);
  if (Object.keys(promotions).length) state.serverCandidatePromotedAt = promotions;
  return state;
}

export function createLeaderOpenThreadTabsState(now = Date.now()): LeaderOpenThreadTabsState {
  return {
    version: LEADER_OPEN_THREAD_TABS_VERSION,
    orderedOpenThreadKeys: [],
    closedThreadTombstones: [],
    updatedAt: now,
  };
}

function placementParts(existingThreadKeys: ReadonlyArray<string>, threadKey: string) {
  const key = normalizeLeaderThreadKey(threadKey);
  const keys = normalizeLeaderOpenThreadKeys(existingThreadKeys);
  return { key, keys, index: keys.indexOf(key), withoutTarget: keys.filter((candidate) => candidate !== key) };
}

export function placeLeaderOpenThreadTabKey(
  existingThreadKeys: ReadonlyArray<string>,
  threadKey: string,
  placement: "first" | "last" = "first",
): string[] {
  const { key, keys, index, withoutTarget } = placementParts(existingThreadKeys, threadKey);
  if (
    !shouldPersistLeaderThreadTab(key) ||
    (placement === "last" && index < 0 && keys.length >= MAX_LEADER_OPEN_THREAD_TABS)
  ) {
    return keys;
  }
  return normalizeLeaderOpenThreadKeys(placement === "first" ? [key, ...withoutTarget] : [...withoutTarget, key]);
}

export function placeLeaderOpenThreadTabBeforeKeys(
  existingThreadKeys: ReadonlyArray<string>,
  threadKey: string,
  beforeThreadKeys: ReadonlySet<string>,
): string[] {
  const { key, keys, index: originalIndex, withoutTarget } = placementParts(existingThreadKeys, threadKey);
  if (!shouldPersistLeaderThreadTab(key)) return keys;
  const boundaryIndex = withoutTarget.findIndex((candidate) => beforeThreadKeys.has(candidate));
  const fallbackIndex = originalIndex < 0 ? withoutTarget.length : originalIndex;
  const insertionIndex = boundaryIndex < 0 ? fallbackIndex : Math.min(fallbackIndex, boundaryIndex);
  return normalizeLeaderOpenThreadKeys([
    ...withoutTarget.slice(0, insertionIndex),
    key,
    ...withoutTarget.slice(insertionIndex),
  ]);
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
  options: Pick<ServerCandidateOptions, "allowTombstoneReopen"> = {},
): boolean {
  const key = normalizeLeaderThreadKey(threadKey);
  if (!shouldPersistLeaderThreadTab(key)) return false;
  const tombstone = state?.closedThreadTombstones.find((entry) => entry.threadKey === key);
  const candidateAt = validTimestamp(eventAt);
  return (
    !tombstone ||
    (options.allowTombstoneReopen !== false && candidateAt !== undefined && candidateAt > tombstone.closedAt)
  );
}

export function applyLeaderServerCandidateThreadTabEvent(
  state: LeaderOpenThreadTabsState | undefined,
  threadKey: string,
  eventAt: number,
  options: ServerCandidateOptions = {},
): LeaderOpenThreadTabsState | undefined {
  const key = normalizeLeaderThreadKey(threadKey);
  const alreadyOpen = state?.orderedOpenThreadKeys.includes(key) === true;
  if (!shouldPersistLeaderThreadTab(key) || eventAt <= (state?.serverCandidatePromotedAt?.[key] ?? -1)) return state;
  if (alreadyOpen) {
    const latestEventAt = state?.latestServerCandidateEventAt ?? state?.updatedAt ?? -1;
    if (!options.repositionExisting || eventAt < latestEventAt || eventAt <= (state?.explicitOrderUpdatedAt ?? -1)) {
      return state;
    }
  }
  if (!canServerCandidateOpenThread(state, key, eventAt, options)) return state;

  const base = state ?? createLeaderOpenThreadTabsState(eventAt);
  const placement =
    !alreadyOpen && base.explicitOrderUpdatedAt !== undefined && eventAt <= base.explicitOrderUpdatedAt
      ? "last"
      : (options.placement ?? "first");
  const orderedOpenThreadKeys =
    placement === "before"
      ? placeLeaderOpenThreadTabBeforeKeys(base.orderedOpenThreadKeys, key, options.beforeThreadKeys ?? new Set())
      : placeLeaderOpenThreadTabKey(base.orderedOpenThreadKeys, key, placement);
  const closedThreadTombstones = base.closedThreadTombstones.filter((entry) => entry.threadKey !== key);
  const visualChanged =
    !arraysEqual(base.orderedOpenThreadKeys, orderedOpenThreadKeys) ||
    closedThreadTombstones.length !== base.closedThreadTombstones.length;
  return {
    ...base,
    orderedOpenThreadKeys,
    closedThreadTombstones,
    updatedAt: visualChanged ? Math.max(base.updatedAt, eventAt) : base.updatedAt,
    latestServerCandidateEventAt: Math.max(base.latestServerCandidateEventAt ?? 0, eventAt),
    serverCandidatePromotedAt: normalizeServerCandidatePromotedAt({
      ...base.serverCandidatePromotedAt,
      [key]: eventAt,
    }),
  };
}

export function applyLeaderThreadTabUpdate(
  existingState: LeaderOpenThreadTabsState | undefined,
  update: LeaderThreadTabUpdate | { type?: unknown },
  now = Date.now(),
): LeaderOpenThreadTabsState | undefined {
  if (!update || typeof update !== "object") return existingState;
  const record = update as Record<string, unknown>;
  if (record.type === "migrate") {
    if (!Array.isArray(record.orderedOpenThreadKeys)) return existingState;
    const migratedAt = validTimestamp(record.migratedAt) ?? now;
    return {
      ...createLeaderOpenThreadTabsState(migratedAt),
      orderedOpenThreadKeys: normalizeLeaderOpenThreadKeys(record.orderedOpenThreadKeys),
      migratedFromLocalStorageAt: migratedAt,
    };
  }
  if (record.type === "reorder") {
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
    return { ...existingState, orderedOpenThreadKeys, updatedAt: now, explicitOrderUpdatedAt: now };
  }
  if ((record.type !== "open" && record.type !== "close") || typeof record.threadKey !== "string") {
    return existingState;
  }

  const state = existingState ?? createLeaderOpenThreadTabsState(now);
  const threadKey = normalizeLeaderThreadKey(record.threadKey);
  if (!shouldPersistLeaderThreadTab(threadKey)) return state;
  if (record.type === "open") {
    const orderedOpenThreadKeys = placeLeaderOpenThreadTabKey(
      state.orderedOpenThreadKeys,
      threadKey,
      record.placement === "last" ? "last" : "first",
    );
    const closedThreadTombstones = state.closedThreadTombstones.filter((entry) => entry.threadKey !== threadKey);
    if (
      arraysEqual(state.orderedOpenThreadKeys, orderedOpenThreadKeys) &&
      closedThreadTombstones.length === state.closedThreadTombstones.length
    ) {
      return state;
    }
    return { ...state, orderedOpenThreadKeys, closedThreadTombstones, updatedAt: now, explicitOrderUpdatedAt: now };
  }

  const closedAt = validTimestamp(record.closedAt) ?? now;
  const orderedOpenThreadKeys = state.orderedOpenThreadKeys.filter((key) => key !== threadKey);
  const closedThreadTombstones = normalizeClosedThreadTombstones([
    { threadKey, closedAt },
    ...state.closedThreadTombstones.filter((entry) => entry.threadKey !== threadKey),
  ]);
  if (
    arraysEqual(state.orderedOpenThreadKeys, orderedOpenThreadKeys) &&
    state.closedThreadTombstones.find((entry) => entry.threadKey === threadKey)?.closedAt === closedAt &&
    state.updatedAt === closedAt &&
    state.explicitOrderUpdatedAt === closedAt
  ) {
    return state;
  }
  return {
    ...state,
    orderedOpenThreadKeys,
    closedThreadTombstones,
    updatedAt: closedAt,
    explicitOrderUpdatedAt: closedAt,
  };
}

function normalizeServerCandidatePromotedAt(candidate: unknown): Record<string, number> {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return {};
  const entries = Object.entries(candidate).flatMap(([rawKey, rawTimestamp]) => {
    const key = normalizeLeaderThreadKey(rawKey);
    const timestamp = validTimestamp(rawTimestamp);
    return shouldPersistLeaderThreadTab(key) && timestamp !== undefined ? [[key, timestamp] as const] : [];
  });
  entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
  return Object.fromEntries(entries.slice(0, MAX_LEADER_SERVER_CANDIDATE_PROMOTIONS));
}

function normalizeClosedThreadTombstones(candidate: unknown): LeaderClosedThreadTombstone[] {
  if (!Array.isArray(candidate)) return [];
  const seen = new Set<string>();
  const result: LeaderClosedThreadTombstone[] = [];
  for (const value of candidate) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const threadKey = typeof record.threadKey === "string" ? normalizeLeaderThreadKey(record.threadKey) : "";
    const closedAt = validTimestamp(record.closedAt);
    if (!shouldPersistLeaderThreadTab(threadKey) || closedAt === undefined || seen.has(threadKey)) continue;
    seen.add(threadKey);
    result.push({ threadKey, closedAt });
  }
  return result.sort((left, right) => right.closedAt - left.closedAt).slice(0, MAX_LEADER_CLOSED_THREAD_TOMBSTONES);
}

function validTimestamp(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function arraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
