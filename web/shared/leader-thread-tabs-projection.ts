import type { LeaderActivePhaseSummarySegment } from "./leader-active-phase-summary.js";
import { LEADER_OPEN_THREAD_TABS_VERSION } from "./leader-open-thread-tabs.js";
import type { QuestJourneyLifecycleMode } from "./quest-journey.js";
import { THREAD_STATUS_MESSAGE_ID_HASH_LENGTH, type LeaderThreadStatus } from "./thread-status-marker.js";

export const LEADER_THREAD_TABS_PROJECTION = "leader-thread-tabs" as const;
export const LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES = 64 * 1024;
export const LEADER_THREAD_TABS_PROJECTION_MAX_TABS = 50;
export const LEADER_THREAD_TABS_PROJECTION_MAX_TOMBSTONES = 50;
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUSES = LEADER_THREAD_TABS_PROJECTION_MAX_TABS + 1;
export const LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS = 16;
export const LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH = 80;
export const LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH = 160;
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH = 80;
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH = 200;
export const LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH = 200;

export interface LeaderThreadTabsProjectionTabState {
  version: typeof LEADER_OPEN_THREAD_TABS_VERSION;
  orderedOpenThreadKeys: string[];
  closedThreadTombstones: Array<{ threadKey: string; closedAt: number }>;
  updatedAt: number;
  migratedFromLocalStorageAt?: number;
  explicitOrderUpdatedAt?: number;
}

export interface LeaderThreadTabsProjectionAttention {
  needsInput: boolean;
  mutedNeedsInput: boolean;
  reviewUnread: boolean;
  updatedAt: number;
}

export interface LeaderThreadTabsProjectionJourney {
  mode: QuestJourneyLifecycleMode | null;
  currentPhaseId: string | null;
  activePhaseIndex: number | null;
  phaseCount: number;
}

export interface LeaderThreadTabsProjectionTab {
  threadKey: string;
  questId: string | null;
  /** Best bounded server-local title input. Canonical Quest title hydration remains a separate authority. */
  title: string | null;
  boardStatus: string | null;
  journey: LeaderThreadTabsProjectionJourney | null;
  active: boolean;
  queued: boolean;
  proposed: boolean;
  completed: boolean;
  canClose: boolean;
  attention: LeaderThreadTabsProjectionAttention;
  updatedAt: number;
}

