import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhaseForState,
  type QuestJourneyPlanState,
} from "./quest-journey.js";
import { normalizeLeaderOpenThreadKeys, normalizeLeaderThreadKey } from "./leader-open-thread-tabs.js";

const COMPLETED_THREAD_TAB_STATUSES = new Set(["done", "completed", "needs_verification"]);

export interface LeaderThreadTabMutationPolicy {
  inMotion: boolean;
  scheduled: boolean;
  neverStartedScheduled: boolean;
  canClose: boolean;
}

export interface LeaderThreadTabPriorityRow {
  status?: string;
  journey?: Partial<QuestJourneyPlanState>;
  waitForInput?: readonly string[];
  completedAt?: number;
  threadTabActivatedAt?: number;
}

export function isScheduledLeaderThreadTabStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "queued" || normalized === "proposed";
}

/** A scheduled row with no prior active activation is the low-priority class. */
export function isNeverStartedScheduledLeaderThreadTabRow(row: LeaderThreadTabPriorityRow | undefined): boolean {
  return !!row && isScheduledLeaderThreadTabStatus(row.status) && row.threadTabActivatedAt === undefined;
}

/**
 * True only while a row represents active Journey execution. User Checkpoint
 * is in motion only while it still owns an unresolved same-session decision.
 */
export function isInMotionLeaderThreadTabRow(
  row: LeaderThreadTabPriorityRow | undefined,
  options: { completed?: boolean } = {},
): boolean {
  if (!row || options.completed || row.completedAt !== undefined) return false;
  const normalizedStatus = (row.status ?? "").trim().toLowerCase();
  if (COMPLETED_THREAD_TAB_STATUSES.has(normalizedStatus) || isScheduledLeaderThreadTabStatus(row.status)) {
    return false;
  }
  if (normalizedStatus === "user_checkpointing") return (row.waitForInput?.length ?? 0) > 0;
  return (
    getQuestJourneyPhaseForState(row.status) !== null ||
    getQuestJourneyCurrentPhaseId(row.journey, row.status) !== undefined
  );
}

/**
 * Apply the scheduled-tab precedence rule without globally sorting the rail.
 * Only in-motion tabs that are currently behind the first scheduled tab move
 * forward; every peer class keeps its existing relative order.
 */
export function promoteInMotionLeaderThreadTabsBeforeScheduled(
  existingThreadKeys: ReadonlyArray<string>,
  inMotionThreadKeys: ReadonlySet<string>,
  scheduledThreadKeys: ReadonlySet<string>,
): string[] {
  const ordered = normalizeLeaderOpenThreadKeys(existingThreadKeys);
  const inMotion = new Set(
    [...inMotionThreadKeys].map(normalizeLeaderThreadKey).filter((key) => ordered.includes(key)),
  );
  const scheduled = new Set(
    [...scheduledThreadKeys].map(normalizeLeaderThreadKey).filter((key) => ordered.includes(key) && !inMotion.has(key)),
  );
  const firstScheduledIndex = ordered.findIndex((key) => scheduled.has(key));
  if (firstScheduledIndex < 0) return ordered;

  const leading = ordered.slice(0, firstScheduledIndex);
  const trailing = ordered.slice(firstScheduledIndex);
  const promoted = trailing.filter((key) => inMotion.has(key));
  if (promoted.length === 0) return ordered;
  return [...leading, ...promoted, ...trailing.filter((key) => !inMotion.has(key))];
}
