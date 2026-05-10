/**
 * Persistent work board widget for orchestrator sessions.
 *
 * Positioned above the message feed in ChatView. The tab rail stays visually
 * anchored for leader navigation, while the Work Board summary/table behaves
 * like a compact Main-thread banner below the tabs. Once opened, it stays open
 * until the user explicitly collapses it.
 */
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMemo, useState, useEffect, useLayoutEffect, useRef } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS, type Transform } from "@dnd-kit/utilities";
import { useStore } from "../store.js";
import {
  getQuestJourneyCurrentPhaseId,
  getQuestJourneyPhase,
  getQuestJourneyPhaseForState,
  getQuestJourneyPresentation,
} from "../../shared/quest-journey.js";
import type { ActiveTurnRoute } from "../types.js";
import { BoardTable, orderBoardRows } from "./BoardTable.js";
import type { BoardRowData } from "./BoardTable.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { isAttentionRecordActive, type AttentionRecord } from "../utils/attention-records.js";
import type { QuestmasterTask } from "../types.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { activeBoardSummarySegments, boardSummary, type BoardSummarySegment } from "./leader-board-summary.js";
import { LeaderWorkboardControlButton, SummarySegments } from "./leader-workboard-controls.js";
import type { LeaderWorkboardView } from "../store-types.js";

export interface WorkBoardThreadNavigationRow {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  messageCount?: number;
  section?: "active" | "done";
}

const DONE_THREAD_TITLE_COLOR = "var(--color-cc-muted)";
const QUEUED_THREAD_TITLE_COLOR = "var(--color-cc-fg)";

export { activeBoardSummarySegments, boardSummary };
export type { BoardSummarySegment };

export function reorderThreadTabsAfterDrag(
  threadKeys: ReadonlyArray<string>,
  activeThreadKey: unknown,
  overThreadKey: unknown,
): string[] {
  const keys = threadKeys.map((key) => normalizeThreadKey(key));
  const activeKey = normalizeThreadKey(String(activeThreadKey ?? ""));
  const overKey = normalizeThreadKey(String(overThreadKey ?? ""));
  if (!activeKey || !overKey || activeKey === overKey) return keys;
  const oldIndex = keys.indexOf(activeKey);
  const newIndex = keys.indexOf(overKey);
  if (oldIndex < 0 || newIndex < 0) return keys;
  return arrayMove(keys, oldIndex, newIndex);
}

export function constrainThreadTabTransformToHorizontal(transform: Transform | null): Transform | null {
  if (!transform || transform.y === 0) return transform;
  return { ...transform, y: 0 };
}

const COMPACT_MOBILE_THREAD_TAB_WIDTH = 76;
const COMPACT_DESKTOP_THREAD_TAB_WIDTH = 160;
const COMPACT_DESKTOP_PACKING_MIN_RAIL_WIDTH = 640;
const COMPACT_MORE_TABS_WIDTH = 72;
const COMPACT_TAB_GAP = 4;
const FLUID_THREAD_TAB_SIZE_CLASS = "min-w-[var(--thread-tab-width)] max-w-[14rem] flex-[1_1_var(--thread-tab-width)]";
const FROZEN_THREAD_TAB_SIZE_CLASS =
  "min-w-[var(--thread-tab-frozen-width)] w-[var(--thread-tab-frozen-width)] max-w-[var(--thread-tab-frozen-width)] flex-none";

export interface CompactThreadTabPartition<T> {
  visibleTabs: T[];
  hiddenTabs: T[];
  visibleThreadKeys: string[];
  hiddenThreadKeys: string[];
}

export function buildCompactThreadTabPartition<T extends { threadKey: string }>({
  tabs,
  currentThreadKey,
  railWidth,
}: {
  tabs: ReadonlyArray<T>;
  currentThreadKey: string;
  railWidth: number | null;
}): CompactThreadTabPartition<T> {
  const visibleCapacity = estimateCompactVisibleTabCapacity(tabs.length, railWidth);
  if (visibleCapacity >= tabs.length) {
    return {
      visibleTabs: [...tabs],
      hiddenTabs: [],
      visibleThreadKeys: tabs.map((tab) => normalizeThreadKey(tab.threadKey)),
      hiddenThreadKeys: [],
    };
  }

  const selectedThreadKey = normalizeThreadKey(currentThreadKey);
  const visibleKeys = new Set<string>();
  if (
    selectedThreadKey !== MAIN_THREAD_KEY &&
    tabs.some((tab) => normalizeThreadKey(tab.threadKey) === selectedThreadKey)
  ) {
    visibleKeys.add(selectedThreadKey);
  }

  for (const tab of tabs) {
    if (visibleKeys.size >= visibleCapacity) break;
    visibleKeys.add(normalizeThreadKey(tab.threadKey));
  }

  const visibleTabs: T[] = [];
  const hiddenTabs: T[] = [];
  for (const tab of tabs) {
    const threadKey = normalizeThreadKey(tab.threadKey);
    if (visibleKeys.has(threadKey)) visibleTabs.push(tab);
    else hiddenTabs.push(tab);
  }

  return {
    visibleTabs,
    hiddenTabs,
    visibleThreadKeys: visibleTabs.map((tab) => normalizeThreadKey(tab.threadKey)),
    hiddenThreadKeys: hiddenTabs.map((tab) => normalizeThreadKey(tab.threadKey)),
  };
}

function estimateCompactVisibleTabCapacity(tabCount: number, railWidth: number | null): number {
  if (tabCount <= 0) return 0;
  if (!railWidth || railWidth <= 0) return tabCount;

  const fitsWithoutOverflow = estimatedCompactRailWidth(tabCount, false, railWidth) <= railWidth;
  if (fitsWithoutOverflow) return tabCount;

  for (let count = tabCount - 1; count > 0; count--) {
    if (estimatedCompactRailWidth(count, true, railWidth) <= railWidth) return count;
  }
  return 1;
}

