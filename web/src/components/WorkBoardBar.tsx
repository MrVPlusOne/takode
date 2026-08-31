/**
 * Persistent work board widget for orchestrator sessions.
 *
 * The tab rail consumes the current synchronized visual projection. Detailed
 * board rows stay independently authoritative and load only while their panel
 * is open.
 */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import {
  getQuestJourneyPhase,
  getQuestJourneyPhaseForState,
  getQuestJourneyPresentation,
} from "../../shared/quest-journey.js";
import { BoardTable } from "./BoardTable.js";
import type { BoardRowData } from "./BoardTable.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { getQuestPhaseThreadTabTitleColorValue } from "../utils/quest-phase-theme.js";
import {
  activeBoardSummarySegments,
  boardSummary,
  boardSummarySegmentsFromActivePhaseSummary,
  type BoardSummarySegment,
} from "./leader-board-summary.js";
import { LeaderWorkboardControlButton, SummarySegments } from "./leader-workboard-controls.js";
import type { LeaderWorkboardView } from "../store-types.js";
import { selectCanonicalQuestTitle } from "../utils/quest-title-index.js";
import {
  resolveLeaderThreadTabsProjection,
  type LeaderThreadTabsProjectionSource,
} from "../utils/leader-thread-tabs-resolver.js";
import {
  resolveSessionNavigation,
  type SessionNavigationResolverSource,
} from "../utils/session-navigation-resolver.js";
import { buildLeaderThreadMigrationKeys } from "../utils/leader-thread-tabs-navigation.js";
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

const EMPTY_BOARD_ROWS: BoardRowData[] = [];
const EMPTY_ROW_STATUSES = {};

function OtherThreadSection({
  rows,
  currentThreadKey,
  onSelectThread,
}: {
  rows: WorkBoardThreadNavigationRow[];
  currentThreadKey: string;
  onSelectThread: (threadKey: string) => void;
}) {
  if (rows.length === 0) return <div className="py-1.5 text-xs text-cc-muted italic">No other threads</div>;

  return (
    <div className="px-3 py-2" data-testid="workboard-off-board-threads">
      <div className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3" data-testid="workboard-other-threads-content">
        {rows.map((row) => {
          const selected = isSelectedThread(currentThreadKey, row.threadKey);
          const count = row.messageCount ?? 0;
          return (
            <ThreadNavButton
              key={row.threadKey}
              label={row.questId ? `${row.questId} ${row.title}` : row.title}
              detail={`${count} message${count === 1 ? "" : "s"}`}
              selected={selected}
              onClick={() => onSelectThread(row.threadKey)}
              testId="workboard-off-board-thread"
            />
          );
        })}
      </div>
    </div>
  );
}

function projectedThreadTabTitleColor(tab: LeaderThreadTabsProjectionTab): string | undefined {
  if (tab.completed) return DONE_THREAD_TITLE_COLOR;
  if (tab.queued) return QUEUED_THREAD_TITLE_COLOR;
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  const fallbackPhase = phase ?? getQuestJourneyPhaseForState(tab.boardStatus ?? undefined);
  return fallbackPhase ? getQuestPhaseThreadTabTitleColorValue(fallbackPhase.color) : undefined;
}

function projectedThreadTabDetail(tab: LeaderThreadTabsProjectionTab): string | undefined {
  if (tab.attention.needsInput) return "Needs input";
  if (tab.completed) return "Done";
  if (tab.queued) return "Queued";
  const phase = tab.journey?.currentPhaseId ? getQuestJourneyPhase(tab.journey.currentPhaseId) : null;
  return (
    phase?.label ?? getQuestJourneyPresentation(tab.boardStatus ?? undefined)?.label ?? tab.boardStatus ?? undefined
  );
}

