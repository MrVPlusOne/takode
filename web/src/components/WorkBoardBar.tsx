/**
 * Persistent work board widget for orchestrator sessions.
 *
 * Positioned above the message feed in ChatView. The tab rail stays visually
 * anchored for leader navigation, while the Work Board summary/table behaves
 * like a compact Main-thread banner below the tabs. Once opened, it stays open
 * until the user explicitly collapses it.
 */
import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhase,
  getQuestJourneyPhaseForState,
  getQuestJourneyPresentation,
} from "../../shared/quest-journey.js";
import { BoardTable, orderBoardRows } from "./BoardTable.js";
import type { BoardRowData } from "./BoardTable.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { isAttentionRecordActive, type AttentionRecord } from "../utils/attention-records.js";
import { getQuestPhaseThreadTabTitleColorValue } from "../utils/quest-phase-theme.js";
import type { QuestmasterTask } from "../types.js";
import { isInMotionLeaderThreadTabRow } from "../../shared/leader-thread-tab-priority.js";
import {
  activeBoardSummarySegments,
  boardSummary,
  boardSummarySegmentsFromActivePhaseSummary,
  type BoardSummarySegment,
} from "./leader-board-summary.js";
import { LeaderWorkboardControlButton, SummarySegments } from "./leader-workboard-controls.js";
import type { LeaderWorkboardView } from "../store-types.js";
import { buildCanonicalQuestTitleIndex } from "../utils/quest-title-index.js";
import {
  resolveSessionNavigation,
  type SessionNavigationResolverSource,
} from "../utils/session-navigation-resolver.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import {
  mergeProjectedTabsWithRestoredOrder,
  prioritizeLeaderThreadKeysForFallback,
} from "../utils/leader-thread-tabs-navigation.js";
import type {
  LeaderThreadTabsProjectionTab,
  LeaderThreadTabsProjectionValue,
} from "../../shared/leader-thread-tabs-projection.js";
import {
  DONE_THREAD_TITLE_COLOR,
  QUEUED_THREAD_TITLE_COLOR,
  ThreadNavButton,
  ThreadTabRail,
  isSelectedThread,
  normalizeThreadKey,
  strongestThreadTabTitle,
  threadKeyToSelectAfterClosing,
  type PrimaryThreadChip,
} from "./WorkBoardThreadTabs.js";

export {
  buildCompactThreadTabPartition,
  constrainThreadTabTransformToHorizontal,
  reorderThreadTabsAfterDrag,
} from "./WorkBoardThreadTabs.js";
export type { CompactThreadTabPartition } from "./WorkBoardThreadTabs.js";

export { activeBoardSummarySegments, boardSummary };
export type { BoardSummarySegment };

export interface WorkBoardThreadNavigationRow {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  messageCount?: number;
  section?: "active" | "done";
}

function OtherThreadSection({
  rows,
  totalCount,
  currentThreadKey,
  onSelectThread,
}: {
  rows: WorkBoardThreadNavigationRow[];
  totalCount: number;
  currentThreadKey: string;
  onSelectThread: (threadKey: string) => void;
}) {
  if (totalCount === 0) return null;

  return (
    <div className="px-3 py-2" data-testid="workboard-off-board-threads">
      {rows.length > 0 ? (
        <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="workboard-other-threads-content">
          {rows.map((row) => {
            const selected = isSelectedThread(currentThreadKey, row.threadKey);
            const count = row.messageCount ?? 0;
            const detail = `${count} message${count === 1 ? "" : "s"}`;
            return (
              <ThreadNavButton
                key={row.threadKey}
                label={row.questId ? `${row.questId} ${row.title}` : row.title}
                detail={detail}
                selected={selected}
                onClick={() => onSelectThread(row.threadKey)}
                testId="workboard-off-board-thread"
              />
            );
          })}
        </div>
      ) : (
        <div className="py-1.5 text-xs text-cc-muted italic">No other threads</div>
      )}
    </div>
  );
}

function recordThreadKey(record: AttentionRecord): string {
  return normalizeThreadKey(record.route.threadKey || record.threadKey || record.questId || "main");
}

function isPrimaryThreadAttention(record: AttentionRecord): boolean {
  if (!isAttentionRecordActive(record)) return false;
  if (record.priority === "review" || record.priority === "completed") return false;
  return record.type !== "review_ready" && record.type !== "quest_completed_recent";
}

function isBlueNotificationAttention(record: AttentionRecord): boolean {
  if (!isAttentionRecordActive(record)) return false;
  if (record.source.kind !== "notification") return false;
  return record.priority === "review" || record.priority === "completed" || record.type === "review_ready";
}

function isThreadTabAttention(record: AttentionRecord): boolean {
  return isPrimaryThreadAttention(record) || isBlueNotificationAttention(record) || isMutedNeedsInputAttention(record);
}

function isNeedsInputAttention(record: AttentionRecord): boolean {
  return isAttentionRecordActive(record) && record.priority === "needs_input" && record.type === "needs_input";
}

