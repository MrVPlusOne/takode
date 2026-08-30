import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import { getQuestJourneyPhase, type QuestJourneyPlanState } from "../../shared/quest-journey.js";
import {
  isInMotionLeaderThreadTabRow,
  isNeverStartedScheduledLeaderThreadTabRow,
  promoteInMotionLeaderThreadTabsBeforeScheduled,
} from "../../shared/leader-thread-tab-priority.js";

export interface LeaderThreadNavigationRowBase {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  section?: "active" | "done";
  messageCount: number;
  createdAt: number;
}

interface ProjectableBoardRow {
  questId?: string;
  title?: string;
  status?: string;
  completedAt?: number;
  waitFor?: string[];
  waitForInput?: string[];
  worker?: string;
  workerNum?: number;
  journey?: QuestJourneyPlanState;
  createdAt?: number;
  updatedAt?: number;
  threadTabActivatedAt?: number;
}

interface ProjectableThreadRowDetail {
  boardRow?: ProjectableBoardRow;
  journey?: QuestJourneyPlanState;
  leaderSessionId?: string | null;
  rowStatus?: unknown;
}

type ProjectedTab = LeaderThreadTabsProjectionValue["tabs"][number];

function isCompletedStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "done" || normalized === "completed" || normalized === "needs_verification";
}

function hasCompletedRowEvidence(row: LeaderThreadNavigationRowBase | undefined): boolean {
  if (!row) return false;
  if (isCompletedStatus(row.status) || isCompletedStatus(row.boardStatus)) return true;
  return row.section === "done" && row.status === undefined && row.boardStatus === undefined;
}

function stringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function projectedIdentityMatchesLegacy(tab: ProjectedTab, existing: ProjectableThreadRowDetail): boolean {
  const existingBoardRow = existing.boardRow;
  const suppliedIdentity =
    tab.sourceLeaderSessionId !== undefined ||
    tab.workerSessionId !== undefined ||
    tab.workerSessionNum !== undefined ||
    tab.sourceRowCreatedAt !== undefined;
  if (!suppliedIdentity) return true;

  const matches = <T>(projected: T | null | undefined, legacy: T | null | undefined) =>
    projected === undefined || projected === (legacy ?? null);
  return (
    matches(tab.sourceLeaderSessionId, existing.leaderSessionId) &&
    matches(tab.workerSessionId, existingBoardRow?.worker) &&
    matches(tab.workerSessionNum, existingBoardRow?.workerNum) &&
    matches(tab.sourceRowCreatedAt, existingBoardRow?.createdAt)
  );
}

function projectedJourneyForTab(
  tab: ProjectedTab,
  existingDetail: ProjectableThreadRowDetail | undefined,
): QuestJourneyPlanState | undefined {
  const projected = tab.journey;
  if (!projected) return undefined;

  const existing = existingDetail?.journey;
  const phaseIds =
    projected.phaseIds ?? (existing?.phaseIds.length === projected.phaseCount ? existing.phaseIds : undefined);
  if (!phaseIds) return undefined;

  const preserveExistingDetail =
    !!existing &&
    stringArraysEqual(existing.phaseIds, phaseIds) &&
    !!existingDetail &&
    projectedIdentityMatchesLegacy(tab, existingDetail);
  const activePhaseIndex = projected.activePhaseIndex ?? undefined;
  const currentPhaseId =
    getQuestJourneyPhase(projected.currentPhaseId)?.id ??
    (activePhaseIndex !== undefined ? phaseIds[activePhaseIndex] : undefined);
  return {
    ...(preserveExistingDetail ? existing : {}),
    phaseIds: [...phaseIds],
    mode: projected.mode ?? undefined,
    currentPhaseId,
    activePhaseIndex,
  };
}

function projectedNullableField<T>(projected: T | null | undefined, legacy: T | undefined): T | undefined {
  return projected === undefined ? legacy : (projected ?? undefined);
}