function buildProjectedThreadTabs(
  projection: LeaderThreadTabsProjectionValue,
  questTitleById: ReadonlyMap<string, string>,
): PrimaryThreadChip[] {
  return projection.tabs.map((tab) => {
    const questId = tab.questId ?? tab.threadKey;
    return {
      threadKey: tab.threadKey,
      questId,
      title: questTitleById.get(normalizeThreadKey(questId)) ?? tab.title ?? questId,
      detail: projectedThreadTabDetail(tab),
      needsInput: tab.attention.needsInput,
      mutedNeedsInput: tab.attention.mutedNeedsInput,
      blueNudge: tab.attention.reviewUnread,
      titleColor: projectedThreadTabTitleColor(tab),
      projectedCurrentState: true,
      canClose: tab.canClose,
      updatedAt: tab.updatedAt,
    };
  });
}

function buildMigrationThreadTabs({
  projection,
  openThreadKeys,
  projectedTabs,
  questTitleById,
  threadRows,
}: {
  projection: LeaderThreadTabsProjectionValue;
  openThreadKeys: ReadonlyArray<string>;
  projectedTabs: ReadonlyArray<PrimaryThreadChip>;
  questTitleById: ReadonlyMap<string, string>;
  threadRows: ReadonlyArray<WorkBoardThreadNavigationRow>;
}): PrimaryThreadChip[] {
  const migrationKeys = buildLeaderThreadMigrationKeys(openThreadKeys, projection);
  const projectedByKey = new Map(projectedTabs.map((tab) => [normalizeThreadKey(tab.threadKey), tab]));
  const rowsByKey = new Map(threadRows.map((row) => [normalizeThreadKey(row.threadKey), row]));
  return migrationKeys.map((threadKey) => {
    const projected = projectedByKey.get(threadKey);
    if (projected) return projected;
    const row = rowsByKey.get(threadKey);
    const questId = row?.questId ?? threadKey;
    return {
      threadKey,
      questId,
      title: questTitleById.get(normalizeThreadKey(questId)) ?? row?.title ?? questId,
      detail: row ? `${row.messageCount ?? 0} message${row.messageCount === 1 ? "" : "s"}` : "History",
      messageCount: row?.messageCount,
      needsInput: false,
      mutedNeedsInput: false,
      blueNudge: false,
      projectedCurrentState: true,
      canClose: true,
      updatedAt: 0,
    };
  });
}

function boardThreadKeySignature(state: ReturnType<typeof useStore.getState>, sessionId: string): string {
  const keys = new Set<string>();
  for (const row of state.sessionBoards.get(sessionId) ?? EMPTY_BOARD_ROWS) keys.add(normalizeThreadKey(row.questId));
  for (const row of state.sessionCompletedBoards.get(sessionId) ?? EMPTY_BOARD_ROWS) {
    keys.add(normalizeThreadKey(row.questId));
  }
  return [...keys].sort().join("\u0000");
}

function canonicalTitlesForKeys(
  state: ReturnType<typeof useStore.getState>,
  questIds: ReadonlyArray<string>,
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const questId of questIds) {
    const normalizedQuestId = normalizeThreadKey(questId);
    const title = selectCanonicalQuestTitle({
      questId: normalizedQuestId,
      listQuest: state.quests.find((quest) => normalizeThreadKey(quest.questId) === normalizedQuestId),
      detailQuest: state.questDetails?.get(normalizedQuestId),
      titlePreview: state.questTitlePreviews?.get(normalizedQuestId),
      titlePreviewKnown: state.questTitlePreviews?.has(normalizedQuestId) === true,
    });
    if (title) titles[normalizedQuestId] = title;
  }
  return titles;
}

