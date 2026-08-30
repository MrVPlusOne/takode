import type { LeaderActivePhaseSummarySegment } from "./leader-active-phase-summary.js";
import { LEADER_OPEN_THREAD_TABS_VERSION } from "./leader-open-thread-tabs.js";
import type { QuestJourneyLifecycleMode, QuestJourneyPhaseId } from "./quest-journey.js";
import { THREAD_STATUS_MESSAGE_ID_HASH_LENGTH, type LeaderThreadStatus } from "./thread-status-marker.js";
import {
  isBoundedNullableString,
  isBoundedString,
  isNonNegativeInteger,
  isNonNegativeNumber,
  jsonUtf8ByteLength,
} from "./synced-projection-codec.js";
import {
  arraysEqual,
  reconcileArray,
  reconcileKeyedArray,
  reconcileRecord,
  reuseIfEqual,
} from "./stable-reconciliation.js";

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
  /** Current bounded phase sequence. Omitted by legacy projection producers. */
  phaseIds?: readonly QuestJourneyPhaseId[];
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
  /** Leader session that owns the current visual board row, not necessarily this projected thread. */
  sourceLeaderSessionId?: string | null;
  /** Creation identity of the current visual board row, used to fence historical Journey detail. */
  sourceRowCreatedAt?: number | null;
  /** Worker assigned by the current visual board row. */
  workerSessionId?: string | null;
  workerSessionNum?: number | null;
  active: boolean;
  queued: boolean;
  proposed: boolean;
  /** True only when the current queued/proposed run has never entered active execution. Omitted by legacy producers. */
  neverStartedScheduled?: boolean;
  completed: boolean;
  canClose: boolean;
  attention: LeaderThreadTabsProjectionAttention;
  updatedAt: number;
}

export interface LeaderThreadTabsProjectionValue {
  /** Present when tab completion, Journey, and participant fields come from current cross-session authority. */
  currentQuestStateVersion?: 1;
  /** Null means no durable tab state exists yet; derived visual candidates may still populate tabs. */
  tabState: LeaderThreadTabsProjectionTabState | null;
  tabs: LeaderThreadTabsProjectionTab[];
  mainAttention: LeaderThreadTabsProjectionAttention;
  threadStatuses: Record<string, LeaderThreadStatus>;
  activePhaseSummary: LeaderActivePhaseSummarySegment[];
}

