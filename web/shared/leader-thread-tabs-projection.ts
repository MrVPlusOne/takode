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
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUSES = LEADER_THREAD_TABS_PROJECTION_MAX_TABS + 1;
export const LEADER_THREAD_TABS_PROJECTION_MAX_ACTIVE_PHASE_SEGMENTS = 16;
export const LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH = 80;
export const LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH = 160;
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH = 80;
export const LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_SUMMARY_LENGTH = 200;
export const LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH = 200;

export interface LeaderThreadTabsProjectionTabState {
  version: typeof LEADER_OPEN_THREAD_TABS_VERSION;
}

export interface LeaderThreadTabsProjectionAttention {
  needsInput: boolean;
  mutedNeedsInput: boolean;
  reviewUnread: boolean;
  updatedAt: number;
}

export interface LeaderThreadTabsProjectionJourney {
  mode: QuestJourneyLifecycleMode | null;
  phaseIds: readonly QuestJourneyPhaseId[];
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
  sourceLeaderSessionId: string | null;
  /** Creation identity of the current visual board row, used to fence historical Journey detail. */
  sourceRowCreatedAt: number | null;
  /** Worker assigned by the current visual board row. */
  workerSessionId: string | null;
  workerSessionNum: number | null;
  active: boolean;
  queued: boolean;
  proposed: boolean;
  /** True only when the current queued/proposed run has never entered active execution. */
  neverStartedScheduled: boolean;
  completed: boolean;
  canClose: boolean;
  attention: LeaderThreadTabsProjectionAttention;
  updatedAt: number;
}