function DetailedWorkBoardPanel({
  view,
  sessionId,
  currentThreadKey,
  onSelectThread,
  threadRows,
  boardThreadKeys,
}: {
  view: LeaderWorkboardView;
  sessionId: string;
  currentThreadKey: string;
  onSelectThread?: (threadKey: string) => void;
  threadRows: ReadonlyArray<WorkBoardThreadNavigationRow>;
  boardThreadKeys: ReadonlySet<string>;
}) {
  const activeBoardRows = useStore((state) =>
    view === "active" ? (state.sessionBoards.get(sessionId) ?? EMPTY_BOARD_ROWS) : EMPTY_BOARD_ROWS,
  );
  const completedBoardRows = useStore((state) =>
    view === "completed" ? (state.sessionCompletedBoards.get(sessionId) ?? EMPTY_BOARD_ROWS) : EMPTY_BOARD_ROWS,
  );
  const rowSessionStatuses = useStore((state) =>
    view === "active" || view === "completed"
      ? (state.sessionBoardRowStatuses.get(sessionId) ?? EMPTY_ROW_STATUSES)
      : EMPTY_ROW_STATUSES,
  );
  const offBoardThreads = useMemo(
    () =>
      view === "other"
        ? threadRows
            .filter((row) => !boardThreadKeys.has(normalizeThreadKey(row.threadKey)))
            .sort((left, right) => left.threadKey.localeCompare(right.threadKey))
        : [],
    [boardThreadKeys, threadRows, view],
  );

  return (
    <div
      className="max-h-[55dvh] overflow-y-auto border-b border-cc-border bg-cc-card"
      data-testid="workboard-panel"
      data-view={view}
    >
      {view === "active" && activeBoardRows.length > 0 && (
        <BoardTable
          board={activeBoardRows}
          rowSessionStatuses={rowSessionStatuses}
          selectedThreadKey={currentThreadKey}
          onSelectQuestThread={onSelectThread}
        />
      )}
      {view === "active" && activeBoardRows.length === 0 && (
        <div className="px-3 py-3 text-xs text-cc-muted italic">No active items</div>
      )}
      {view === "completed" && completedBoardRows.length > 0 && (
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
      {view === "completed" && completedBoardRows.length === 0 && (
        <div className="px-3 py-3 text-xs text-cc-muted italic">No completed quests</div>
      )}
      {view === "other" && onSelectThread && (
        <OtherThreadSection
          rows={offBoardThreads}
          currentThreadKey={currentThreadKey}
          onSelectThread={onSelectThread}
        />
      )}
    </div>
  );
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

export function resolveWorkBoardIsOrchestrator(
  source: LeaderThreadTabsProjectionSource & SessionNavigationResolverSource,
  sessionId: string,
): boolean {
  return (
    resolveLeaderThreadTabsProjection(source, sessionId).projectionState === "accepted" ||
    resolveSessionNavigation(source, sessionId)?.viewModel.isOrchestrator === true
  );
}

function WorkBoardBarComponent({
  sessionId,
  currentThreadKey = MAIN_THREAD_KEY,
  onSelectThread,
  openThreadKeys = [],
  onCloseThreadTab,
  onReorderThreadTabs,
  threadRows = [],
}: {
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  openThreadKeys?: string[];
  onCloseThreadTab?: (threadKey: string, nextThreadKey: string) => void;
  onReorderThreadTabs?: (orderedThreadKeys: string[]) => void;
  threadRows?: WorkBoardThreadNavigationRow[];
}) {
  const isOrchestrator = useStore((state) => resolveWorkBoardIsOrchestrator(state, sessionId));
  const leaderTabsResolution = useStore(useShallow((state) => resolveLeaderThreadTabsProjection(state, sessionId)));
  const projection = leaderTabsResolution.projectionState === "accepted" ? leaderTabsResolution.value : null;
  const activeView = useStore((state) => state.leaderWorkboardViews?.get(sessionId) ?? null);
  const setLeaderWorkboardView = useStore((state) => state.setLeaderWorkboardView ?? (() => {}));
  const activeCount = useStore((state) => state.sessionBoards.get(sessionId)?.length ?? 0);
  const completedCount = useStore((state) => state.sessionCompletedBoards.get(sessionId)?.length ?? 0);
  const boardKeysSignature = useStore((state) => boardThreadKeySignature(state, sessionId));
  const boardThreadKeys = useMemo(
    () => new Set(boardKeysSignature ? boardKeysSignature.split("\u0000") : []),
    [boardKeysSignature],
  );
  const otherThreadCount = useMemo(
    () => threadRows.filter((row) => !boardThreadKeys.has(normalizeThreadKey(row.threadKey))).length,
    [boardThreadKeys, threadRows],
  );
  const requestedQuestIds = useMemo(() => {
    const ids = new Set<string>();
    for (const tab of projection?.tabs ?? []) ids.add(normalizeThreadKey(tab.questId ?? tab.threadKey));
    if (projection?.tabState === null) {
      for (const threadKey of openThreadKeys) ids.add(normalizeThreadKey(threadKey));
    }
    return [...ids];
  }, [openThreadKeys, projection]);
  const canonicalTitles = useStore(useShallow((state) => canonicalTitlesForKeys(state, requestedQuestIds)));
  const questTitleById = useMemo(() => new Map(Object.entries(canonicalTitles)), [canonicalTitles]);

  useEffect(() => {
    if (!activeView) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLeaderWorkboardView(sessionId, null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeView, sessionId, setLeaderWorkboardView]);

  const projectedTabs = useMemo(
    () => (projection ? buildProjectedThreadTabs(projection, questTitleById) : []),
    [projection, questTitleById],
  );
  const displayedThreadTabs = useMemo(() => {
    if (!projection || projection.tabState) return projectedTabs;
    return buildMigrationThreadTabs({
      projection,
      openThreadKeys,
      projectedTabs,
      questTitleById,
      threadRows,
    });
  }, [openThreadKeys, projectedTabs, projection, questTitleById, threadRows]);
  const reorderableThreadKeys = useMemo(
    () => displayedThreadTabs.map((tab) => normalizeThreadKey(tab.threadKey)),
    [displayedThreadTabs],
  );
  const previousOpenThreadTabKeysRef = useRef<string[] | null>(null);
  const newThreadTabTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [newThreadTabKeys, setNewThreadTabKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    const currentKeys = displayedThreadTabs.map((tab) => tab.threadKey);
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
  }, [displayedThreadTabs]);
  useEffect(
    () => () => {
      for (const timeout of newThreadTabTimeoutsRef.current.values()) clearTimeout(timeout);
      newThreadTabTimeoutsRef.current.clear();
    },
    [],
  );

  const mainThreadState = useMemo(() => {
    const attention = projection?.mainAttention;
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
  }, [projection]);
  const threadStatuses = projection?.threadStatuses ?? {};
  const activeSummarySegments = useMemo(
    () => boardSummarySegmentsFromActivePhaseSummary(projection?.activePhaseSummary ?? []),
    [projection],
  );
  const showMainBanner =
    isSelectedThread(currentThreadKey, MAIN_THREAD_KEY) || isSelectedThread(currentThreadKey, ALL_THREADS_KEY);
  const panelView =
    activeView === "active" && activeCount === 0
      ? null
      : activeView === "completed" && completedCount === 0
        ? null
        : activeView === "other" && otherThreadCount === 0
          ? null
          : activeView;

  const handleCloseThreadTab = (threadKey: string) => {
    const normalized = normalizeThreadKey(threadKey);
    const nextThreadKey = threadKeyToSelectAfterClosing(normalized, displayedThreadTabs);
    onCloseThreadTab?.(normalized, nextThreadKey);
  };
  const handleSelectView = (view: LeaderWorkboardView) => {
    setLeaderWorkboardView(sessionId, activeView === view ? null : view);
  };

  if (!isOrchestrator) return null;

  return (
    <div className="shrink-0 flex flex-col min-h-0">
      <ThreadTabRail
        mainState={mainThreadState}
        tabs={displayedThreadTabs}
        reorderableThreadKeys={reorderableThreadKeys}
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
          {otherThreadCount > 0 && (
            <LeaderWorkboardControlButton
              view="other"
              activeView={panelView}
              onSelectView={handleSelectView}
              testId="workboard-other-button"
              ariaLabel="Open other threads"
            >
              <span className="tabular-nums">{otherThreadCount}</span>
              <span>Other</span>
            </LeaderWorkboardControlButton>
          )}
          {activeSummarySegments.length === 0 && completedCount === 0 && otherThreadCount === 0 && (
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
        <DetailedWorkBoardPanel
          view={panelView}
          sessionId={sessionId}
          currentThreadKey={currentThreadKey}
          onSelectThread={onSelectThread}
          threadRows={threadRows}
          boardThreadKeys={boardThreadKeys}
        />
      )}
    </div>
  );
}

export const WorkBoardBar = memo(WorkBoardBarComponent);