export interface LeaderThreadTabsProjectionValue {
  /** Null means no durable tab state exists yet; derived visual candidates may still populate tabs. */
  tabState: LeaderThreadTabsProjectionTabState | null;
  tabs: LeaderThreadTabsProjectionTab[];
  mainAttention: LeaderThreadTabsProjectionAttention;
  threadStatuses: Record<string, LeaderThreadStatus>;
  activePhaseSummary: LeaderActivePhaseSummarySegment[];
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function boundedNullableString(value: unknown, maxLength: number): value is string | null {
  return value === null || boundedString(value, maxLength);
}

function nonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function normalizedThreadKey(value: unknown): value is string {
  return (
    boundedString(value, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    value.length > 0 &&
    value === value.trim().toLowerCase() &&
    value !== "main" &&
    value !== "all"
  );
}

function isAttention(value: unknown): value is LeaderThreadTabsProjectionAttention {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionAttention>;
  return (
    typeof candidate.needsInput === "boolean" &&
    typeof candidate.mutedNeedsInput === "boolean" &&
    typeof candidate.reviewUnread === "boolean" &&
    nonNegativeNumber(candidate.updatedAt)
  );
}

function isJourney(value: unknown): value is LeaderThreadTabsProjectionJourney {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionJourney>;
  return (
    (candidate.mode === null || candidate.mode === "active" || candidate.mode === "proposed") &&
    boundedNullableString(candidate.currentPhaseId, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.activePhaseIndex === null || nonNegativeInteger(candidate.activePhaseIndex)) &&
    nonNegativeInteger(candidate.phaseCount) &&
    candidate.phaseCount <= 100 &&
    (candidate.activePhaseIndex === null || candidate.activePhaseIndex < candidate.phaseCount)
  );
}

function isTabState(value: unknown): value is LeaderThreadTabsProjectionTabState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionTabState>;
  if (candidate.version !== LEADER_OPEN_THREAD_TABS_VERSION) return false;
  if (!Array.isArray(candidate.orderedOpenThreadKeys)) return false;
  if (candidate.orderedOpenThreadKeys.length > LEADER_THREAD_TABS_PROJECTION_MAX_TABS) return false;
  if (!Array.isArray(candidate.closedThreadTombstones)) return false;
  if (candidate.closedThreadTombstones.length > LEADER_THREAD_TABS_PROJECTION_MAX_TOMBSTONES) return false;
  if (!nonNegativeNumber(candidate.updatedAt)) return false;
  if (candidate.migratedFromLocalStorageAt !== undefined && !nonNegativeNumber(candidate.migratedFromLocalStorageAt)) {
    return false;
  }
  if (candidate.explicitOrderUpdatedAt !== undefined && !nonNegativeNumber(candidate.explicitOrderUpdatedAt)) {
    return false;
  }

  const openKeys = new Set<string>();
  for (const key of candidate.orderedOpenThreadKeys) {
    if (!normalizedThreadKey(key) || openKeys.has(key)) return false;
    openKeys.add(key);
  }
  const tombstoneKeys = new Set<string>();
  for (const tombstone of candidate.closedThreadTombstones) {
    if (!tombstone || typeof tombstone !== "object") return false;
    if (!normalizedThreadKey(tombstone.threadKey) || tombstoneKeys.has(tombstone.threadKey)) return false;
    if (!nonNegativeNumber(tombstone.closedAt)) return false;
    tombstoneKeys.add(tombstone.threadKey);
  }
  return true;
}

function isTab(value: unknown): value is LeaderThreadTabsProjectionTab {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionTab>;
  return (
    normalizedThreadKey(candidate.threadKey) &&
    boundedNullableString(candidate.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    boundedNullableString(candidate.title, LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH) &&
    boundedNullableString(candidate.boardStatus, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.journey === null || isJourney(candidate.journey)) &&
    typeof candidate.active === "boolean" &&
    typeof candidate.queued === "boolean" &&
    typeof candidate.proposed === "boolean" &&
    typeof candidate.completed === "boolean" &&
    Number(candidate.active) + Number(candidate.queued) + Number(candidate.proposed) + Number(candidate.completed) <=
      1 &&
    typeof candidate.canClose === "boolean" &&
    isAttention(candidate.attention) &&
    nonNegativeNumber(candidate.updatedAt)
  );
}

function isThreadStatus(value: unknown, key: string): value is LeaderThreadStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadStatus>;
  return (
    (candidate.kind === "waiting" || candidate.kind === "ready") &&
    candidate.label === (candidate.kind === "waiting" ? "Thread Waiting" : "Thread Ready") &&
    candidate.threadKey === key &&
    boundedString(candidate.threadKey, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    (candidate.questId === undefined ||
      boundedString(candidate.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH)) &&
    boundedString(candidate.summary, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH) &&
    boundedString(candidate.messageId, LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH) &&
    (candidate.messageIdHash === undefined ||
      (boundedString(candidate.messageIdHash, THREAD_STATUS_MESSAGE_ID_HASH_LENGTH) &&
        candidate.messageIdHash.length === THREAD_STATUS_MESSAGE_ID_HASH_LENGTH &&
        /^[0-9a-f]+$/.test(candidate.messageIdHash))) &&
    nonNegativeNumber(candidate.timestamp) &&
    nonNegativeNumber(candidate.updatedAt)
  );
}

function isActivePhaseSummary(value: unknown): value is LeaderActivePhaseSummarySegment[] {
  if (!Array.isArray(value) || value.length > LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS) return false;
  return value.every((segment) => {
    if (!segment || typeof segment !== "object") return false;
    const candidate = segment as Partial<LeaderActivePhaseSummarySegment>;
    return (
      boundedString(candidate.label, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
      nonNegativeInteger(candidate.count) &&
      candidate.count > 0 &&
      (candidate.tone === "phase" || candidate.tone === "status" || candidate.tone === "unknown") &&
      (candidate.color === undefined ||
        boundedString(candidate.color, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH)) &&
      (candidate.colorName === undefined ||
        boundedString(candidate.colorName, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH))
    );
  });
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
  }
  return bytes;
}

export function isLeaderThreadTabsProjectionValue(value: unknown): value is LeaderThreadTabsProjectionValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionValue>;
  if (candidate.tabState !== null && !isTabState(candidate.tabState)) return false;
  if (!Array.isArray(candidate.tabs) || candidate.tabs.length > LEADER_THREAD_TABS_PROJECTION_MAX_TABS) return false;
  if (!candidate.tabs.every(isTab)) return false;
  if (!isAttention(candidate.mainAttention)) return false;
  if (!candidate.threadStatuses || typeof candidate.threadStatuses !== "object") return false;
  const statusEntries = Object.entries(candidate.threadStatuses);
  if (statusEntries.length > LEADER_THREAD_TABS_PROJECTION_MAX_STATUSES) return false;
  if (
    statusEntries.some(
      ([key, status]) =>
        !boundedString(key, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) ||
        key !== key.trim().toLowerCase() ||
        (key !== "main" && !/^q-\d+$/.test(key)) ||
        !isThreadStatus(status, key),
    )
  ) {
    return false;
  }
  if (!isActivePhaseSummary(candidate.activePhaseSummary)) return false;

  const tabKeys = candidate.tabs.map((tab) => tab.threadKey);
  if (new Set(tabKeys).size !== tabKeys.length) return false;
  if (candidate.tabState) {
    const ordered = candidate.tabState.orderedOpenThreadKeys;
    if (candidate.tabs.length !== ordered.length) return false;
    if (candidate.tabs.some((tab, index) => tab.threadKey !== ordered[index])) return false;
  }
  const serialized = JSON.stringify(candidate);
  return utf8ByteLength(serialized) <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES;
}

export function leaderThreadTabsProjectionAttentionEqual(
  left: LeaderThreadTabsProjectionAttention,
  right: LeaderThreadTabsProjectionAttention,
): boolean {
  return (
    left.needsInput === right.needsInput &&
    left.mutedNeedsInput === right.mutedNeedsInput &&
    left.reviewUnread === right.reviewUnread &&
    left.updatedAt === right.updatedAt
  );
}

export function leaderThreadTabsProjectionTabEqual(
  left: LeaderThreadTabsProjectionTab,
  right: LeaderThreadTabsProjectionTab,
): boolean {
  return (
    left.threadKey === right.threadKey &&
    left.questId === right.questId &&
    left.title === right.title &&
    left.boardStatus === right.boardStatus &&
    journeyEqual(left.journey, right.journey) &&
    left.active === right.active &&
    left.queued === right.queued &&
    left.proposed === right.proposed &&
    left.completed === right.completed &&
    left.canClose === right.canClose &&
    leaderThreadTabsProjectionAttentionEqual(left.attention, right.attention) &&
    left.updatedAt === right.updatedAt
  );
}

export function leaderThreadTabsProjectionEqual(
  left: LeaderThreadTabsProjectionValue,
  right: LeaderThreadTabsProjectionValue,
): boolean {
  return (
    tabStateEqual(left.tabState, right.tabState) &&
    arraysEqual(left.tabs, right.tabs, leaderThreadTabsProjectionTabEqual) &&
    leaderThreadTabsProjectionAttentionEqual(left.mainAttention, right.mainAttention) &&
    statusMapsEqual(left.threadStatuses, right.threadStatuses) &&
    arraysEqual(left.activePhaseSummary, right.activePhaseSummary, activePhaseSegmentEqual)
  );
}

/** Preserve stable slices and per-tab/status identities when only part of the projection changes. */
export function reconcileLeaderThreadTabsProjectionValue(
  previous: LeaderThreadTabsProjectionValue | undefined,
  next: LeaderThreadTabsProjectionValue,
): LeaderThreadTabsProjectionValue {
  if (!previous) return next;
  const tabState = tabStateEqual(previous.tabState, next.tabState) ? previous.tabState : next.tabState;
  const tabs = reconcileKeyedArray(
    previous.tabs,
    next.tabs,
    (tab) => tab.threadKey,
    leaderThreadTabsProjectionTabEqual,
  );
  const mainAttention = leaderThreadTabsProjectionAttentionEqual(previous.mainAttention, next.mainAttention)
    ? previous.mainAttention
    : next.mainAttention;
  const threadStatuses = reconcileStatusMap(previous.threadStatuses, next.threadStatuses);
  const activePhaseSummary = reconcileArray(
    previous.activePhaseSummary,
    next.activePhaseSummary,
    activePhaseSegmentEqual,
  );
  if (
    tabState === previous.tabState &&
    tabs === previous.tabs &&
    mainAttention === previous.mainAttention &&
    threadStatuses === previous.threadStatuses &&
    activePhaseSummary === previous.activePhaseSummary
  ) {
    return previous;
  }
  return { tabState, tabs, mainAttention, threadStatuses, activePhaseSummary };
}

function journeyEqual(
  left: LeaderThreadTabsProjectionJourney | null,
  right: LeaderThreadTabsProjectionJourney | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.mode === right.mode &&
    left.currentPhaseId === right.currentPhaseId &&
    left.activePhaseIndex === right.activePhaseIndex &&
    left.phaseCount === right.phaseCount
  );
}