function estimatedCompactRailWidth(
  visibleTabCount: number,
  includesMoreTabs: boolean,
  railWidth: number | null,
): number {
  const extraItemCount = visibleTabCount + (includesMoreTabs ? 1 : 0);
  const threadTabWidth = compactThreadTabWidthForRail(railWidth);
  return (
    threadTabWidth +
    visibleTabCount * threadTabWidth +
    (includesMoreTabs ? COMPACT_MORE_TABS_WIDTH : 0) +
    extraItemCount * COMPACT_TAB_GAP
  );
}

function compactThreadTabWidthForRail(railWidth?: number | null): number {
  if (!railWidth || railWidth < COMPACT_DESKTOP_PACKING_MIN_RAIL_WIDTH) return COMPACT_MOBILE_THREAD_TAB_WIDTH;
  return COMPACT_DESKTOP_THREAD_TAB_WIDTH;
}

function stringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeThreadKey(threadKey: string): string {
  return threadKey.trim().toLowerCase();
}

function isSelectedThread(currentThreadKey: string, targetThreadKey: string): boolean {
  return normalizeThreadKey(currentThreadKey) === normalizeThreadKey(targetThreadKey);
}

function isActiveOutputThread(activeTurnRoute: ActiveTurnRoute | null | undefined, targetThreadKey: string): boolean {
  if (!activeTurnRoute?.threadKey) return false;
  return normalizeThreadKey(activeTurnRoute.threadKey) === normalizeThreadKey(targetThreadKey);
}

function ThreadNavButton({
  label,
  detail,
  selected,
  onClick,
  testId,
  variant = "card",
  secondary = false,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
  variant?: "card" | "compact";
  secondary?: boolean;
}) {
  const tone = selected
    ? "border-cc-primary/45 bg-cc-primary/12 text-cc-fg"
    : secondary
      ? "border-cc-border/45 bg-transparent text-cc-muted hover:bg-cc-hover/45 hover:text-cc-fg"
      : "border-cc-border/70 bg-cc-hover/35 text-cc-muted hover:bg-cc-hover/65 hover:text-cc-fg";
  const layout =
    variant === "compact"
      ? "inline-flex min-w-0 items-center gap-1.5 rounded-md border px-2 py-1"
      : "flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`${layout} text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${tone}`}
      data-testid={testId}
      data-variant={variant}
      data-secondary={secondary ? "true" : "false"}
      aria-pressed={selected}
    >
      {variant === "compact" ? (
        <>
          <span className="min-w-0 truncate text-[11px] font-medium">{label}</span>
          {detail && <span className="hidden shrink-0 text-[10px] text-cc-muted/75 sm:inline">{detail}</span>}
        </>
      ) : (
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-medium">{label}</span>
          {detail && <span className="block truncate text-[10px] text-cc-muted/80">{detail}</span>}
        </span>
      )}
    </button>
  );
}

interface PrimaryThreadChip {
  threadKey: string;
  questId?: string;
  title: string;
  detail?: string;
  messageCount?: number;
  needsInput: boolean;
  blueNudge: boolean;
  titleColor?: string;
  canClose: boolean;
  route?: AttentionRecord["route"];
  updatedAt: number;
}