function isMutedNeedsInputAttention(record: AttentionRecord): boolean {
  return record.state === "muted" && record.priority === "needs_input" && record.type === "needs_input";
}

function notificationIdForAttention(record: AttentionRecord): string | undefined {
  return record.source.kind === "notification" ? record.source.id : undefined;
}

function mutedAttentionNotificationIds(attention: ReadonlyArray<AttentionRecord>): Set<string | undefined> {
  return new Set(attention.filter(isMutedNeedsInputAttention).map(notificationIdForAttention));
}

function boardRowHasActiveNeedsInput(row: BoardRowData, attention: ReadonlyArray<AttentionRecord>): boolean {
  if (attention.some(isNeedsInputAttention)) return true;
  const waitForInput = row.waitForInput ?? [];
  if (waitForInput.length === 0) return false;
  const mutedIds = mutedAttentionNotificationIds(attention);
  return !waitForInput.every((id) => mutedIds.has(id));
}

function boardRowHasMutedNeedsInput(row: BoardRowData, attention: ReadonlyArray<AttentionRecord>): boolean {
  if (attention.some(isMutedNeedsInputAttention)) return true;
  const waitForInput = row.waitForInput ?? [];
  if (waitForInput.length === 0) return false;
  const mutedIds = mutedAttentionNotificationIds(attention);
  return waitForInput.every((id) => mutedIds.has(id));
}

function boardRowDetail(row: BoardRowData): string | undefined {
  if ((row.waitForInput?.length ?? 0) > 0) return "Needs input";
  const currentPhase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
  if (currentPhase) return currentPhase.label;
  const presentation = getQuestJourneyPresentation(row.status);
  if (presentation) return presentation.label;
  return row.status;
}

function isCompletedBoardRow(row?: BoardRowData): boolean {
  return !!row && (row.completedAt !== undefined || isCompletedJourneyPresentationStatus(row.status));
}

function isFinishedThreadRow(row?: WorkBoardThreadNavigationRow): boolean {
  if (!row) return false;
  if (isCompletedJourneyPresentationStatus(row.status) || isCompletedJourneyPresentationStatus(row.boardStatus)) {
    return true;
  }
  const hasExplicitStatus = row.status !== undefined || row.boardStatus !== undefined;
  return row.section === "done" && !hasExplicitStatus;
}

function boardRowTitleColor(row: BoardRowData): string | undefined {
  if (isCompletedBoardRow(row)) return DONE_THREAD_TITLE_COLOR;
  if ((row.status ?? "").trim().toUpperCase() === "QUEUED") return QUEUED_THREAD_TITLE_COLOR;
  const currentPhase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
  const phase = currentPhase ?? getQuestJourneyPhaseForState(row.status);
  return phase ? getQuestPhaseThreadTabTitleColorValue(phase.color) : undefined;
}

function doneThreadTitleColor({
  boardRow,
  row,
  completed,
}: {
  boardRow?: BoardRowData;
  row?: WorkBoardThreadNavigationRow;
  completed?: boolean;
}): string | undefined {
  if (completed || isFinishedThreadRow(row) || isCompletedBoardRow(boardRow)) {
    return DONE_THREAD_TITLE_COLOR;
  }
  return undefined;
}

function threadRowDetail(row: WorkBoardThreadNavigationRow): string {
  const count = row.messageCount ?? 0;
  return `${count} message${count === 1 ? "" : "s"}`;
}

function doneThreadDetail(row?: WorkBoardThreadNavigationRow): string {
  if (!row) return "History";
  if (isFinishedThreadRow(row)) return "Done";
  return threadRowDetail(row);
}

function projectedThreadTabTitleColor(tab: LeaderThreadTabsProjectionTab, completed: boolean): string | undefined {
  if (completed) return DONE_THREAD_TITLE_COLOR;
  if (tab.queued) return QUEUED_THREAD_TITLE_COLOR;
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  const fallbackPhase = phase ?? getQuestJourneyPhaseForState(tab.boardStatus ?? undefined);
  return fallbackPhase ? getQuestPhaseThreadTabTitleColorValue(fallbackPhase.color) : undefined;
}

function projectedThreadTabDetail(tab: LeaderThreadTabsProjectionTab, completed: boolean): string | undefined {
  if (tab.attention.needsInput) return "Needs input";
  if (completed) return "Done";
  if (tab.queued) return "Queued";
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  return (
    phase?.label ?? getQuestJourneyPresentation(tab.boardStatus ?? undefined)?.label ?? tab.boardStatus ?? undefined
  );
}