function tabStateEqual(
  left: LeaderThreadTabsProjectionTabState | null,
  right: LeaderThreadTabsProjectionTabState | null,
): boolean {
  if (!left || !right) return left === right;
  return (
    left.version === right.version &&
    left.updatedAt === right.updatedAt &&
    left.migratedFromLocalStorageAt === right.migratedFromLocalStorageAt &&
    left.explicitOrderUpdatedAt === right.explicitOrderUpdatedAt &&
    arraysEqual(left.orderedOpenThreadKeys, right.orderedOpenThreadKeys, (a, b) => a === b) &&
    arraysEqual(
      left.closedThreadTombstones,
      right.closedThreadTombstones,
      (a, b) => a.threadKey === b.threadKey && a.closedAt === b.closedAt,
    )
  );
}

function statusEqual(left: LeaderThreadStatus, right: LeaderThreadStatus): boolean {
  return (
    left.kind === right.kind &&
    left.label === right.label &&
    left.threadKey === right.threadKey &&
    left.questId === right.questId &&
    left.summary === right.summary &&
    left.messageId === right.messageId &&
    left.messageIdHash === right.messageIdHash &&
    left.timestamp === right.timestamp &&
    left.updatedAt === right.updatedAt
  );
}

function statusMapsEqual(
  left: Readonly<Record<string, LeaderThreadStatus>>,
  right: Readonly<Record<string, LeaderThreadStatus>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    arraysEqual(leftKeys, rightKeys, (a, b) => a === b) &&
    leftKeys.every((key) => !!right[key] && statusEqual(left[key]!, right[key]!))
  );
}

