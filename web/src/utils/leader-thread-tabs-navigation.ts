import {
  LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED,
  type LeaderThreadTabsProjectionJourney,
  type LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
/*
 * The projected duration sentinel is a wire-budget state, distinct from null
 * (authoritative timing unavailable) and from an absent projection overlay.
 */
import { getQuestJourneyPhase, type QuestJourneyPlanState } from "../../shared/quest-journey.js";
import { promoteInMotionLeaderThreadTabsBeforeScheduled } from "../../shared/leader-thread-tab-priority.js";

export interface LeaderThreadNavigationRowBase {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  journeyDurationSummary?: LeaderThreadTabsProjectionJourney["durationSummary"];
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
  journeyDurationSummary?: LeaderThreadTabsProjectionJourney["durationSummary"];
  leaderSessionId?: string | null;
  rowStatus?: unknown;
}

type ProjectedTab = LeaderThreadTabsProjectionValue["tabs"][number];

function stringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function projectedIdentityMatchesDetail(tab: ProjectedTab, existing: ProjectableThreadRowDetail): boolean {
  const existingBoardRow = existing.boardRow;
  return (
    tab.sourceLeaderSessionId !== undefined &&
    tab.sourceLeaderSessionId === (existing.leaderSessionId ?? null) &&
    tab.workerSessionId !== undefined &&
    tab.workerSessionId === (existingBoardRow?.worker ?? null) &&
    tab.workerSessionNum !== undefined &&
    tab.workerSessionNum === (existingBoardRow?.workerNum ?? null) &&
    tab.sourceRowCreatedAt !== undefined &&
    tab.sourceRowCreatedAt === (existingBoardRow?.createdAt ?? null)
  );
}

function projectedJourneyForTab(
  tab: ProjectedTab,
  existingDetail: ProjectableThreadRowDetail | undefined,
): QuestJourneyPlanState | undefined {
  const projected = tab.journey;
  const phaseIds = projected?.phaseIds;
  if (!projected || !phaseIds) return undefined;

  const existing = existingDetail?.journey;
  const preserveExistingDetail =
    !!existing &&
    stringArraysEqual(existing.phaseIds, phaseIds) &&
    !!existingDetail &&
    projectedIdentityMatchesDetail(tab, existingDetail);
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

function projectedNullableField<T>(projected: T | null | undefined): T | undefined {
  return projected ?? undefined;
}

function projectedDurationSummary(
  tab: ProjectedTab,
  existingDetail: ProjectableThreadRowDetail | undefined,
): LeaderThreadTabsProjectionJourney["durationSummary"] | undefined {
  const summary = tab.journey?.durationSummary;
  if (summary === undefined || summary === null) return summary;
  if (summary === LEADER_THREAD_TABS_DURATION_SUMMARY_OMITTED) {
    const hasMatchingDetailedTiming =
      !!existingDetail?.journey?.phaseTimings &&
      Object.keys(existingDetail.journey.phaseTimings).length > 0 &&
      !!tab.journey &&
      stringArraysEqual(existingDetail.journey.phaseIds, tab.journey.phaseIds) &&
      projectedIdentityMatchesDetail(tab, existingDetail);
    return hasMatchingDetailedTiming ? undefined : summary;
  }
  return {
    phaseDurationsMs: [...summary.phaseDurationsMs],
    activePhaseStartedAt: summary.activePhaseStartedAt,
  };
}

/** Overlay current projected tab semantics while retaining identity-matched detailed history where useful. */
export function mergeProjectedLeaderThreadRows<T extends LeaderThreadNavigationRowBase>(
  detailRows: ReadonlyArray<T>,
  projection: LeaderThreadTabsProjectionValue,
  canonicalQuestTitles: ReadonlyMap<string, string>,
): Array<T | LeaderThreadNavigationRowBase> {
  const detailByKey = new Map(detailRows.map((row) => [row.threadKey.toLowerCase(), row]));
  const projectedKeys = new Set<string>();
  const projectedRows = projection.tabs.map((tab) => {
    const threadKey = tab.threadKey.toLowerCase();
    projectedKeys.add(threadKey);
    const existing = detailByKey.get(threadKey);
    const questId = tab.questId ?? threadKey;
    const title = canonicalQuestTitles.get(questId.toLowerCase()) ?? tab.title ?? questId;
    const existingDetail = existing as (T & ProjectableThreadRowDetail) | undefined;
    const existingBoardRow = existingDetail?.boardRow;
    const completed = tab.completed;
    const projectedJourney = projectedJourneyForTab(tab, existingDetail);
    const journeyDurationSummary = projectedDurationSummary(tab, existingDetail);
    const worker = projectedNullableField(tab.workerSessionId);
    const workerNum = projectedNullableField(tab.workerSessionNum);
    const sourceLeaderSessionId = projectedNullableField(tab.sourceLeaderSessionId);
    const shouldProjectBoardRow =
      !!existingBoardRow ||
      tab.boardStatus !== null ||
      !!projectedJourney ||
      tab.workerSessionId !== null ||
      tab.workerSessionNum !== null;
    const sourceRowCreatedAt = projectedNullableField(tab.sourceRowCreatedAt);
    const retainDetailedRowStatus = !!existingDetail && projectedIdentityMatchesDetail(tab, existingDetail);
    const projectedBoardRow = shouldProjectBoardRow
      ? {
          ...(existingBoardRow ?? {}),
          questId,
          title,
          status: tab.boardStatus ?? undefined,
          journey: projectedJourney,
          worker,
          workerNum,
          completedAt: completed ? tab.updatedAt : undefined,
          waitFor: tab.queued ? existingBoardRow?.waitFor : undefined,
          waitForInput: tab.attention.needsInput ? existingBoardRow?.waitForInput : undefined,
          createdAt: sourceRowCreatedAt ?? tab.updatedAt,
          updatedAt: tab.updatedAt,
        }
      : undefined;
    return {
      ...existing,
      rowStatus: retainDetailedRowStatus ? existingDetail?.rowStatus : undefined,
      threadKey,
      questId,
      title,
      status: completed ? "done" : (tab.boardStatus ?? undefined),
      boardStatus: tab.boardStatus ?? undefined,
      journey: projectedJourney,
      journeyDurationSummary,
      boardRow: projectedBoardRow,
      leaderSessionId: sourceLeaderSessionId,
      section: completed ? "done" : "active",
      messageCount: existing?.messageCount ?? 0,
      createdAt: existing?.createdAt ?? tab.updatedAt,
    } as T | LeaderThreadNavigationRowBase;
  });
  return [...projectedRows, ...detailRows.filter((row) => !projectedKeys.has(row.threadKey.toLowerCase()))];
}

/** Materialize restored order plus current candidates, then apply the narrow active-versus-scheduled rule. */
export function buildLeaderThreadMigrationKeys(
  restoredThreadKeys: ReadonlyArray<string>,
  projection: LeaderThreadTabsProjectionValue,
): string[] {
  const seen = new Set(restoredThreadKeys.map((threadKey) => threadKey.trim().toLowerCase()));
  const threadKeys = [...restoredThreadKeys];
  for (const tab of projection.tabs) {
    const threadKey = tab.threadKey.trim().toLowerCase();
    if (seen.has(threadKey)) continue;
    seen.add(threadKey);
    threadKeys.push(threadKey);
  }
  const inMotionThreadKeys = new Set<string>();
  const neverStartedScheduledThreadKeys = new Set<string>();
  for (const tab of projection.tabs) {
    const threadKey = tab.threadKey.trim().toLowerCase();
    if (tab.active) {
      inMotionThreadKeys.add(threadKey);
      continue;
    }
    if ((tab.queued || tab.proposed) && tab.neverStartedScheduled === true) {
      neverStartedScheduledThreadKeys.add(threadKey);
    }
  }
  return promoteInMotionLeaderThreadTabsBeforeScheduled(
    threadKeys,
    inMotionThreadKeys,
    neverStartedScheduledThreadKeys,
  );
}