function buildProjectedThreadTabs(
  projection: LeaderThreadTabsProjectionValue | null,
  questTitleById: ReadonlyMap<string, string>,
  questById: ReadonlyMap<string, QuestmasterTask>,
  threadRows: WorkBoardThreadNavigationRow[],
): PrimaryThreadChip[] {
  const currentStateAuthoritative = projection?.currentQuestStateVersion === 1;
  const rowByKey = new Map(threadRows.map((row) => [normalizeThreadKey(row.threadKey), row]));
  return (projection?.tabs ?? []).map((tab) => {
    const questId = tab.questId ?? tab.threadKey;
    const normalizedQuestId = normalizeThreadKey(questId);
    const title = questTitleById.get(normalizedQuestId) ?? tab.title ?? questId;
    const completed =
      tab.completed ||
      (!currentStateAuthoritative &&
        (isFinishedThreadRow(rowByKey.get(normalizeThreadKey(tab.threadKey))) ||
          isCompletedJourneyPresentationStatus(questById.get(normalizedQuestId)?.status)));
    return {
      threadKey: tab.threadKey,
      questId,
      title,
      detail: projectedThreadTabDetail(tab, completed),
      needsInput: tab.attention.needsInput,
      mutedNeedsInput: tab.attention.mutedNeedsInput,
      blueNudge: tab.attention.reviewUnread,
      titleColor: projectedThreadTabTitleColor(tab, completed),
      projectedCurrentState: currentStateAuthoritative,
      canClose: currentStateAuthoritative ? tab.canClose : completed || tab.canClose,
      updatedAt: tab.updatedAt,
    };
  });
}

function mergePrimaryThreadChip(chips: Map<string, PrimaryThreadChip>, chip: PrimaryThreadChip) {
  const existing = chips.get(chip.threadKey);
  if (!existing) {
    chips.set(chip.threadKey, chip);
    return;
  }
  chips.set(chip.threadKey, {
    ...existing,
    questId: existing.questId ?? chip.questId,
    title: existing.title || chip.title,
    detail: existing.needsInput ? existing.detail : (chip.detail ?? existing.detail),
    messageCount: Math.max(existing.messageCount ?? 0, chip.messageCount ?? 0),
    needsInput: existing.needsInput || chip.needsInput,
    mutedNeedsInput: existing.mutedNeedsInput || chip.mutedNeedsInput,
    blueNudge: existing.blueNudge || chip.blueNudge,
    titleColor: existing.titleColor ?? chip.titleColor,
    canClose: existing.canClose && chip.canClose,
    route: existing.route ?? chip.route,
    updatedAt: Math.max(existing.updatedAt, chip.updatedAt),
  });
}

function buildPrimaryThreadChips({
  activeBoardRows,
  threadRows,
  attentionRecords,
}: {
  activeBoardRows: BoardRowData[];
  threadRows: WorkBoardThreadNavigationRow[];
  attentionRecords: ReadonlyArray<AttentionRecord>;
}): PrimaryThreadChip[] {
  const chips = new Map<string, PrimaryThreadChip>();
  const primaryAttentionByThread = new Map<string, AttentionRecord[]>();

  for (const record of attentionRecords) {
    if (!isThreadTabAttention(record)) continue;
    const key = recordThreadKey(record);
    const existing = primaryAttentionByThread.get(key);
    if (existing) existing.push(record);
    else primaryAttentionByThread.set(key, [record]);
  }

  const boardRowKeys = new Set<string>();
  for (const row of orderBoardRows(activeBoardRows)) {
    const threadKey = normalizeThreadKey(row.questId);
    boardRowKeys.add(threadKey);
    const attention = primaryAttentionByThread.get(threadKey) ?? [];
    mergePrimaryThreadChip(chips, {
      threadKey,
      questId: row.questId,
      title: row.title ?? row.questId,
      detail: boardRowDetail(row),
      needsInput: boardRowHasActiveNeedsInput(row, attention),
      mutedNeedsInput: boardRowHasMutedNeedsInput(row, attention),
      blueNudge: attention.some(isBlueNotificationAttention),
      titleColor: boardRowTitleColor(row),
      canClose: !isInMotionLeaderThreadTabRow(row),
      route: attention[0]?.route,
      updatedAt: Math.max(row.updatedAt, ...attention.map((record) => record.updatedAt), 0),
    });
  }

  for (const row of threadRows) {
    const threadKey = normalizeThreadKey(row.threadKey);
    if (row.section !== "active" || boardRowKeys.has(threadKey)) continue;
    const attention = primaryAttentionByThread.get(threadKey) ?? [];
    if (attention.length === 0) continue;
    mergePrimaryThreadChip(chips, {
      threadKey,
      questId: row.questId,
      title: row.title,
      detail: threadRowDetail(row),
      messageCount: row.messageCount,
      needsInput: attention.some(isNeedsInputAttention),
      mutedNeedsInput: attention.some(isMutedNeedsInputAttention),
      blueNudge: attention.some(isBlueNotificationAttention),
      canClose: true,
      route: attention[0]?.route,
      updatedAt: Math.max(...attention.map((record) => record.updatedAt), 0),
    });
  }

  for (const records of primaryAttentionByThread.values()) {
    const record = records[0];
    const threadKey = recordThreadKey(record);
    if (chips.has(threadKey)) continue;
    mergePrimaryThreadChip(chips, {
      threadKey,
      questId: record.route.questId ?? record.questId,
      title: record.title,
      detail: record.actionLabel,
      needsInput: records.some(isNeedsInputAttention),
      mutedNeedsInput: records.some(isMutedNeedsInputAttention),
      blueNudge: records.some(isBlueNotificationAttention),
      canClose: true,
      route: record.route,
      updatedAt: Math.max(...records.map((candidate) => candidate.updatedAt), 0),
    });
  }

  return [...chips.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.threadKey.localeCompare(b.threadKey));
}