function activePhaseSegmentEqual(
  left: LeaderActivePhaseSummarySegment,
  right: LeaderActivePhaseSummarySegment,
): boolean {
  return (
    left.label === right.label &&
    left.count === right.count &&
    left.tone === right.tone &&
    left.color === right.color &&
    left.colorName === right.colorName
  );
}

function arraysEqual<T>(left: ReadonlyArray<T>, right: ReadonlyArray<T>, equal: (a: T, b: T) => boolean): boolean {
  return left.length === right.length && left.every((value, index) => equal(value, right[index]!));
}

function reconcileArray<T>(previous: T[], next: T[], equal: (a: T, b: T) => boolean): T[] {
  if (arraysEqual(previous, next, equal)) return previous;
  return next.map((value, index) => (previous[index] && equal(previous[index]!, value) ? previous[index]! : value));
}

function reconcileKeyedArray<T>(
  previous: T[],
  next: T[],
  keyFor: (value: T) => string,
  equal: (a: T, b: T) => boolean,
): T[] {
  const previousByKey = new Map(previous.map((value) => [keyFor(value), value]));
  const reconciled = next.map((value) => {
    const prior = previousByKey.get(keyFor(value));
    return prior && equal(prior, value) ? prior : value;
  });
  return arraysEqual(previous, reconciled, (a, b) => a === b) ? previous : reconciled;
}

function reconcileStatusMap(
  previous: Record<string, LeaderThreadStatus>,
  next: Record<string, LeaderThreadStatus>,
): Record<string, LeaderThreadStatus> {
  const previousKeys = Object.keys(previous);
  const nextKeys = Object.keys(next);
  let allSame = arraysEqual(previousKeys, nextKeys, (a, b) => a === b);
  const reconciled: Record<string, LeaderThreadStatus> = {};
  for (const key of nextKeys) {
    const prior = previous[key];
    const value = next[key]!;
    reconciled[key] = prior && statusEqual(prior, value) ? prior : value;
    if (reconciled[key] !== prior) allSame = false;
  }
  return allSame ? previous : reconciled;
}