export interface LeaderThreadTabsProjectionValue {
  currentQuestStateVersion: 1;
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

function isJourney(value: unknown): value is LeaderThreadTabsProjectionJourney {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionJourney>;
  const phaseIds = candidate.phaseIds;
  return (
    Array.isArray(phaseIds) &&
    phaseIds.length <= 100 &&
    phaseIds.every((phaseId) => isBoundedString(phaseId, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH)) &&
    (candidate.mode === null || candidate.mode === "active" || candidate.mode === "proposed") &&
    isBoundedNullableString(candidate.currentPhaseId, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.activePhaseIndex === null || isNonNegativeInteger(candidate.activePhaseIndex)) &&
    isNonNegativeInteger(candidate.phaseCount) &&
    candidate.phaseCount <= 100 &&
    phaseIds.length === candidate.phaseCount &&
    (candidate.activePhaseIndex === null || candidate.activePhaseIndex < candidate.phaseCount)
  );
}

function isTabState(value: unknown): value is LeaderThreadTabsProjectionTabState {
  if (!value || typeof value !== "object") return false;
  return (value as Partial<LeaderThreadTabsProjectionTabState>).version === LEADER_OPEN_THREAD_TABS_VERSION;
}

function isTab(value: unknown): value is LeaderThreadTabsProjectionTab {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadTabsProjectionTab>;
  return (
    normalizedThreadKey(candidate.threadKey) &&
    isBoundedNullableString(candidate.questId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    isBoundedNullableString(candidate.title, LEADER_THREAD_TABS_PROJECTION_MAX_TITLE_LENGTH) &&
    isBoundedNullableString(candidate.boardStatus, LEADER_THREAD_TABS_PROJECTION_MAX_STATUS_LENGTH) &&
    (candidate.journey === null || isJourney(candidate.journey)) &&
    Object.hasOwn(candidate, "sourceLeaderSessionId") &&
    isBoundedNullableString(candidate.sourceLeaderSessionId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    Object.hasOwn(candidate, "sourceRowCreatedAt") &&
    (candidate.sourceRowCreatedAt === null || isNonNegativeNumber(candidate.sourceRowCreatedAt)) &&
    Object.hasOwn(candidate, "workerSessionId") &&
    isBoundedNullableString(candidate.workerSessionId, LEADER_THREAD_TABS_PROJECTION_MAX_THREAD_KEY_LENGTH) &&
    Object.hasOwn(candidate, "workerSessionNum") &&
    (candidate.workerSessionNum === null || isNonNegativeInteger(candidate.workerSessionNum)) &&
    typeof candidate.active === "boolean" &&
    typeof candidate.queued === "boolean" &&
    typeof candidate.proposed === "boolean" &&
    typeof candidate.neverStartedScheduled === "boolean" &&
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
  if (candidate.currentQuestStateVersion !== 1) return false;
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
  const serializedBytes = jsonUtf8ByteLength(candidate);
  return serializedBytes !== null && serializedBytes <= LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES;
}

/** Compact keyed live-update fields; terse keys keep narrow deltas below the retained control. */
type LeaderThreadStatusPatch = Partial<LeaderThreadStatus> & {
  questId?: string | null;
  messageIdHash?: string | null;
};

export interface LeaderThreadTabsProjectionPatch {
  d?: LeaderThreadTabsProjectionTabState | null;
  t?: Record<string, LeaderThreadTabsProjectionTab | null>;
  o?: string[];
  a?: LeaderThreadTabsProjectionAttention;
  s?: Record<string, LeaderThreadStatusPatch | null>;
  p?: LeaderActivePhaseSummarySegment[];
}

const STATUS_FIELDS = new Set([
  "kind",
  "label",
  "threadKey",
  "questId",
  "summary",
  "messageId",
  "messageIdHash",
  "timestamp",
  "updatedAt",
]);

function statusDelta(previous: LeaderThreadStatus | undefined, next: LeaderThreadStatus): LeaderThreadStatusPatch {
  if (!previous) return next;
  const delta: LeaderThreadStatusPatch = {};
  for (const key of STATUS_FIELDS as Set<keyof LeaderThreadStatus>) {
    if (previous[key] !== next[key]) (delta as Record<string, unknown>)[key] = next[key] ?? null;
  }
  return delta;
}

export function createLeaderThreadTabsProjectionPatch(
  previous: LeaderThreadTabsProjectionValue,
  next: LeaderThreadTabsProjectionValue,
): LeaderThreadTabsProjectionPatch | undefined {
  const patch: LeaderThreadTabsProjectionPatch = {};
  if (!tabStateEqual(previous.tabState, next.tabState)) patch.d = next.tabState;
  const previousTabs = new Map(previous.tabs.map((tab) => [tab.threadKey, tab]));
  const nextTabs = new Map(next.tabs.map((tab) => [tab.threadKey, tab]));
  const tabs: Record<string, LeaderThreadTabsProjectionTab | null> = {};
  for (const tab of previous.tabs) if (!nextTabs.has(tab.threadKey)) tabs[tab.threadKey] = null;
  for (const tab of next.tabs) {
    const prior = previousTabs.get(tab.threadKey);
    if (!prior || !leaderThreadTabsProjectionTabEqual(prior, tab)) tabs[tab.threadKey] = tab;
  }
  if (Object.keys(tabs).length) patch.t = tabs;
  const order = next.tabs.map((tab) => tab.threadKey);
  if (!arraysEqual(previous.tabs, next.tabs, (left, right) => left.threadKey === right.threadKey)) patch.o = order;
  if (!leaderThreadTabsProjectionAttentionEqual(previous.mainAttention, next.mainAttention))
    patch.a = next.mainAttention;
  const statuses: Record<string, LeaderThreadStatusPatch | null> = {};
  for (const key of new Set([...Object.keys(previous.threadStatuses), ...Object.keys(next.threadStatuses)])) {
    const prior = previous.threadStatuses[key];
    const current = next.threadStatuses[key];
    if (!current) statuses[key] = null;
    else if (!prior || !shallowEqual(prior, current)) statuses[key] = statusDelta(prior, current);
  }
  if (Object.keys(statuses).length) patch.s = statuses;
  if (!arraysEqual(previous.activePhaseSummary, next.activePhaseSummary, shallowEqual)) {
    patch.p = next.activePhaseSummary;
  }
  const patchBytes = jsonUtf8ByteLength(patch);
  const valueBytes = jsonUtf8ByteLength(next);
  return Object.keys(patch).length && patchBytes !== null && valueBytes !== null && patchBytes < valueBytes
    ? patch
    : undefined;
}

export function applyLeaderThreadTabsProjectionPatch(
  previous: LeaderThreadTabsProjectionValue,
  input: unknown,
): LeaderThreadTabsProjectionValue | undefined {
  if (
    !isLeaderThreadTabsProjectionValue(previous) ||
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    (jsonUtf8ByteLength(input) ?? Infinity) > LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES
  ) {
    return undefined;
  }
  const patch = input as LeaderThreadTabsProjectionPatch;
  const keys = Object.keys(patch);
  if (!keys.length || keys.some((key) => key.length !== 1 || !"dtoasp".includes(key))) return undefined;

  const tabMap = new Map(previous.tabs.map((tab) => [tab.threadKey, tab]));
  if (patch.t !== undefined) {
    if (!patch.t || typeof patch.t !== "object" || Array.isArray(patch.t)) return undefined;
    for (const [key, tab] of Object.entries(patch.t)) tab === null ? tabMap.delete(key) : tabMap.set(key, tab);
  }
  let tabs = [...tabMap.values()];
  if (patch.o !== undefined) {
    if (!Array.isArray(patch.o) || patch.o.length !== tabs.length || patch.o.some((key) => !tabMap.has(key))) {
      return undefined;
    }
    tabs = patch.o.map((key) => tabMap.get(key)!);
  }

  const threadStatuses = { ...previous.threadStatuses };
  if (patch.s !== undefined) {
    if (!patch.s || typeof patch.s !== "object" || Array.isArray(patch.s)) return undefined;
    for (const [key, delta] of Object.entries(patch.s)) {
      if (delta === null) {
        delete threadStatuses[key];
      } else {
        if (Object.keys(delta).some((field) => !STATUS_FIELDS.has(field))) return undefined;
        const status = { ...(threadStatuses[key] ?? {}), ...delta } as LeaderThreadStatus & Record<string, unknown>;
        if (delta.questId === null) delete status.questId;
        if (delta.messageIdHash === null) delete status.messageIdHash;
        threadStatuses[key] = status;
      }
    }
  }

  const next: LeaderThreadTabsProjectionValue = {
    ...previous,
    ...(Object.hasOwn(patch, "d") ? { tabState: patch.d! } : {}),
    ...(patch.a !== undefined ? { mainAttention: patch.a } : {}),
    ...(patch.p !== undefined ? { activePhaseSummary: patch.p } : {}),
    tabs,
    threadStatuses,
  };
  return isLeaderThreadTabsProjectionValue(next) ? reconcileLeaderThreadTabsProjectionValue(previous, next) : undefined;
}

export function leaderThreadTabsProjectionAttentionEqual(
  left: LeaderThreadTabsProjectionAttention,
  right: LeaderThreadTabsProjectionAttention,
): boolean {
  return shallowEqual(left, right);
}

export function leaderThreadTabsProjectionTabEqual(
  left: LeaderThreadTabsProjectionTab,
  right: LeaderThreadTabsProjectionTab,
): boolean {
  return (
    shallowEqual(left, right, ["journey", "attention"]) &&
    journeyEqual(left.journey, right.journey) &&
    leaderThreadTabsProjectionAttentionEqual(left.attention, right.attention)
  );
}

export function leaderThreadTabsProjectionEqual(
  left: LeaderThreadTabsProjectionValue,
  right: LeaderThreadTabsProjectionValue,
): boolean {
  return reconcileLeaderThreadTabsProjectionValue(left, right) === left;
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
  const threadStatuses = reconcileRecord(previous.threadStatuses, next.threadStatuses, shallowEqual);
  const activePhaseSummary = reconcileArray(previous.activePhaseSummary, next.activePhaseSummary, shallowEqual);
  if (
    tabState === previous.tabState &&
    tabs === previous.tabs &&
    mainAttention === previous.mainAttention &&
    threadStatuses === previous.threadStatuses &&
    activePhaseSummary === previous.activePhaseSummary
  ) {
    return previous;
  }
  return {
    currentQuestStateVersion: 1,
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
  return shallowEqual(left, right, ["phaseIds"]) && arraysEqual(left.phaseIds, right.phaseIds, (a, b) => a === b);
}

function tabStateEqual(
  left: LeaderThreadTabsProjectionTabState | null,
  right: LeaderThreadTabsProjectionTabState | null,
): boolean {
  if (!left || !right) return left === right;
  return left.version === right.version;
}

function shallowEqual<T extends object>(left: T, right: T, ignored: readonly string[] = []): boolean {
  const leftKeys = Object.keys(left).filter((key) => !ignored.includes(key));
  const rightKeys = Object.keys(right).filter((key) => !ignored.includes(key));
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => (left as Record<string, unknown>)[key] === (right as Record<string, unknown>)[key])
  );
}