function buildOpenThreadTabs({
  openThreadKeys,
  threadRows,
  activeThreadChips,
  activeBoardRows,
  completedBoardRows,
  questById,
  questTitleById,
}: {
  openThreadKeys: ReadonlyArray<string>;
  threadRows: WorkBoardThreadNavigationRow[];
  activeThreadChips: PrimaryThreadChip[];
  activeBoardRows: BoardRowData[];
  completedBoardRows: BoardRowData[];
  questById: ReadonlyMap<string, QuestmasterTask>;
  questTitleById: ReadonlyMap<string, string>;
}): PrimaryThreadChip[] {
  const activeByKey = new Map(activeThreadChips.map((chip) => [chip.threadKey, chip]));
  const rowByKey = new Map(threadRows.map((row) => [normalizeThreadKey(row.threadKey), row]));
  const activeBoardByKey = new Map(activeBoardRows.map((row) => [normalizeThreadKey(row.questId), row]));
  const completedBoardByKey = new Map(completedBoardRows.map((row) => [normalizeThreadKey(row.questId), row]));
  const seen = new Set<string>();
  const tabs: PrimaryThreadChip[] = [];

  for (const rawKey of openThreadKeys) {
    const threadKey = normalizeThreadKey(rawKey);
    if (!threadKey || threadKey === MAIN_THREAD_KEY || threadKey === ALL_THREADS_KEY || seen.has(threadKey)) continue;
    seen.add(threadKey);

    const active = activeByKey.get(threadKey);
    const row = rowByKey.get(threadKey);
    const activeBoardRow = activeBoardByKey.get(threadKey);
    const completedBoardRow = completedBoardByKey.get(threadKey);
    const boardRow = activeBoardRow ?? completedBoardRow;
    const questId = active?.questId ?? row?.questId ?? boardRow?.questId ?? threadKey;
    const normalizedQuestId = normalizeThreadKey(questId);
    const quest = questById.get(normalizedQuestId);
    const projectedQuestTitle = questTitleById.get(normalizedQuestId);
    if (!active && !row && !boardRow && !quest && !projectedQuestTitle) continue;
    const completedTitleColor = doneThreadTitleColor({
      boardRow,
      row,
      completed: !activeBoardRow && !!completedBoardRow,
    });

    tabs.push({
      threadKey,
      questId,
      title: strongestThreadTabTitle({
        threadKey,
        questId,
        questTitle: projectedQuestTitle ?? quest?.title,
        boardRowTitle: boardRow?.title,
        rowTitle: row?.title,
        activeTitle: active?.title,
      }),
      detail: active?.detail ?? (boardRow ? boardRowDetail(boardRow) : doneThreadDetail(row)),
      messageCount: active?.messageCount ?? row?.messageCount,
      needsInput: active?.needsInput ?? (boardRow?.waitForInput?.length ?? 0) > 0,
      mutedNeedsInput: active?.mutedNeedsInput ?? false,
      blueNudge: active?.blueNudge ?? false,
      titleColor: completedTitleColor ?? active?.titleColor ?? (boardRow ? boardRowTitleColor(boardRow) : undefined),
      canClose: !activeBoardRow || !isInMotionLeaderThreadTabRow(activeBoardRow),
      route: active?.route,
      updatedAt: active?.updatedAt ?? boardRow?.updatedAt ?? 0,
    });
  }

  return tabs;
}

function buildUnifiedThreadTabs({
  openThreadTabs,
  closedActiveThreadChips,
  leadingPendingThreadKeys,
}: {
  openThreadTabs: PrimaryThreadChip[];
  closedActiveThreadChips: PrimaryThreadChip[];
  leadingPendingThreadKeys: ReadonlySet<string>;
}): PrimaryThreadChip[] {
  if (openThreadTabs.length === 0) return closedActiveThreadChips;

  const leadingPendingTabs: PrimaryThreadChip[] = [];
  const trailingPendingTabs: PrimaryThreadChip[] = [];
  const seenPendingKeys = new Set<string>();

  for (const chip of closedActiveThreadChips) {
    const threadKey = normalizeThreadKey(chip.threadKey);
    if (!threadKey || seenPendingKeys.has(threadKey)) continue;
    seenPendingKeys.add(threadKey);
    if (leadingPendingThreadKeys.has(threadKey)) {
      leadingPendingTabs.push(chip);
    } else {
      trailingPendingTabs.push(chip);
    }
  }

  return [...leadingPendingTabs, ...openThreadTabs, ...trailingPendingTabs];
}

