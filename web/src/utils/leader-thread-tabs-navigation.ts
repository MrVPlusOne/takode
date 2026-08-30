import type { LeaderThreadTabsProjectionValue } from "../../shared/leader-thread-tabs-projection.js";
import type { QuestJourneyPlanState } from "../../shared/quest-journey.js";

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

function isCompletedStatus(status: string | undefined): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "done" || normalized === "completed" || normalized === "needs_verification";
}

function hasCompletedRowEvidence(row: LeaderThreadNavigationRowBase | undefined): boolean {
  if (!row) return false;
  if (isCompletedStatus(row.status) || isCompletedStatus(row.boardStatus)) return true;
  return row.section === "done" && row.status === undefined && row.boardStatus === undefined;
}

/** Overlay authoritative projected tab semantics while retaining richer legacy row detail where available. */
export function mergeProjectedLeaderThreadRows<T extends LeaderThreadNavigationRowBase>(
  legacyRows: ReadonlyArray<T>,
  projection: LeaderThreadTabsProjectionValue,
  canonicalQuestTitles: ReadonlyMap<string, string>,
): Array<T | LeaderThreadNavigationRowBase> {
  const legacyByKey = new Map(legacyRows.map((row) => [row.threadKey.toLowerCase(), row]));
  const projectedKeys = new Set<string>();
  const projectedRows = projection.tabs.map((tab) => {
    const threadKey = tab.threadKey.toLowerCase();
    projectedKeys.add(threadKey);
    const existing = legacyByKey.get(threadKey);
    const questId = tab.questId ?? threadKey;
    const title = canonicalQuestTitles.get(questId.toLowerCase()) ?? tab.title ?? questId;
    const existingDetail = existing as
      | (T & {
          boardRow?: { status?: string; completedAt?: number; waitFor?: string[]; waitForInput?: string[] };
          journey?: QuestJourneyPlanState;
        })
      | undefined;
    const completed = tab.completed || hasCompletedRowEvidence(existing);
    const existingCompletedStatus =
      existing?.status && isCompletedStatus(existing.status) ? existing.status : undefined;
    const existingCompletedBoardStatus =
      existing?.boardStatus && isCompletedStatus(existing.boardStatus) ? existing.boardStatus : undefined;
    const projectedJourney =
      tab.journey && existingDetail?.journey?.phaseIds.length === tab.journey.phaseCount
        ? {
            ...existingDetail.journey,
            mode: tab.journey.mode ?? undefined,
            currentPhaseId: tab.journey.currentPhaseId ?? undefined,
            activePhaseIndex: tab.journey.activePhaseIndex ?? undefined,
          }
        : undefined;
    const projectedBoardRow = existingDetail?.boardRow
      ? {
          ...existingDetail.boardRow,
          status:
            completed && isCompletedStatus(existingDetail.boardRow.status)
              ? existingDetail.boardRow.status
              : (tab.boardStatus ?? undefined),
          completedAt: completed ? (existingDetail.boardRow.completedAt ?? tab.updatedAt) : undefined,
          waitFor: tab.queued ? existingDetail.boardRow.waitFor : undefined,
          waitForInput: tab.attention.needsInput ? existingDetail.boardRow.waitForInput : undefined,
        }
      : undefined;
    return {
      ...existing,
      threadKey,
      questId,
      title,
      status: completed ? (existingCompletedStatus ?? "done") : (tab.boardStatus ?? undefined),
      boardStatus: completed
        ? (existingCompletedBoardStatus ?? tab.boardStatus ?? undefined)
        : (tab.boardStatus ?? undefined),
      journey: projectedJourney,
      boardRow: projectedBoardRow,
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