function normalizedThreadKey(value: unknown): value is string {
  return (
    isBoundedString(value, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
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
    isNonNegativeNumber(candidate.updatedAt)
  );
}

function isJourney(
  value: unknown,
  requireCurrentQuestStateFields: boolean,
): value is LeaderThreadTabsProjectionJourney {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionJourney>;
  const phaseIds = candidate.phaseIds;
  const validPhaseIds =
    Array.isArray(phaseIds) &&
    phaseIds.length <= 100 &&
    phaseIds.every((phaseId) => isBoundedString(phaseId, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH));
  if (requireCurrentQuestStateFields ? !validPhaseIds : phaseIds !== undefined && !validPhaseIds) return false;
  return (
    (candidate.mode === null || candidate.mode === "active" || candidate.mode === "proposed") &&
    isBoundedNullableString(candidate.currentPhaseId, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.activePhaseIndex === null || isNonNegativeInteger(candidate.activePhaseIndex)) &&
    isNonNegativeInteger(candidate.phaseCount) &&
    candidate.phaseCount <= 100 &&
    (phaseIds === undefined || phaseIds.length === candidate.phaseCount) &&
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
  if (!isNonNegativeNumber(candidate.updatedAt)) return false;
  if (
    candidate.migratedFromLocalStorageAt !== undefined &&
    !isNonNegativeNumber(candidate.migratedFromLocalStorageAt)
  ) {
    return false;
  }
  if (candidate.explicitOrderUpdatedAt !== undefined && !isNonNegativeNumber(candidate.explicitOrderUpdatedAt)) {
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
    if (!isNonNegativeNumber(tombstone.closedAt)) return false;
    tombstoneKeys.add(tombstone.threadKey);
  }
  return true;
}

function isTab(value: unknown, requireCurrentQuestStateFields: boolean): value is LeaderThreadTabsProjectionTab {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionTab>;
  const hasOwn = (key: keyof LeaderThreadTabsProjectionTab): boolean => Object.hasOwn(candidate, key);
  return (
    normalizedThreadKey(candidate.threadKey) &&
    isBoundedNullableString(candidate.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    isBoundedNullableString(candidate.title, LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH) &&
    isBoundedNullableString(candidate.boardStatus, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.journey === null || isJourney(candidate.journey, requireCurrentQuestStateFields)) &&
    (!requireCurrentQuestStateFields || hasOwn("sourceLeaderSessionId")) &&
    (candidate.sourceLeaderSessionId === undefined
      ? !requireCurrentQuestStateFields
      : isBoundedNullableString(
          candidate.sourceLeaderSessionId,
          LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH,
        )) &&
    (!requireCurrentQuestStateFields || hasOwn("sourceRowCreatedAt")) &&
    (candidate.sourceRowCreatedAt === undefined
      ? !requireCurrentQuestStateFields
      : candidate.sourceRowCreatedAt === null || isNonNegativeNumber(candidate.sourceRowCreatedAt)) &&
    (!requireCurrentQuestStateFields || hasOwn("workerSessionId")) &&
    (candidate.workerSessionId === undefined
      ? !requireCurrentQuestStateFields
      : isBoundedNullableString(candidate.workerSessionId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH)) &&
    (!requireCurrentQuestStateFields || hasOwn("workerSessionNum")) &&
    (candidate.workerSessionNum === undefined
      ? !requireCurrentQuestStateFields
      : candidate.workerSessionNum === null || isNonNegativeInteger(candidate.workerSessionNum)) &&
    typeof candidate.active === "boolean" &&
    typeof candidate.queued === "boolean" &&
    typeof candidate.proposed === "boolean" &&
    (candidate.neverStartedScheduled === undefined || typeof candidate.neverStartedScheduled === "boolean") &&
    typeof candidate.completed === "boolean" &&
    Number(candidate.active) + Number(candidate.queued) + Number(candidate.proposed) + Number(candidate.completed) <=
      1 &&
    typeof candidate.canClose === "boolean" &&
    isAttention(candidate.attention) &&
    isNonNegativeNumber(candidate.updatedAt)
  );
}

function isThreadStatus(value: unknown, key: string): value is LeaderThreadStatus {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadStatus>;
  return (
    (candidate.kind === "waiting" || candidate.kind === "ready") &&
    candidate.label === (candidate.kind === "waiting" ? "Thread Waiting" : "Thread Ready") &&
    candidate.threadKey === key &&
    isBoundedString(candidate.threadKey, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    (candidate.questId === undefined ||
      isBoundedString(candidate.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH)) &&
    isBoundedString(candidate.summary, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH) &&
    isBoundedString(candidate.messageId, LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH) &&
    (candidate.messageIdHash === undefined ||
      (isBoundedString(candidate.messageIdHash, THREAD_STATUS_MESSAGE_ID_HASH_LENGTH) &&
        candidate.messageIdHash.length === THREAD_STATUS_MESSAGE_ID_HASH_LENGTH &&
        /^[0-9a-f]+$/.test(candidate.messageIdHash))) &&
    isNonNegativeNumber(candidate.timestamp) &&
    isNonNegativeNumber(candidate.updatedAt)
  );
}

function isActivePhaseSummary(value: unknown): value is LeaderActivePhaseSummarySegment[] {
  if (!Array.isArray(value) || value.length > LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS) return false;
  return value.every((segment) => {
    if (!segment || typeof segment !== "object") return false;
    const candidate = segment as Partial<LeaderActivePhaseSummarySegment>;
    return (
      isBoundedString(candidate.label, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
      isNonNegativeInteger(candidate.count) &&
      candidate.count > 0 &&
      (candidate.tone === "phase" || candidate.tone === "status" || candidate.tone === "unknown") &&
      (candidate.color === undefined ||
        isBoundedString(candidate.color, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH)) &&
      (candidate.colorName === undefined ||
        isBoundedString(candidate.colorName, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH))
    );
  });
}

export function isLeaderThreadTabsProjectionValue(value: unknown): value is LeaderThreadTabsProjectionValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionValue>;
  if (candidate.currentQuestStateVersion !== undefined && candidate.currentQuestStateVersion !== 1) return false;
  if (candidate.tabState !== null && !isTabState(candidate.tabState)) return false;
  if (!Array.isArray(candidate.tabs) || candidate.tabs.length > LEADER_THREAD_TABS_PROJECTION_MAX_TABS) return false;
  const requireCurrentQuestStateFields = candidate.currentQuestStateVersion === 1;
  if (!candidate.tabs.every((tab) => isTab(tab, requireCurrentQuestStateFields))) return false;
  if (!isAttention(candidate.mainAttention)) return false;
  if (!candidate.threadStatuses || typeof candidate.threadStatuses !== "object") return false;
  const statusEntries = Object.entries(candidate.threadStatuses);
  if (statusEntries.length > LEADER_THREAD_TABS_PROJECTION_MAX_STATUSES) return false;
  if (
    statusEntries.some(
      ([key, status]) =>
        !isBoundedString(key, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) ||
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
  const serializedBytes = jsonUtf8ByteLength(candidate);
  return serializedBytes !== null && serializedBytes <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES;
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
    left.sourceLeaderSessionId === right.sourceLeaderSessionId &&
    left.sourceRowCreatedAt === right.sourceRowCreatedAt &&
    left.workerSessionId === right.workerSessionId &&
    left.workerSessionNum === right.workerSessionNum &&
    left.active === right.active &&
    left.queued === right.queued &&
    left.proposed === right.proposed &&
    left.neverStartedScheduled === right.neverStartedScheduled &&
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
    left.currentQuestStateVersion === right.currentQuestStateVersion &&
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
  const tabState = reuseIfEqual(previous.tabState, next.tabState, tabStateEqual);
  const tabs = reconcileKeyedArray(
    previous.tabs,
    next.tabs,
    (tab) => tab.threadKey,
    leaderThreadTabsProjectionTabEqual,
  );
  const mainAttention = reuseIfEqual(
    previous.mainAttention,
    next.mainAttention,
    leaderThreadTabsProjectionAttentionEqual,
  );
  const threadStatuses = reconcileRecord(previous.threadStatuses, next.threadStatuses, statusEqual);
  const activePhaseSummary = reconcileArray(
    previous.activePhaseSummary,
    next.activePhaseSummary,
    activePhaseSegmentEqual,
  );
  if (
    previous.currentQuestStateVersion === next.currentQuestStateVersion &&
    tabState === previous.tabState &&
    tabs === previous.tabs &&
    mainAttention === previous.mainAttention &&
    threadStatuses === previous.threadStatuses &&
    activePhaseSummary === previous.activePhaseSummary
  ) {
    return previous;
  }
  return {
    ...(next.currentQuestStateVersion ? { currentQuestStateVersion: next.currentQuestStateVersion } : {}),
    tabState,
    tabs,
    mainAttention,
    threadStatuses,
    activePhaseSummary,
  };
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
    left.phaseCount === right.phaseCount &&
    optionalArraysEqual(left.phaseIds, right.phaseIds, (a, b) => a === b)
  );
}

function optionalArraysEqual<T>(
  left: ReadonlyArray<T> | undefined,
  right: ReadonlyArray<T> | undefined,
  equal: (left: T, right: T) => boolean,
): boolean {
  if (!left || !right) return left === right;
  return arraysEqual(left, right, equal);
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