function ProjectionToggle({
  currentThreadKey,
  onSelectThread,
}: {
  currentThreadKey: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  if (!onSelectThread) return null;
  const allSelected = isSelectedThread(currentThreadKey, ALL_THREADS_KEY);
  const mainSelected = !allSelected;
  const base =
    "inline-flex h-6 items-center rounded px-2 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset";
  const selected = "bg-cc-hover text-cc-fg";
  const idle = "text-cc-muted hover:bg-cc-hover/55 hover:text-cc-fg";
  return (
    <div
      className="inline-flex shrink-0 items-center rounded-md border border-cc-border/70 bg-cc-card/60 p-0.5"
      data-testid="workboard-projection-toggle"
      aria-label="Main thread projection"
    >
      <button
        type="button"
        onClick={() => onSelectThread(MAIN_THREAD_KEY)}
        className={`${base} ${mainSelected ? selected : idle}`}
        aria-pressed={mainSelected}
        data-testid="workboard-projection-main"
      >
        Main
      </button>
      <button
        type="button"
        onClick={() => onSelectThread(ALL_THREADS_KEY)}
        className={`${base} ${allSelected ? selected : idle}`}
        aria-pressed={allSelected}
        data-testid="workboard-projection-all"
      >
        All
      </button>
    </div>
  );
}

export function resolveWorkBoardIsOrchestrator(source: SessionNavigationResolverSource, sessionId: string): boolean {
  return (
    resolveLeaderThreadTabsProjection(source, sessionId).projectionState === "accepted" ||
    resolveSessionNavigation(source, sessionId)?.viewModel.isOrchestrator === true
  );
}

export function WorkBoardBar({
  sessionId,
  currentThreadKey = "main",
  onSelectThread,
  openThreadKeys = [],
  closedThreadKeys,
  onCloseThreadTab,
  onReorderThreadTabs,
  threadRows = [],
  attentionRecords = [],
}: {
  sessionId: string;
  currentThreadKey?: string;
  currentThreadLabel?: string;
  onSelectThread?: (threadKey: string) => void;
  openThreadKeys?: string[];
  closedThreadKeys?: string[];
  onCloseThreadTab?: (threadKey: string, nextThreadKey: string) => void;
  onReorderThreadTabs?: (orderedThreadKeys: string[]) => void;
  threadRows?: WorkBoardThreadNavigationRow[];
  attentionRecords?: ReadonlyArray<AttentionRecord>;
}) {
  const board = useStore((s) => s.sessionBoards.get(sessionId));
  const rowSessionStatuses = useStore((s) => s.sessionBoardRowStatuses.get(sessionId));
  const completedBoard = useStore((s) => s.sessionCompletedBoards.get(sessionId));
  const isOrchestrator = useStore((s) => resolveWorkBoardIsOrchestrator(s, sessionId));
  const leaderTabsResolution = useStore(useShallow((s) => resolveLeaderThreadTabsProjection(s, sessionId)));
  const leaderTabsProjection = leaderTabsResolution.projectionState === "accepted" ? leaderTabsResolution.value : null;
  const leaderTabsProjectionOwned = leaderTabsResolution.projectionState !== "legacy";
  const legacyThreadStatuses = useStore((s) => s.sessions.get(sessionId)?.leaderThreadStatuses);
  const threadStatuses = leaderTabsProjectionOwned
    ? (leaderTabsProjection?.threadStatuses ?? {})
    : legacyThreadStatuses;
  const activeView = useStore((s) => s.leaderWorkboardViews?.get(sessionId) ?? null);
  const setLeaderWorkboardView = useStore((s) => s.setLeaderWorkboardView ?? (() => {}));

  const showMainBanner =
    isSelectedThread(currentThreadKey, MAIN_THREAD_KEY) || isSelectedThread(currentThreadKey, ALL_THREADS_KEY);

  useEffect(() => {
    if (!activeView) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLeaderWorkboardView(sessionId, null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeView, sessionId, setLeaderWorkboardView]);

  const activeCount = board?.length ?? 0;
  const completedCount = completedBoard?.length ?? 0;
  const activeBoardRows = board ?? [];
  const completedBoardRows = completedBoard ?? [];
  const quests = useStore((s) => s.quests);
  const questDetails = useStore((s) => s.questDetails ?? new Map<string, QuestmasterTask>());
  const questTitlePreviews = useStore((s) => s.questTitlePreviews ?? new Map());
  const questById = useMemo(() => {
    const byId = new Map(quests.map((quest) => [normalizeThreadKey(quest.questId), quest]));
    for (const quest of questDetails.values()) byId.set(normalizeThreadKey(quest.questId), quest);
    return byId;
  }, [questDetails, quests]);
  const questTitleById = useMemo(
    () =>
      buildCanonicalQuestTitleIndex({
        quests,
        questDetails,
        questTitlePreviews,
      }),
    [questDetails, questTitlePreviews, quests],
  );
  const activeThreadChips = useMemo(
    () =>
      buildPrimaryThreadChips({
        activeBoardRows,
        threadRows,
        attentionRecords,
      }),
    [activeBoardRows, attentionRecords, threadRows],
  );
  const openThreadTabs = useMemo(() => {
    const buildLegacyTabs = () =>
      buildOpenThreadTabs({
        openThreadKeys,
        threadRows,
        activeThreadChips,
        activeBoardRows,
        completedBoardRows,
        questById,
        questTitleById,
      });
    if (!leaderTabsProjectionOwned) return buildLegacyTabs();
    const projectedTabs = buildProjectedThreadTabs(leaderTabsProjection, questTitleById, questById, threadRows);
    return leaderTabsProjection?.tabState === null
      ? mergeProjectedTabsWithRestoredOrder(projectedTabs, buildLegacyTabs())
      : projectedTabs;
  }, [
    activeBoardRows,
    activeThreadChips,
    completedBoardRows,
    leaderTabsProjection,
    leaderTabsProjectionOwned,
    openThreadKeys,
    questById,
    questTitleById,
    threadRows,
  ]);
  const previousOpenThreadTabKeysRef = useRef<string[] | null>(null);
  const newThreadTabTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [newThreadTabKeys, setNewThreadTabKeys] = useState<Set<string>>(() => new Set());
  const [dismissedAutoThreadTabKeys, setDismissedAutoThreadTabKeys] = useState<Set<string>>(() => new Set());
  const closedThreadKeySet = useMemo(() => {
    const keys = new Set<string>();
    for (const key of closedThreadKeys ?? []) {
      const normalized = normalizeThreadKey(key);
      if (normalized && normalized !== MAIN_THREAD_KEY && normalized !== ALL_THREADS_KEY) keys.add(normalized);
    }
    return keys;
  }, [closedThreadKeys]);
  useEffect(() => {
    setDismissedAutoThreadTabKeys(new Set());
  }, [sessionId]);
  useEffect(() => {
    if (closedThreadKeySet.size === 0) return;
    setDismissedAutoThreadTabKeys((existing) => {
      let changed = false;
      const next = new Set(existing);
      for (const key of closedThreadKeySet) {
        if (next.has(key)) continue;
        next.add(key);
        changed = true;
      }
      return changed ? next : existing;
    });
  }, [closedThreadKeySet]);
  useEffect(() => {
    const currentKeys = openThreadTabs.map((tab) => tab.threadKey);
    const previousKeys = previousOpenThreadTabKeysRef.current;
    previousOpenThreadTabKeysRef.current = currentKeys;
    if (previousKeys === null) return;

    const previous = new Set(previousKeys);
    const addedKeys = currentKeys.filter((key) => !previous.has(key));
    if (addedKeys.length === 0) return;

    setNewThreadTabKeys((existing) => new Set([...existing, ...addedKeys]));
    for (const key of addedKeys) {
      const existingTimeout = newThreadTabTimeoutsRef.current.get(key);
      if (existingTimeout) clearTimeout(existingTimeout);
      const timeout = setTimeout(() => {
        newThreadTabTimeoutsRef.current.delete(key);
        setNewThreadTabKeys((existing) => {
          const next = new Set(existing);
          next.delete(key);
          return next;
        });
      }, 900);
      newThreadTabTimeoutsRef.current.set(key, timeout);
    }
  }, [openThreadTabs]);
  useEffect(
    () => () => {
      for (const timeout of newThreadTabTimeoutsRef.current.values()) clearTimeout(timeout);
      newThreadTabTimeoutsRef.current.clear();
    },
    [],
  );
  const mainThreadState = useMemo(() => {
    if (!leaderTabsProjectionOwned) return activeThreadChips.find((chip) => chip.threadKey === MAIN_THREAD_KEY);
    const attention = leaderTabsProjection?.mainAttention;
    if (!attention) return undefined;
    return {
      threadKey: MAIN_THREAD_KEY,
      title: "Main Thread",
      needsInput: attention.needsInput,
      mutedNeedsInput: attention.mutedNeedsInput,
      blueNudge: attention.reviewUnread,
      canClose: false,
      updatedAt: attention.updatedAt,
    } satisfies PrimaryThreadChip;
  }, [activeThreadChips, leaderTabsProjection, leaderTabsProjectionOwned]);
  const openThreadTabKeys = useMemo(() => new Set(openThreadTabs.map((tab) => tab.threadKey)), [openThreadTabs]);
  const activeBoardThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of activeBoardRows) keys.add(normalizeThreadKey(row.questId));
    return keys;
  }, [activeBoardRows]);
  const protectedActiveBoardThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of activeBoardRows) {
      if (isInMotionLeaderThreadTabRow(row)) keys.add(normalizeThreadKey(row.questId));
    }
    return keys;
  }, [activeBoardRows]);
  const closedActiveThreadChips = useMemo(
    () =>
      activeThreadChips.filter(
        (chip) =>
          chip.threadKey !== MAIN_THREAD_KEY &&
          chip.threadKey !== ALL_THREADS_KEY &&
          !openThreadTabKeys.has(chip.threadKey) &&
          (protectedActiveBoardThreadKeys.has(chip.threadKey) || !dismissedAutoThreadTabKeys.has(chip.threadKey)),
      ),
    [activeThreadChips, dismissedAutoThreadTabKeys, openThreadTabKeys, protectedActiveBoardThreadKeys],
  );
  const closedActiveBoardThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const chip of closedActiveThreadChips) {
      const threadKey = normalizeThreadKey(chip.threadKey);
      if (activeBoardThreadKeys.has(threadKey) && !openThreadTabKeys.has(threadKey)) keys.add(threadKey);
    }
    return keys;
  }, [activeBoardThreadKeys, closedActiveThreadChips, openThreadTabKeys]);
  const pendingThreadTabSessionRef = useRef(sessionId);
  const previousClosedActiveBoardThreadKeysRef = useRef<Set<string> | null>(null);
  const leadingPendingThreadKeysRef = useRef<Set<string>>(new Set());
  const leadingPendingThreadKeys = useMemo(() => {
    // Fresh pending tabs are a render-lifecycle signal, not a content timestamp.
    // Existing board chips may update later without becoming newly opened tabs.
    const sameSession = pendingThreadTabSessionRef.current === sessionId;
    const previousKeys = sameSession ? previousClosedActiveBoardThreadKeysRef.current : null;
    const rememberedKeys = sameSession ? leadingPendingThreadKeysRef.current : new Set<string>();
    const nextKeys = new Set<string>();

    for (const key of rememberedKeys) {
      if (
        closedActiveBoardThreadKeys.has(key) &&
        protectedActiveBoardThreadKeys.has(key) &&
        !openThreadTabKeys.has(key)
      ) {
        nextKeys.add(key);
      }
    }
    if (previousKeys) {
      for (const key of closedActiveBoardThreadKeys) {
        if (protectedActiveBoardThreadKeys.has(key) && !previousKeys.has(key) && !openThreadTabKeys.has(key)) {
          nextKeys.add(key);
        }
      }
    }
    return nextKeys;
  }, [closedActiveBoardThreadKeys, openThreadTabKeys, protectedActiveBoardThreadKeys, sessionId]);
  useLayoutEffect(() => {
    pendingThreadTabSessionRef.current = sessionId;
    previousClosedActiveBoardThreadKeysRef.current = new Set(closedActiveBoardThreadKeys);
    leadingPendingThreadKeysRef.current = new Set(leadingPendingThreadKeys);
  }, [closedActiveBoardThreadKeys, leadingPendingThreadKeys, sessionId]);
  const unifiedThreadTabs = useMemo(
    () =>
      leaderTabsProjectionOwned
        ? openThreadTabs
        : buildUnifiedThreadTabs({
            openThreadTabs,
            closedActiveThreadChips,
            leadingPendingThreadKeys,
          }),
    [closedActiveThreadChips, leaderTabsProjectionOwned, leadingPendingThreadKeys, openThreadTabs],
  );
  const displayedThreadTabs = useMemo(() => {
    if (leaderTabsProjectionOwned && leaderTabsProjection?.tabState !== null) return unifiedThreadTabs;
    const orderedKeys = prioritizeLeaderThreadKeysForFallback(
      unifiedThreadTabs.map((tab) => tab.threadKey),
      activeBoardRows,
      leaderTabsProjection,
    );
    const tabsByKey = new Map(unifiedThreadTabs.map((tab) => [normalizeThreadKey(tab.threadKey), tab]));
    return orderedKeys.map((threadKey) => tabsByKey.get(threadKey)).filter((tab): tab is PrimaryThreadChip => !!tab);
  }, [activeBoardRows, leaderTabsProjection, leaderTabsProjectionOwned, unifiedThreadTabs]);
  const handleCloseThreadTab = (threadKey: string) => {
    const normalized = normalizeThreadKey(threadKey);
    const nextThreadKey = threadKeyToSelectAfterClosing(normalized, displayedThreadTabs);
    onCloseThreadTab?.(normalized, nextThreadKey);

    setDismissedAutoThreadTabKeys((existing) => new Set([...existing, normalized]));
    if (openThreadTabKeys.has(normalized)) return;
    if (isSelectedThread(currentThreadKey, normalized)) {
      onSelectThread?.(nextThreadKey);
    }
  };
  const boardThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of activeBoardRows) keys.add(normalizeThreadKey(row.questId));
    for (const row of completedBoardRows) keys.add(normalizeThreadKey(row.questId));
    return keys;
  }, [activeBoardRows, completedBoardRows]);
  const offBoardThreads = useMemo(
    () =>
      threadRows
        .filter((row) => !boardThreadKeys.has(normalizeThreadKey(row.threadKey)))
        .sort((a, b) => a.threadKey.localeCompare(b.threadKey)),
    [boardThreadKeys, threadRows],
  );
  const activeSummarySegments = useMemo(
    () =>
      leaderTabsProjectionOwned
        ? boardSummarySegmentsFromActivePhaseSummary(leaderTabsProjection?.activePhaseSummary ?? [])
        : activeBoardSummarySegments(activeBoardRows),
    [activeBoardRows, leaderTabsProjection, leaderTabsProjectionOwned],
  );
  const handleSelectView = (view: LeaderWorkboardView) => {
    setLeaderWorkboardView(sessionId, activeView === view ? null : view);
  };
  const panelView =
    activeView === "active" && activeSummarySegments.length === 0
      ? null
      : activeView === "completed" && completedCount === 0
        ? null
        : activeView === "other" && offBoardThreads.length === 0
          ? null
          : activeView;

  // This is the primary thread navigator for leader sessions, so keep it visible
  // even before the first quest row exists.
  if (!isOrchestrator) return null;

  return (
    <div className="shrink-0 flex flex-col min-h-0">
      <ThreadTabRail
        mainState={mainThreadState}
        tabs={displayedThreadTabs}
        reorderableThreadKeys={openThreadTabs.map((tab) => normalizeThreadKey(tab.threadKey))}
        sessionId={sessionId}
        currentThreadKey={currentThreadKey}
        onSelectThread={onSelectThread}
        onCloseThreadTab={onCloseThreadTab ? handleCloseThreadTab : undefined}
        onReorderThreadTabs={onReorderThreadTabs}
        newTabKeys={newThreadTabKeys}
        threadStatuses={threadStatuses}
      />

      {showMainBanner && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-cc-border bg-cc-card px-3 py-1.5 sm:flex-nowrap sm:px-4"
          data-testid="workboard-main-banner"
          data-active-view={panelView ?? ""}
        >
          <ProjectionToggle currentThreadKey={currentThreadKey} onSelectThread={onSelectThread} />
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-cc-info shrink-0">
            <path d="M1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11zM2.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-11z" />
            <path d="M4 4h2v5H4zM7 4h2v7H7zM10 4h2v3h-2z" />
          </svg>

          {activeSummarySegments.length > 0 && (
            <LeaderWorkboardControlButton
              view="active"
              activeView={panelView}
              onSelectView={handleSelectView}
              testId="workboard-active-button"
              ariaLabel="Open active workboard"
            >
              <span className="min-w-0 truncate" data-testid="workboard-phase-summary">
                <SummarySegments segments={activeSummarySegments} />
              </span>
            </LeaderWorkboardControlButton>
          )}
          {completedCount > 0 && (
            <LeaderWorkboardControlButton
              view="completed"
              activeView={panelView}
              onSelectView={handleSelectView}
              testId="workboard-completed-button"
              ariaLabel="Open completed quests"
            >
              <span className="tabular-nums">{completedCount}</span>
              <span>Completed</span>
            </LeaderWorkboardControlButton>
          )}
          {offBoardThreads.length > 0 && (
            <LeaderWorkboardControlButton
              view="other"
              activeView={panelView}
              onSelectView={handleSelectView}
              testId="workboard-other-button"
              ariaLabel="Open other threads"
            >
              <span className="tabular-nums">{offBoardThreads.length}</span>
              <span>Other</span>
            </LeaderWorkboardControlButton>
          )}
          {activeSummarySegments.length === 0 && completedCount === 0 && offBoardThreads.length === 0 && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-cc-muted" data-testid="workboard-empty-summary">
              Empty
            </span>
          )}

          <span className="ml-auto text-[10px] text-cc-muted shrink-0 tabular-nums">
            {activeCount} {activeCount === 1 ? "item" : "items"}
          </span>
        </div>
      )}

      {panelView && (
        <div
          className="max-h-[55dvh] overflow-y-auto border-b border-cc-border bg-cc-card"
          data-testid="workboard-panel"
          data-view={panelView}
        >
          {panelView === "active" && activeBoardRows.length > 0 && (
            <BoardTable
              board={activeBoardRows}
              rowSessionStatuses={rowSessionStatuses}
              selectedThreadKey={currentThreadKey}
              onSelectQuestThread={onSelectThread}
            />
          )}
          {panelView === "active" && activeBoardRows.length === 0 && (
            <div className="px-3 py-3 text-xs text-cc-muted italic">No active items</div>
          )}
          {panelView === "completed" && completedBoardRows.length > 0 && (
            <div className="opacity-70">
              <BoardTable
                board={completedBoardRows}
                mode="completed"
                rowSessionStatuses={rowSessionStatuses}
                selectedThreadKey={currentThreadKey}
                onSelectQuestThread={onSelectThread}
              />
            </div>
          )}
          {panelView === "completed" && completedBoardRows.length === 0 && (
            <div className="px-3 py-3 text-xs text-cc-muted italic">No completed quests</div>
          )}
          {panelView === "other" && onSelectThread && (
            <OtherThreadSection
              rows={offBoardThreads}
              totalCount={offBoardThreads.length}
              currentThreadKey={currentThreadKey}
              onSelectThread={onSelectThread}
            />
          )}
        </div>
      )}
    </div>
  );
}