/** Overlay authoritative projected tab semantics while retaining non-authoritative legacy detail where useful. */
export function mergeProjectedLeaderThreadRows<T extends LeaderThreadNavigationRowBase>(
  legacyRows: ReadonlyArray<T>,
  projection: LeaderThreadTabsProjectionValue,
  canonicalQuestTitles: ReadonlyMap<string, string>,
): Array<T | LeaderThreadNavigationRowBase> {
  const legacyByKey = new Map(legacyRows.map((row) => [row.threadKey.toLowerCase(), row]));
  const currentStateAuthoritative = projection.currentQuestStateVersion === 1;
  const projectedKeys = new Set<string>();
  const projectedRows = projection.tabs.map((tab) => {
    const threadKey = tab.threadKey.toLowerCase();
    projectedKeys.add(threadKey);
    const existing = legacyByKey.get(threadKey);
    const questId = tab.questId ?? threadKey;
    const title = canonicalQuestTitles.get(questId.toLowerCase()) ?? tab.title ?? questId;
    const existingDetail = existing as (T & ProjectableThreadRowDetail) | undefined;
    const existingBoardRow = existingDetail?.boardRow;
    const completed = tab.completed || (!currentStateAuthoritative && hasCompletedRowEvidence(existing));
    const existingCompletedStatus =
      existing?.status && isCompletedStatus(existing.status) ? existing.status : undefined;
    const existingCompletedBoardStatus =
      existing?.boardStatus && isCompletedStatus(existing.boardStatus) ? existing.boardStatus : undefined;
    const projectedJourney = projectedJourneyForTab(tab, existingDetail);
    const worker = projectedNullableField(tab.workerSessionId, existingBoardRow?.worker);
    const workerNum = projectedNullableField(tab.workerSessionNum, existingBoardRow?.workerNum);
    const sourceLeaderSessionId = projectedNullableField(
      tab.sourceLeaderSessionId,
      existingDetail?.leaderSessionId ?? undefined,
    );
    const shouldProjectBoardRow = currentStateAuthoritative
      ? !!existingBoardRow ||
        tab.boardStatus !== null ||
        !!projectedJourney ||
        tab.workerSessionId !== undefined ||
        tab.workerSessionNum !== undefined
      : !!existingBoardRow;
    const sourceRowCreatedAt = projectedNullableField(
      tab.sourceRowCreatedAt,
      existingBoardRow?.createdAt ?? existing?.createdAt,
    );
    const retainLegacyRowStatus =
      !currentStateAuthoritative || !existingDetail || projectedIdentityMatchesLegacy(tab, existingDetail);
    const projectedBoardRow = shouldProjectBoardRow
      ? {
          ...(existingBoardRow ?? {}),
          questId,
          title,
          status:
            !currentStateAuthoritative && completed && isCompletedStatus(existingBoardRow?.status)
              ? existingBoardRow?.status
              : (tab.boardStatus ?? undefined),
          journey: projectedJourney,
          worker,
          workerNum,
          completedAt: completed
            ? currentStateAuthoritative
              ? tab.updatedAt
              : (existingBoardRow?.completedAt ?? tab.updatedAt)
            : undefined,
          waitFor: tab.queued ? existingBoardRow?.waitFor : undefined,
          waitForInput: tab.attention.needsInput ? existingBoardRow?.waitForInput : undefined,
          createdAt: sourceRowCreatedAt ?? tab.updatedAt,
          updatedAt: tab.updatedAt,
        }
      : undefined;
    return {
      ...existing,
      rowStatus: retainLegacyRowStatus ? existingDetail?.rowStatus : undefined,
      threadKey,
      questId,
      title,
      status: completed
        ? currentStateAuthoritative
          ? "done"
          : (existingCompletedStatus ?? "done")
        : (tab.boardStatus ?? undefined),
      boardStatus:
        !currentStateAuthoritative && completed
          ? (existingCompletedBoardStatus ?? tab.boardStatus ?? undefined)
          : (tab.boardStatus ?? undefined),
      journey: projectedJourney,
      boardRow: projectedBoardRow,
      leaderSessionId: sourceLeaderSessionId,
      section: completed ? "done" : "active",
      messageCount: existing?.messageCount ?? 0,
      createdAt: existing?.createdAt ?? tab.updatedAt,
    } as T | LeaderThreadNavigationRowBase;
  });
  return [...projectedRows, ...legacyRows.filter((row) => !projectedKeys.has(row.threadKey.toLowerCase()))];
}

/** Keep one-time local migration order while using projected visuals for overlapping tabs. */
export function mergeProjectedTabsWithRestoredOrder<T extends { threadKey: string }>(
  projectedTabs: ReadonlyArray<T>,
  restoredTabs: ReadonlyArray<T>,
): T[] {
  const projectedByKey = new Map(projectedTabs.map((tab) => [tab.threadKey.toLowerCase(), tab]));
  const restoredKeys = new Set(restoredTabs.map((tab) => tab.threadKey.toLowerCase()));
  return [
    ...restoredTabs.map((tab) => projectedByKey.get(tab.threadKey.toLowerCase()) ?? tab),
    ...projectedTabs.filter((tab) => !restoredKeys.has(tab.threadKey.toLowerCase())),
  ];
}
interface LeaderThreadTabPrioritySourceRow extends ProjectableBoardRow {
  questId: string;
}

/** Preserve legacy/restored peer order while applying the server's narrow scheduled precedence rule. */
export function prioritizeLeaderThreadKeysForFallback(
  threadKeys: ReadonlyArray<string>,
  boardRows: ReadonlyArray<LeaderThreadTabPrioritySourceRow>,
  projection: LeaderThreadTabsProjectionValue | null = null,
): string[] {
  const boardByKey = new Map(boardRows.map((row) => [row.questId.trim().toLowerCase(), row]));
  const inMotionThreadKeys = new Set<string>();
  const neverStartedScheduledThreadKeys = new Set<string>();
  for (const [threadKey, row] of boardByKey) {
    if (isInMotionLeaderThreadTabRow(row)) inMotionThreadKeys.add(threadKey);
    else if (isNeverStartedScheduledLeaderThreadTabRow(row)) neverStartedScheduledThreadKeys.add(threadKey);
  }
  for (const tab of projection?.tabs ?? []) {
    const threadKey = tab.threadKey.trim().toLowerCase();
    if (tab.active) {
      inMotionThreadKeys.add(threadKey);
      neverStartedScheduledThreadKeys.delete(threadKey);
      continue;
    }
    inMotionThreadKeys.delete(threadKey);
    if (tab.queued || tab.proposed) {
      const localRow = boardByKey.get(threadKey);
      if (
        tab.neverStartedScheduled === true ||
        (tab.neverStartedScheduled === undefined && !!localRow && isNeverStartedScheduledLeaderThreadTabRow(localRow))
      ) {
        neverStartedScheduledThreadKeys.add(threadKey);
      } else {
        // A projected false value preserves cross-session requeue history. A
        // missing legacy value also fails conservatively unless local board
        // evidence proves this scheduled run has never started.
        neverStartedScheduledThreadKeys.delete(threadKey);
      }
    } else {
      neverStartedScheduledThreadKeys.delete(threadKey);
    }
  }
  return promoteInMotionLeaderThreadTabsBeforeScheduled(
    threadKeys,
    inMotionThreadKeys,
    neverStartedScheduledThreadKeys,
  );
}