function SortableThreadTabContainer({
  tab,
  className,
  title,
  minLabel,
  activeOutput,
  newTab,
  hoverQuest,
  onMouseEnter,
  onMouseLeave,
  children,
}: {
  tab: PrimaryThreadChip;
  className: string;
  title?: string;
  minLabel?: string;
  activeOutput: boolean;
  newTab: boolean;
  hoverQuest?: QuestmasterTask;
  onMouseEnter?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseLeave?: () => void;
  children: (dragSurfaceProps: {
    attributes: DraggableAttributes;
    listeners: ReturnType<typeof useSortable>["listeners"];
    isDragging: boolean;
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.threadKey });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(constrainThreadTabTransformToHorizontal(transform)),
    transition,
    ...(isDragging ? { opacity: 0.78, zIndex: 30 } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      title={title}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={className}
      data-testid="thread-tab"
      data-thread-key={tab.threadKey}
      data-needs-input={tab.needsInput ? "true" : "false"}
      data-blue-notification={tab.blueNudge ? "true" : "false"}
      data-active-output={activeOutput ? "true" : "false"}
      data-new-tab={newTab ? "true" : "false"}
      data-min-label={minLabel ?? tab.questId ?? tab.threadKey}
      data-closable={tab.canClose ? "true" : "false"}
      data-has-quest-hover={hoverQuest ? "true" : "false"}
      data-reorderable="true"
      data-dragging={isDragging ? "true" : "false"}
    >
      {children({ attributes, listeners, isDragging })}
    </div>
  );
}

function threadKeyToSelectAfterClosing(threadKey: string, tabs: ReadonlyArray<PrimaryThreadChip>): string {
  const normalized = normalizeThreadKey(threadKey);
  const closingIndex = tabs.findIndex((tab) => normalizeThreadKey(tab.threadKey) === normalized);
  if (closingIndex < 0) return MAIN_THREAD_KEY;

  const rightTab = tabs.slice(closingIndex + 1).find((tab) => normalizeThreadKey(tab.threadKey) !== normalized);
  return rightTab ? normalizeThreadKey(rightTab.threadKey) : MAIN_THREAD_KEY;
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
  return isPrimaryThreadAttention(record) || isBlueNotificationAttention(record);
}

function isNeedsInputAttention(record: AttentionRecord): boolean {
  return isAttentionRecordActive(record) && record.priority === "needs_input" && record.type === "needs_input";
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

function completedQuestTitleColor(quest?: QuestmasterTask): string | undefined {
  return quest && isCompletedJourneyPresentationStatus(quest.status) ? DONE_THREAD_TITLE_COLOR : undefined;
}

function boardRowTitleColor(row: BoardRowData): string | undefined {
  if (isCompletedBoardRow(row)) return DONE_THREAD_TITLE_COLOR;
  if ((row.status ?? "").trim().toUpperCase() === "QUEUED") return QUEUED_THREAD_TITLE_COLOR;
  const currentPhase = getQuestJourneyPhase(getQuestJourneyCurrentPhaseId(row.journey, row.status));
  const phase = currentPhase ?? getQuestJourneyPhaseForState(row.status);
  return phase?.color.accent;
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
      needsInput: (row.waitForInput?.length ?? 0) > 0 || attention.some(isNeedsInputAttention),
      blueNudge: attention.some(isBlueNotificationAttention),
      titleColor: boardRowTitleColor(row),
      canClose: false,
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
}: {
  openThreadKeys: ReadonlyArray<string>;
  threadRows: WorkBoardThreadNavigationRow[];
  activeThreadChips: PrimaryThreadChip[];
  activeBoardRows: BoardRowData[];
  completedBoardRows: BoardRowData[];
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
    if (!active && !row && !boardRow) continue;
    const completedTitleColor = doneThreadTitleColor({
      boardRow,
      row,
      completed: !activeBoardRow && !!completedBoardRow,
    });

    tabs.push({
      threadKey,
      questId: active?.questId ?? row?.questId ?? boardRow?.questId,
      title: active?.title ?? row?.title ?? boardRow?.title ?? threadKey,
      detail: active?.detail ?? (boardRow ? boardRowDetail(boardRow) : doneThreadDetail(row)),
      messageCount: active?.messageCount ?? row?.messageCount,
      needsInput: active?.needsInput ?? (boardRow?.waitForInput?.length ?? 0) > 0,
      blueNudge: active?.blueNudge ?? false,
      titleColor: completedTitleColor ?? active?.titleColor ?? (boardRow ? boardRowTitleColor(boardRow) : undefined),
      canClose: !activeBoardRow,
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

function ActiveOutputIndicator() {
  return (
    <span
      className="pointer-events-none absolute inset-0"
      aria-hidden="true"
      data-testid="thread-tab-active-output-indicator"
      data-reduced-motion-static="true"
      data-dot-position="stripe-origin"
      data-stripe-origin="top-left"
    >
      <span
        className="absolute inset-x-1 top-0 h-px overflow-hidden rounded-full bg-violet-100/30"
        data-testid="thread-tab-active-output-glint-track"
      >
        <span
          className="thread-tab-output-glint absolute inset-y-0 left-0 w-1/2 rounded-full bg-gradient-to-r from-transparent via-white to-sky-200 shadow-[0_0_8px_rgba(224,242,254,0.66)]"
          data-testid="thread-tab-active-output-glint"
          data-reduced-motion="animation-disabled"
        />
      </span>
      <span
        className="absolute left-1 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sky-50/95 shadow-[0_0_9px_rgba(224,242,254,0.78)] ring-1 ring-violet-100/75"
        data-testid="thread-tab-active-output-dot"
      />
    </span>
  );
}

function ThreadTabRail({
  mainState,
  tabs,
  reorderableThreadKeys,
  sessionId,
  currentThreadKey,
  onSelectThread,
  onCloseThreadTab,
  onReorderThreadTabs,
  newTabKeys,
}: {
  mainState?: PrimaryThreadChip;
  tabs: PrimaryThreadChip[];
  reorderableThreadKeys: string[];
  sessionId: string;
  currentThreadKey: string;
  onSelectThread?: (threadKey: string) => void;
  onCloseThreadTab?: (threadKey: string) => void;
  onReorderThreadTabs?: (orderedThreadKeys: string[]) => void;
  newTabKeys?: ReadonlySet<string>;
}) {
  function NeedsInputBell({ activeOutput }: { activeOutput: boolean }) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative z-10 h-3 w-3 shrink-0 text-amber-400"
        aria-hidden="true"
        data-testid="thread-tab-needs-input-bell"
        data-active-output={activeOutput ? "true" : "false"}
      >
        <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v1.8c0 .7-.24 1.38-.68 1.92L3 10.75h10l-.82-1.03a3.05 3.05 0 0 1-.68-1.92V6A3.5 3.5 0 0 0 8 2.5Z" />
        <path d="M6.75 12.5a1.35 1.35 0 0 0 2.5 0" />
      </svg>
    );
  }

  function BlueNotificationBell({ activeOutput }: { activeOutput: boolean }) {
    return (
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="relative z-10 h-3 w-3 shrink-0 text-blue-400"
        aria-hidden="true"
        data-testid="thread-tab-blue-notification-bell"
        data-active-output={activeOutput ? "true" : "false"}
      >
        <path d="M8 2.5a3.5 3.5 0 0 0-3.5 3.5v1.8c0 .7-.24 1.38-.68 1.92L3 10.75h10l-.82-1.03a3.05 3.05 0 0 1-.68-1.92V6A3.5 3.5 0 0 0 8 2.5Z" />
        <path d="M6.75 12.5a1.35 1.35 0 0 0 2.5 0" />
      </svg>
    );
  }

  function ActiveTitle({
    activeOutput,
    titleColor,
    children,
  }: {
    activeOutput: boolean;
    titleColor?: string;
    children: ReactNode;
  }) {
    const style: CSSProperties | undefined = titleColor
      ? {
          color: titleColor,
        }
      : undefined;
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5 px-1"
        style={style}
        data-testid="thread-tab-title"
        data-active-output={activeOutput ? "true" : "false"}
        data-title-color={titleColor ?? ""}
      >
        {children}
      </span>
    );
  }

  function tabTone({ selected }: { selected: boolean; needsInput: boolean; blueNudge: boolean }): string {
    if (selected) {
      return "relative z-10 -mb-px rounded-b-none border-violet-100/45 border-b-transparent bg-white/[0.055] text-white shadow-[0_-1px_0_rgba(221,214,254,0.78),0_0_0_1px_rgba(196,181,253,0.16),0_10px_20px_-16px_rgba(196,181,253,0.78),inset_0_1px_0_rgba(255,255,255,0.14)]";
    }
    return "border-cc-border/70 bg-cc-hover/30 text-cc-muted hover:bg-cc-hover/60 hover:text-cc-fg";
  }

  const openThread = (threadKey: string) => {
    const targetThread = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
    const selectedThread = normalizeThreadKey(currentThreadKey || "main");

    if (onSelectThread && (selectedThread === ALL_THREADS_KEY || selectedThread !== targetThread)) {
      onSelectThread(targetThread);
      return;
    }
  };

  const mainSelected = isSelectedThread(currentThreadKey, MAIN_THREAD_KEY);
  const mainNeedsInput = mainState?.needsInput ?? false;
  const mainBlueNudge = mainState?.blueNudge ?? false;
  const showMainBlueNudge = mainBlueNudge && !mainNeedsInput;
  const sessionStatus = useStore((s) => s.sessionStatus.get(sessionId));
  const activeTurnRoute = useStore((s) => s.activeTurnRoutes.get(sessionId));
  const quests = useStore((s) => s.quests);
  const questById = useMemo(() => new Map(quests.map((quest) => [normalizeThreadKey(quest.questId), quest])), [quests]);
  const [hoveredQuest, setHoveredQuest] = useState<{ quest: QuestmasterTask; anchorRect: DOMRect } | null>(null);
  const hideQuestHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const [railWidth, setRailWidth] = useState<number | null>(null);
  const [frozenThreadTabWidth, setFrozenThreadTabWidth] = useState<number | null>(null);
  const [moreTabsOpen, setMoreTabsOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [draftReorderKeys, setDraftReorderKeys] = useState<string[]>([]);
  const runningActiveTurnRoute = sessionStatus === "running" ? activeTurnRoute : null;
  const mainActiveOutput = isActiveOutputThread(runningActiveTurnRoute, MAIN_THREAD_KEY);
  const mainTone = tabTone({ selected: mainSelected, needsInput: mainNeedsInput, blueNudge: mainBlueNudge });
  const compactTabs = useMemo(
    () => buildCompactThreadTabPartition({ tabs, currentThreadKey, railWidth }),
    [currentThreadKey, railWidth, tabs],
  );
  const visibleTabs = compactTabs.visibleTabs;
  const hiddenTabs = compactTabs.hiddenTabs;
  const hasOverflowTabs = hiddenTabs.length > 0;
  const sortableTabKeys = useMemo(
    () =>
      visibleTabs.map((tab) => normalizeThreadKey(tab.threadKey)).filter((key) => reorderableThreadKeys.includes(key)),
    [reorderableThreadKeys, visibleTabs],
  );
  const allReorderableTabKeys = useMemo(
    () => tabs.map((tab) => normalizeThreadKey(tab.threadKey)).filter((key) => reorderableThreadKeys.includes(key)),
    [reorderableThreadKeys, tabs],
  );
  const moreTabsReorderKeys = useMemo(
    () =>
      hiddenTabs.map((tab) => normalizeThreadKey(tab.threadKey)).filter((key) => reorderableThreadKeys.includes(key)),
    [hiddenTabs, reorderableThreadKeys],
  );
  const sortableTabKeySet = useMemo(() => new Set(sortableTabKeys), [sortableTabKeys]);
  const moreTabsReorderKeySet = useMemo(() => new Set(moreTabsReorderKeys), [moreTabsReorderKeys]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  function handleThreadTabDragEnd(event: DragEndEvent) {
    if (!onReorderThreadTabs || !event.over) return;
    const orderedThreadKeys = reorderThreadTabsAfterDrag(sortableTabKeys, event.active.id, event.over.id);
    if (stringArraysEqual(sortableTabKeys, orderedThreadKeys)) return;
    onReorderThreadTabs(orderedThreadKeys);
  }
  useEffect(
    () => () => {
      if (hideQuestHoverTimerRef.current) clearTimeout(hideQuestHoverTimerRef.current);
    },
    [],
  );

  function showQuestHover(quest: QuestmasterTask | undefined, anchorRect: DOMRect) {
    if (!quest) return;
    if (hideQuestHoverTimerRef.current) clearTimeout(hideQuestHoverTimerRef.current);
    setHoveredQuest({ quest, anchorRect });
  }

  function scheduleQuestHoverHide() {
    if (hideQuestHoverTimerRef.current) clearTimeout(hideQuestHoverTimerRef.current);
    hideQuestHoverTimerRef.current = setTimeout(() => setHoveredQuest(null), 100);
  }

  useLayoutEffect(() => {
    const element = tabStripRef.current;
    if (!element) return;

    const measure = () => {
      const width = Math.floor(element.getBoundingClientRect().width);
      setRailWidth((existing) => (existing === width ? existing : width));
    };
    measure();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (hasOverflowTabs) return;
    if (moreTabsOpen) {
      setMoreTabsOpen(false);
      releaseFrozenCloseTargetGeometry();
    }
    setReorderMode(false);
  }, [hasOverflowTabs, moreTabsOpen]);

  useEffect(() => {
    if (!moreTabsOpen) return;
    setReorderMode(false);
    setDraftReorderKeys(moreTabsReorderKeys);
  }, [moreTabsOpen, moreTabsReorderKeys]);

  useEffect(() => {
    if (!moreTabsOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMoreTabs();
      setReorderMode(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [moreTabsOpen]);

  function moveDraftReorderKey(threadKey: string, direction: -1 | 1) {
    setDraftReorderKeys((keys) => {
      const index = keys.indexOf(threadKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= keys.length) return keys;
      return arrayMove(keys, index, nextIndex);
    });
  }

  function commitMoreTabsReorder() {
    if (!stringArraysEqual(moreTabsReorderKeys, draftReorderKeys)) {
      onReorderThreadTabs?.(mergeHiddenReorderIntoOpenOrder());
    }
    setReorderMode(false);
    closeMoreTabs();
  }

  function cancelMoreTabsReorder() {
    setDraftReorderKeys(moreTabsReorderKeys);
    setReorderMode(false);
  }

  function freezeCloseTargetGeometry(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    const widthSource = tabStripRef.current?.querySelector<HTMLElement>("[data-thread-tab-width-source='true']");
    if (!widthSource) return;

    const width = Math.floor(widthSource.getBoundingClientRect().width);
    if (width <= 0) return;
    setFrozenThreadTabWidth((existing) => (existing === width ? existing : width));
  }

  function releaseFrozenCloseTargetGeometry() {
    setFrozenThreadTabWidth(null);
  }

  function releaseCloseTargetGeometry(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    releaseFrozenCloseTargetGeometry();
  }

  function closeMoreTabs() {
    setMoreTabsOpen(false);
    releaseFrozenCloseTargetGeometry();
  }

  function moreTabsListOrder(): PrimaryThreadChip[] {
    if (!reorderMode) return hiddenTabs;
    const tabByKey = new Map(hiddenTabs.map((tab) => [normalizeThreadKey(tab.threadKey), tab]));
    const ordered = draftReorderKeys.map((key) => tabByKey.get(key)).filter((tab): tab is PrimaryThreadChip => !!tab);
    const nonReorderable = hiddenTabs.filter((tab) => !moreTabsReorderKeySet.has(normalizeThreadKey(tab.threadKey)));
    return [...ordered, ...nonReorderable];
  }

  function mergeHiddenReorderIntoOpenOrder(): string[] {
    const hiddenDraftKeys = [...draftReorderKeys];
    const hiddenDraftKeySet = new Set(hiddenDraftKeys);
    return allReorderableTabKeys.map((key) => (hiddenDraftKeySet.has(key) ? (hiddenDraftKeys.shift() ?? key) : key));
  }

  const hiddenKeySet = new Set(compactTabs.hiddenThreadKeys);
  const selectedHidden = hiddenTabs.some((tab) => isSelectedThread(currentThreadKey, tab.threadKey));
  const activeOutputHidden = hiddenTabs.some((tab) => isActiveOutputThread(runningActiveTurnRoute, tab.threadKey));
  const needsInputHidden = hiddenTabs.some((tab) => tab.needsInput);
  const blueNudgeHidden = hiddenTabs.some((tab) => tab.blueNudge);
  const showBlueNudgeHidden = blueNudgeHidden && !needsInputHidden;
  const threadTabSizeClass = frozenThreadTabWidth ? FROZEN_THREAD_TAB_SIZE_CLASS : FLUID_THREAD_TAB_SIZE_CLASS;
  const tabStripStyle = {
    "--thread-tab-width": `${compactThreadTabWidthForRail(railWidth)}px`,
    ...(frozenThreadTabWidth ? { "--thread-tab-frozen-width": `${frozenThreadTabWidth}px` } : {}),
  } as CSSProperties;

  return (
    <div
      className="border-b border-cc-border bg-cc-card px-3 pb-0 pt-1.5 sm:px-4"
      data-testid="thread-tab-rail"
      data-open-tab-count={tabs.length + 1}
      data-closed-chip-count="0"
      data-unified-tab-track="true"
      data-overflow={hasOverflowTabs ? "more-tabs-list" : "none"}
      data-hidden-tab-count={hiddenTabs.length}
    >
      <div
        ref={tabStripRef}
        style={tabStripStyle}
        className="relative flex min-w-0 items-end gap-1 overflow-visible"
        data-testid="thread-tab-strip"
        data-overflow-mode="more-tabs"
        data-close-target-width-frozen={frozenThreadTabWidth ? "true" : "false"}
        data-frozen-thread-tab-width={frozenThreadTabWidth ?? ""}
        onPointerEnter={freezeCloseTargetGeometry}
        onPointerLeave={releaseCloseTargetGeometry}
        aria-label="Thread tabs"
      >
        <button
          type="button"
          onClick={() => openThread(MAIN_THREAD_KEY)}
          title={
            mainNeedsInput
              ? `${mainState?.title ?? "Main Thread"} needs input`
              : mainBlueNudge
                ? `${mainState?.title ?? "Main Thread"} has review updates`
                : (mainState?.title ?? "Main Thread")
          }
          className={`relative inline-flex ${threadTabSizeClass} items-center gap-1.5 overflow-hidden rounded-t-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-100/70 focus-visible:ring-inset ${mainTone}`}
          data-testid="thread-main-tab"
          data-thread-key={MAIN_THREAD_KEY}
          data-thread-tab-width-source="true"
          data-needs-input={mainNeedsInput ? "true" : "false"}
          data-blue-notification={mainBlueNudge ? "true" : "false"}
          data-active-output={mainActiveOutput ? "true" : "false"}
          data-min-label="Main Thread"
          aria-pressed={mainSelected}
        >
          {mainActiveOutput && <ActiveOutputIndicator />}
          {mainNeedsInput && <NeedsInputBell activeOutput={mainActiveOutput} />}
          {showMainBlueNudge && <BlueNotificationBell activeOutput={mainActiveOutput} />}
          <ActiveTitle activeOutput={mainActiveOutput}>
            <span className="min-w-0 truncate">Main Thread</span>
          </ActiveTitle>
          {mainState?.detail && <span className="shrink-0 text-[10px] text-cc-muted/80">{mainState.detail}</span>}
        </button>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleThreadTabDragEnd}>
          <SortableContext items={sortableTabKeys} strategy={horizontalListSortingStrategy}>
            {visibleTabs.map((tab) => {
              const selected = isSelectedThread(currentThreadKey, tab.threadKey);
              const activeOutput = isActiveOutputThread(runningActiveTurnRoute, tab.threadKey);
              const showBlueNudge = tab.blueNudge && !tab.needsInput;
              const tone = tabTone({ selected, needsInput: tab.needsInput, blueNudge: tab.blueNudge });
              const newTab = newTabKeys?.has(tab.threadKey) ?? false;
              const hoverQuest = tab.questId ? questById.get(normalizeThreadKey(tab.questId)) : undefined;
              const displayQuestId = hoverQuest?.questId ?? tab.questId;
              const displayTitle = hoverQuest?.title ?? tab.title;
              const displayTitleColor = completedQuestTitleColor(hoverQuest) ?? tab.titleColor;
              const reorderable = onReorderThreadTabs && sortableTabKeySet.has(normalizeThreadKey(tab.threadKey));
              const title = hoverQuest
                ? undefined
                : `${displayQuestId ? `${displayQuestId}: ${displayTitle}` : displayTitle}${tab.needsInput ? " needs input" : showBlueNudge ? " has review updates" : ""}`;
              const className = `group relative inline-flex ${threadTabSizeClass} items-stretch overflow-hidden rounded-t-md border text-[11px] font-medium transition-colors ${newTab ? "thread-tab-pop" : ""} ${reorderable ? "cursor-grab active:cursor-grabbing" : ""} ${tone}`;
              const mouseEnter = (event: ReactMouseEvent<HTMLDivElement>) =>
                showQuestHover(hoverQuest, event.currentTarget.getBoundingClientRect());
              const children = (dragSurfaceProps?: {
                attributes: DraggableAttributes;
                listeners: ReturnType<typeof useSortable>["listeners"];
                isDragging: boolean;
              }) => (
                <>
                  {activeOutput && <ActiveOutputIndicator />}
                  <button
                    type="button"
                    onClick={() => openThread(tab.threadKey)}
                    className="inline-flex min-w-0 flex-1 items-center gap-1.5 rounded-t-[inherit] px-1.5 py-1 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-100/70 focus-visible:ring-inset"
                    data-testid="thread-tab-select"
                    data-dragging={dragSurfaceProps?.isDragging ? "true" : "false"}
                    {...(dragSurfaceProps?.attributes ?? {})}
                    {...(dragSurfaceProps?.listeners ?? {})}
                    aria-pressed={selected}
                  >
                    {tab.needsInput && <NeedsInputBell activeOutput={activeOutput} />}
                    {showBlueNudge && <BlueNotificationBell activeOutput={activeOutput} />}
                    <ActiveTitle activeOutput={activeOutput} titleColor={displayTitleColor}>
                      {displayQuestId && <span className="shrink-0 font-mono-code">{displayQuestId}</span>}
                      <span className="min-w-0 truncate">{displayTitle}</span>
                    </ActiveTitle>
                  </button>
                  {onCloseThreadTab && tab.canClose && (
                    <button
                      type="button"
                      aria-label={`Close ${displayQuestId ?? displayTitle}`}
                      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border-l border-current/10 text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:w-5 focus-visible:border-l focus-visible:opacity-100 ${
                        selected
                          ? "w-5 opacity-100"
                          : "w-5 opacity-70 sm:w-0 sm:border-l-0 sm:opacity-0 sm:group-hover:w-5 sm:group-hover:border-l sm:group-hover:opacity-100"
                      }`}
                      data-testid="thread-tab-close"
                      data-compact-close="true"
                      data-selected={selected ? "true" : "false"}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCloseThreadTab(tab.threadKey);
                      }}
                    >
                      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </button>
                  )}
                </>
              );

              return reorderable ? (
                <SortableThreadTabContainer
                  key={tab.threadKey}
                  tab={tab}
                  className={className}
                  title={title}
                  minLabel={displayQuestId ?? tab.threadKey}
                  activeOutput={activeOutput}
                  newTab={newTab}
                  hoverQuest={hoverQuest}
                  onMouseEnter={mouseEnter}
                  onMouseLeave={hoverQuest ? scheduleQuestHoverHide : undefined}
                >
                  {children}
                </SortableThreadTabContainer>
              ) : (
                <div
                  key={tab.threadKey}
                  title={title}
                  onMouseEnter={mouseEnter}
                  onMouseLeave={hoverQuest ? scheduleQuestHoverHide : undefined}
                  className={className}
                  data-testid="thread-tab"
                  data-thread-key={tab.threadKey}
                  data-thread-tab-width-source="true"
                  data-needs-input={tab.needsInput ? "true" : "false"}
                  data-blue-notification={tab.blueNudge ? "true" : "false"}
                  data-active-output={activeOutput ? "true" : "false"}
                  data-new-tab={newTab ? "true" : "false"}
                  data-min-label={displayQuestId ?? tab.threadKey}
                  data-closable={tab.canClose ? "true" : "false"}
                  data-has-quest-hover={hoverQuest ? "true" : "false"}
                  data-reorderable="false"
                >
                  {children()}
                </div>
              );
            })}
          </SortableContext>
        </DndContext>
        {hasOverflowTabs && (
          <div className="relative shrink-0" data-testid="thread-tabs-more-wrapper">
            <button
              type="button"
              onClick={() => {
                if (moreTabsOpen) closeMoreTabs();
                else setMoreTabsOpen(true);
              }}
              className={`relative inline-flex h-full min-w-[4.25rem] items-center justify-center gap-1 rounded-t-md border px-2 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-100/70 focus-visible:ring-inset ${
                moreTabsOpen || selectedHidden
                  ? "border-violet-100/45 bg-white/[0.055] text-white"
                  : activeOutputHidden
                    ? "border-sky-300/35 bg-sky-400/10 text-sky-100 hover:bg-sky-400/15"
                    : "border-cc-border/70 bg-cc-hover/30 text-cc-muted hover:bg-cc-hover/60 hover:text-cc-fg"
              }`}
              data-testid="thread-tabs-more-button"
              data-hidden-count={hiddenTabs.length}
              data-has-selected={selectedHidden ? "true" : "false"}
              data-has-active-output={activeOutputHidden ? "true" : "false"}
              data-has-needs-input={needsInputHidden ? "true" : "false"}
              data-has-blue-notification={blueNudgeHidden ? "true" : "false"}
              aria-haspopup="menu"
              aria-expanded={moreTabsOpen}
              aria-label={`${hiddenTabs.length} hidden tab${hiddenTabs.length === 1 ? "" : "s"}`}
            >
              {activeOutputHidden && (
                <span className="h-1.5 w-1.5 rounded-full bg-sky-200 shadow-[0_0_8px_rgba(224,242,254,0.8)]" />
              )}
              {needsInputHidden && <NeedsInputBell activeOutput={activeOutputHidden} />}
              {showBlueNudgeHidden && <BlueNotificationBell activeOutput={activeOutputHidden} />}
              <span>More</span>
              <span className="rounded-sm bg-cc-hover/70 px-1 font-mono-code text-[10px] text-cc-fg">
                {hiddenTabs.length}
              </span>
            </button>
            {moreTabsOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-[min(22rem,90vw)] overflow-hidden rounded-md border border-cc-border bg-cc-card shadow-xl"
                data-testid="thread-tabs-more-list"
                data-reorder-mode={reorderMode ? "true" : "false"}
                role="menu"
              >
                <div className="flex items-center justify-between gap-2 border-b border-cc-border px-2 py-1.5">
                  <span className="text-[11px] font-medium text-cc-fg">More tabs</span>
                  {onReorderThreadTabs && moreTabsReorderKeys.length > 1 && (
                    <div className="flex items-center gap-1">
                      {reorderMode ? (
                        <>
                          <button
                            type="button"
                            onClick={cancelMoreTabsReorder}
                            className="rounded border border-cc-border/70 px-1.5 py-0.5 text-[10px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={commitMoreTabsReorder}
                            className="rounded border border-cc-primary/50 bg-cc-primary/15 px-1.5 py-0.5 text-[10px] text-cc-fg transition-colors hover:bg-cc-primary/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
                          >
                            Done
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setDraftReorderKeys(moreTabsReorderKeys);
                            setReorderMode(true);
                          }}
                          className="rounded border border-cc-border/70 px-1.5 py-0.5 text-[10px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
                          data-testid="thread-tabs-more-reorder-toggle"
                        >
                          Reorder
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto py-1" data-testid="thread-tabs-more-list-rows">
                  {moreTabsListOrder().map((tab) => {
                    const threadKey = normalizeThreadKey(tab.threadKey);
                    const selected = isSelectedThread(currentThreadKey, threadKey);
                    const activeOutput = isActiveOutputThread(runningActiveTurnRoute, threadKey);
                    const hidden = hiddenKeySet.has(threadKey);
                    const reorderable = moreTabsReorderKeySet.has(threadKey);
                    const draftIndex = draftReorderKeys.indexOf(threadKey);
                    const hoverQuest = tab.questId ? questById.get(normalizeThreadKey(tab.questId)) : undefined;
                    const displayQuestId = hoverQuest?.questId ?? tab.questId;
                    const displayTitle = hoverQuest?.title ?? tab.title;
                    const displayTitleColor = completedQuestTitleColor(hoverQuest) ?? tab.titleColor;
                    return (
                      <div
                        key={threadKey}
                        className={`group flex min-w-0 items-center gap-2 px-2 py-1.5 text-left text-[11px] transition-colors ${
                          selected ? "bg-violet-100/10 text-white" : "text-cc-fg hover:bg-cc-hover/50"
                        }`}
                        data-testid="thread-tabs-more-row"
                        data-thread-key={threadKey}
                        data-hidden={hidden ? "true" : "false"}
                        data-current={selected ? "true" : "false"}
                        data-active-output={activeOutput ? "true" : "false"}
                        data-needs-input={tab.needsInput ? "true" : "false"}
                        data-blue-notification={tab.blueNudge ? "true" : "false"}
                        data-reorderable={reorderable ? "true" : "false"}
                      >
                        {reorderMode && reorderable && (
                          <div className="flex shrink-0 flex-col gap-0.5">
                            <button
                              type="button"
                              aria-label={`Move ${displayQuestId ?? threadKey} up`}
                              disabled={draftIndex <= 0}
                              onClick={() => moveDraftReorderKey(threadKey, -1)}
                              className="rounded border border-cc-border/70 px-1 text-[10px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg disabled:opacity-35"
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${displayQuestId ?? threadKey} down`}
                              disabled={draftIndex < 0 || draftIndex >= draftReorderKeys.length - 1}
                              onClick={() => moveDraftReorderKey(threadKey, 1)}
                              className="rounded border border-cc-border/70 px-1 text-[10px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg disabled:opacity-35"
                            >
                              Down
                            </button>
                          </div>
                        )}
                        <button
                          type="button"
                          disabled={reorderMode}
                          onClick={() => {
                            openThread(threadKey);
                            closeMoreTabs();
                          }}
                          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-violet-100/70 disabled:cursor-default"
                          data-testid="thread-tabs-more-row-select"
                        >
                          {activeOutput && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-200 shadow-[0_0_8px_rgba(224,242,254,0.8)]" />
                          )}
                          {tab.needsInput && <NeedsInputBell activeOutput={activeOutput} />}
                          {tab.blueNudge && !tab.needsInput && <BlueNotificationBell activeOutput={activeOutput} />}
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              {displayQuestId && <span className="shrink-0 font-mono-code">{displayQuestId}</span>}
                              <span
                                className="min-w-0 truncate"
                                style={displayTitleColor ? { color: displayTitleColor } : undefined}
                                data-testid="thread-tabs-more-row-title"
                                data-title-color={displayTitleColor ?? ""}
                              >
                                {displayTitle}
                              </span>
                            </span>
                            <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-cc-muted">
                              <span>{threadKey}</span>
                              {selected && <span className="text-violet-100">Current</span>}
                              {!hidden && <span>Visible</span>}
                              {tab.detail && <span className="min-w-0 truncate">{tab.detail}</span>}
                            </span>
                          </span>
                        </button>
                        {onCloseThreadTab && tab.canClose && !reorderMode && (
                          <button
                            type="button"
                            aria-label={`Close ${displayQuestId ?? displayTitle}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              onCloseThreadTab(threadKey);
                              closeMoreTabs();
                            }}
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
                            data-testid="thread-tabs-more-row-close"
                          >
                            <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                              <path
                                d="M3 3l6 6M9 3L3 9"
                                stroke="currentColor"
                                strokeWidth="1.4"
                                strokeLinecap="round"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      {hoveredQuest && (
        <QuestHoverCard
          quest={hoveredQuest.quest}
          anchorRect={hoveredQuest.anchorRect}
          onMouseEnter={() => {
            if (hideQuestHoverTimerRef.current) clearTimeout(hideQuestHoverTimerRef.current);
          }}
          onMouseLeave={() => setHoveredQuest(null)}
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
  const isOrchestrator = useStore(
    (s) =>
      s.sessions.get(sessionId)?.isOrchestrator === true ||
      s.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator === true),
  );
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
  const activeThreadChips = useMemo(
    () => buildPrimaryThreadChips({ activeBoardRows, threadRows, attentionRecords }),
    [activeBoardRows, attentionRecords, threadRows],
  );
  const openThreadTabs = useMemo(
    () =>
      buildOpenThreadTabs({
        openThreadKeys,
        threadRows,
        activeThreadChips,
        activeBoardRows,
        completedBoardRows,
      }),
    [activeBoardRows, activeThreadChips, completedBoardRows, openThreadKeys, threadRows],
  );
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
  const mainThreadState = useMemo(
    () => activeThreadChips.find((chip) => chip.threadKey === MAIN_THREAD_KEY),
    [activeThreadChips],
  );
  const openThreadTabKeys = useMemo(() => new Set(openThreadTabs.map((tab) => tab.threadKey)), [openThreadTabs]);
  const activeBoardThreadKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of activeBoardRows) keys.add(normalizeThreadKey(row.questId));
    return keys;
  }, [activeBoardRows]);
  const closedActiveThreadChips = useMemo(
    () =>
      activeThreadChips.filter(
        (chip) =>
          chip.threadKey !== MAIN_THREAD_KEY &&
          chip.threadKey !== ALL_THREADS_KEY &&
          !openThreadTabKeys.has(chip.threadKey) &&
          (activeBoardThreadKeys.has(chip.threadKey) || !dismissedAutoThreadTabKeys.has(chip.threadKey)),
      ),
    [activeBoardThreadKeys, activeThreadChips, dismissedAutoThreadTabKeys, openThreadTabKeys],
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
      if (closedActiveBoardThreadKeys.has(key) && !openThreadTabKeys.has(key)) nextKeys.add(key);
    }
    if (previousKeys) {
      for (const key of closedActiveBoardThreadKeys) {
        if (!previousKeys.has(key) && !openThreadTabKeys.has(key)) nextKeys.add(key);
      }
    }
    return nextKeys;
  }, [closedActiveBoardThreadKeys, openThreadTabKeys, sessionId]);
  useLayoutEffect(() => {
    pendingThreadTabSessionRef.current = sessionId;
    previousClosedActiveBoardThreadKeysRef.current = new Set(closedActiveBoardThreadKeys);
    leadingPendingThreadKeysRef.current = new Set(leadingPendingThreadKeys);
  }, [closedActiveBoardThreadKeys, leadingPendingThreadKeys, sessionId]);
  const unifiedThreadTabs = useMemo(
    () => buildUnifiedThreadTabs({ openThreadTabs, closedActiveThreadChips, leadingPendingThreadKeys }),
    [closedActiveThreadChips, leadingPendingThreadKeys, openThreadTabs],
  );
  const handleCloseThreadTab = (threadKey: string) => {
    const normalized = normalizeThreadKey(threadKey);
    const nextThreadKey = threadKeyToSelectAfterClosing(normalized, unifiedThreadTabs);
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
  const activeSummarySegments = useMemo(() => activeBoardSummarySegments(activeBoardRows), [activeBoardRows]);
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
        tabs={unifiedThreadTabs}
        reorderableThreadKeys={openThreadTabs.map((tab) => normalizeThreadKey(tab.threadKey))}
        sessionId={sessionId}
        currentThreadKey={currentThreadKey}
        onSelectThread={onSelectThread}
        onCloseThreadTab={onCloseThreadTab ? handleCloseThreadTab : undefined}
        onReorderThreadTabs={onReorderThreadTabs}
        newTabKeys={newThreadTabKeys}
      />

      {showMainBanner && (
        <div
          className="flex min-w-0 flex-wrap items-center gap-1.5 border-b border-cc-border bg-cc-card px-3 py-1.5 sm:flex-nowrap sm:px-4"
          data-testid="workboard-main-banner"
          data-active-view={panelView ?? ""}
        >
          <ProjectionToggle currentThreadKey={currentThreadKey} onSelectThread={onSelectThread} />
          <svg viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5 text-blue-400 shrink-0">
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
