import {
  memo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import type { QuestmasterCompactSort, QuestmasterCompactSortColumn, QuestmasterCompactSortDirection } from "../api.js";
import { useStore } from "../store.js";
import type { QuestListPreview, QuestStatus } from "../types.js";
import { markdownToPlainText } from "../utils/copy-utils.js";
import {
  CopyableQuestId,
  getQuestDisplayOwner,
  getQuestLeaderSessionId,
  getQuestOwnerSessionId,
  timeAgo,
} from "../utils/quest-helpers.js";
import type { QuestJourneyContext } from "../utils/quest-journey-context.js";
import { resolveSessionNavigation } from "../utils/session-navigation-resolver.js";
import { getHighlightParts } from "../utils/highlight.js";
import { QUEST_STATUS_THEME } from "../utils/quest-status-theme.js";
import { getQuestPhaseDotStyle, getQuestPhaseTextStyle } from "../utils/quest-phase-theme.js";
import { getQuestJourneyPhaseForState, getQuestJourneyPresentation } from "../../shared/quest-journey.js";
import { CodexQuestOwnerChip } from "./CodexQuestOwnerChip.js";
import { QuestHoverCard } from "./QuestHoverCard.js";
import { SessionNumChip } from "./SessionNumChip.js";

export type QuestmasterLayout = "desktop" | "phone";

// The list sorts by these columns; an older saved Feedback sort, whose column is gone, falls back to the default.
const COMPACT_SORT_COLUMNS: readonly QuestmasterCompactSortColumn[] = [
  "quest",
  "title",
  "owner",
  "leader",
  "status",
  "updated",
];
const DEFAULT_COMPACT_SORT: QuestmasterCompactSort = { column: "updated", direction: "desc" };
const DEFAULT_COMPACT_SORT_DIRECTIONS: Record<QuestmasterCompactSortColumn, QuestmasterCompactSortDirection> = {
  quest: "asc",
  title: "asc",
  owner: "asc",
  leader: "asc",
  status: "asc",
  feedback: "desc",
  updated: "desc",
};

export type QuestmasterDisplayStatus = {
  label: string;
  dotClass?: string;
  dotStyle?: CSSProperties;
  textClass: string;
  textStyle?: CSSProperties;
};

export function questRecencyTs(quest: QuestListPreview): number {
  return Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

export function normalizeCompactSort(sort: unknown): QuestmasterCompactSort {
  if (!sort || typeof sort !== "object" || Array.isArray(sort)) return DEFAULT_COMPACT_SORT;
  const raw = sort as Record<string, unknown>;
  if (
    !COMPACT_SORT_COLUMNS.includes(raw.column as QuestmasterCompactSortColumn) ||
    (raw.direction !== "asc" && raw.direction !== "desc")
  ) {
    return DEFAULT_COMPACT_SORT;
  }
  return { column: raw.column as QuestmasterCompactSortColumn, direction: raw.direction };
}

export function nextCompactSort(
  current: QuestmasterCompactSort,
  column: QuestmasterCompactSortColumn,
): QuestmasterCompactSort {
  if (current.column === column) {
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { column, direction: DEFAULT_COMPACT_SORT_DIRECTIONS[column] };
}

export function getQuestmasterDisplayStatus(
  quest: QuestListPreview,
  journeyContext?: QuestJourneyContext,
): QuestmasterDisplayStatus {
  const isCancelled = "cancelled" in quest && !!(quest as { cancelled?: boolean }).cancelled;
  if (isCancelled) {
    return {
      label: "Cancelled",
      dotClass: "bg-red-400",
      textClass: "text-red-300",
    };
  }

  if (quest.status === "done") {
    return { label: "Completed", dotClass: QUEST_STATUS_THEME.done.dot, textClass: QUEST_STATUS_THEME.done.text };
  }

  if (journeyContext && !journeyContext.completed) {
    const presentation = getQuestJourneyPresentation(journeyContext.row.status);
    const phase = getQuestJourneyPhaseForState(journeyContext.row.status);
    if (presentation || phase) {
      return {
        label: presentation?.label ?? phase?.label ?? "In Progress",
        dotStyle: phase ? getQuestPhaseDotStyle(phase) : undefined,
        dotClass: phase ? undefined : QUEST_STATUS_THEME.in_progress.dot,
        textClass: phase ? "" : "text-cc-muted",
        textStyle: phase ? getQuestPhaseTextStyle(phase) : undefined,
      };
    }
  }

  const cfg =
    quest.status === "refined"
      ? { ...QUEST_STATUS_THEME.refined, label: "Actionable" }
      : QUEST_STATUS_THEME[quest.status];
  return { label: cfg.label, dotClass: cfg.dot, textClass: cfg.text };
}

export function renderSearchHighlightText(text: string, searchText: string): React.ReactNode {
  if (!searchText) return text;
  const parts = getHighlightParts(text, searchText);
  if (!parts.some((part) => part.matched)) return text;
  return (
    <>
      {parts.map((part, index) =>
        part.matched ? (
          <mark key={`${part.text}-${index}`} className="rounded-[2px] bg-cc-attention-bg px-0.5 text-cc-attention">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

export function QuestStatusHoverTarget({ quest, children }: { quest: QuestListPreview; children: ReactNode }) {
  const [hoverRect, setHoverRect] = useState<DOMRect | null>(null);
  const hideHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    },
    [],
  );

  function handleMouseEnter(event: ReactMouseEvent<HTMLSpanElement>) {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    setHoverRect(event.currentTarget.getBoundingClientRect());
  }

  function handleMouseLeave() {
    if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
    hideHoverTimerRef.current = setTimeout(() => setHoverRect(null), 100);
  }

  return (
    <>
      <span
        className="inline-flex cursor-help"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        title="Show quest journey"
      >
        {children}
      </span>
      {hoverRect && (
        <QuestHoverCard
          quest={quest}
          anchorRect={hoverRect}
          onMouseEnter={() => {
            if (hideHoverTimerRef.current) clearTimeout(hideHoverTimerRef.current);
          }}
          onMouseLeave={() => setHoverRect(null)}
        />
      )}
    </>
  );
}

/** Statuses in the order a reader scans them: what is moving, then what is waiting. */
export const QUESTMASTER_STATUS_CHIPS: ReadonlyArray<{ value: QuestStatus; label: string }> = [
  { value: "in_progress", label: "In progress" },
  { value: "refined", label: "Actionable" },
  { value: "idea", label: "Ideas" },
  { value: "done", label: "Completed" },
];

/** The sortable columns of the desktop list; each keeps the server-saved sort it maps to. */
export const QUESTMASTER_SORT_COLUMNS: ReadonlyArray<{ column: QuestmasterCompactSortColumn; label: string }> = [
  { column: "updated", label: "Updated" },
  { column: "title", label: "Title" },
  { column: "status", label: "Status" },
  { column: "owner", label: "Owner" },
  { column: "leader", label: "Leader" },
  { column: "quest", label: "Quest number" },
];

// Phone second line: Status | Owner | open feedback | quest number
const PHONE_META_COLUMNS: CSSProperties = { gridTemplateColumns: "6.75rem 3.75rem minmax(0,1fr) auto" };

// Title | Status | Owner | Leader | Updated
const DESKTOP_COLUMNS: CSSProperties = { gridTemplateColumns: "minmax(0,1fr) 8.5rem 4.25rem 4.25rem 4.75rem" };

/**
 * Status filter as one segmented bar of equal cells, matching the to-do page, so labels and counts
 * line up instead of reading as loose chips of different widths. On a phone the count sits under
 * its label, so the five cells fit a 375 px screen without wrapping or scrolling.
 */
export function QuestmasterStatusFilter({
  statusFilter,
  counts,
  layout,
  onSelect,
}: {
  statusFilter: QuestStatus | null;
  counts: Record<string, number>;
  layout: QuestmasterLayout;
  onSelect: (status: QuestStatus | null) => void;
}) {
  const cells: Array<{ value: QuestStatus | null; label: string }> = [
    { value: null, label: "All" },
    ...QUESTMASTER_STATUS_CHIPS,
  ];
  return (
    <div
      role="group"
      aria-label="Filter quests by status"
      className={`grid grid-cols-5 rounded-lg border border-cc-border p-0.5 ${layout === "desktop" ? "w-[32rem]" : "w-full"}`}
    >
      {cells.map((cell) => {
        const selected = statusFilter === cell.value;
        return (
          <button
            key={cell.label}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(cell.value)}
            className={`flex min-w-0 cursor-pointer items-center justify-center rounded-md ${
              layout === "desktop" ? "h-7 gap-1 text-xs" : "h-10 flex-col text-[11px] leading-tight"
            } ${selected ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:text-cc-fg"}`}
          >
            <span className="max-w-full truncate">{cell.label}</span>
            <span className="tabular-nums text-cc-muted">{counts[cell.value ?? "all"] ?? 0}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Phone sort picker: the native select, so iOS shows its own picker. */
export function QuestmasterSortSelect({
  sort,
  disabled,
  onSortChange,
}: {
  sort: QuestmasterCompactSort;
  disabled: boolean;
  onSortChange: (column: QuestmasterCompactSortColumn) => void;
}) {
  const current = QUESTMASTER_SORT_COLUMNS.find((entry) => entry.column === sort.column);
  return (
    <label className="relative inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs text-cc-muted hover:bg-cc-hover hover:text-cc-fg">
      <span>{current?.label ?? "Updated"}</span>
      <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>
      <select
        aria-label="Sort quests"
        value={sort.column}
        disabled={disabled}
        onChange={(event) => onSortChange(event.target.value as QuestmasterCompactSortColumn)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {QUESTMASTER_SORT_COLUMNS.map((entry) => (
          <option key={entry.column} value={entry.column}>
            {entry.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Column labels above the desktop list; sortable when `onSortChange` is given. */
export function QuestmasterColumnHeader({
  sort,
  sortSaving,
  onSortChange,
}: {
  sort: QuestmasterCompactSort;
  sortSaving: boolean;
  onSortChange?: (column: QuestmasterCompactSortColumn) => void;
}) {
  const cell = (column: QuestmasterCompactSortColumn, label: string, align: "left" | "right" = "left") => {
    const active = onSortChange && sort.column === column;
    const content = (
      <>
        <span>{label}</span>
        {active && <span aria-hidden="true">{sort.direction === "asc" ? "↑" : "↓"}</span>}
      </>
    );
    if (!onSortChange) {
      return <span className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}>{content}</span>;
    }
    const nextDirection = nextCompactSort(sort, column).direction;
    return (
      <button
        type="button"
        onClick={() => onSortChange(column)}
        disabled={sortSaving}
        aria-label={`Sort by ${label} ${nextDirection === "asc" ? "ascending" : "descending"}`}
        className={`flex cursor-pointer items-center gap-1 transition-colors hover:text-cc-fg disabled:cursor-wait ${
          active ? "text-cc-fg" : ""
        } ${align === "right" ? "justify-end" : ""}`}
      >
        {content}
      </button>
    );
  };
  return (
    <div
      className="grid items-center gap-x-3 border-b border-cc-border px-3 py-1.5 text-[11px] text-cc-muted"
      style={DESKTOP_COLUMNS}
    >
      {cell("title", "Quest")}
      {cell("status", "Status")}
      {cell("owner", "Owner")}
      {cell("leader", "Leader")}
      {cell("updated", "Updated", "right")}
    </div>
  );
}

export const QuestmasterQuestRow = memo(function QuestmasterQuestRow({
  quest,
  layout,
  searchText,
  journeyContext,
  onOpenQuest,
}: {
  quest: QuestListPreview;
  layout: QuestmasterLayout;
  searchText: string;
  journeyContext?: QuestJourneyContext;
  onOpenQuest: (quest: QuestListPreview) => void;
}) {
  const isCancelled = "cancelled" in quest && !!quest.cancelled;
  const status = getQuestmasterDisplayStatus(quest, journeyContext);
  const openFeedback = quest.feedbackSummary?.humanUnaddressed ?? 0;
  const tldr = quest.tldr ? markdownToPlainText(quest.tldr).replace(/\s+/g, " ").trim() : "";
  const updated = timeAgo(questRecencyTs(quest));

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onOpenQuest(quest);
  };

  const title = (
    <span className={isCancelled ? "text-cc-muted line-through" : "text-cc-fg"}>
      {renderSearchHighlightText(quest.title, searchText)}
    </span>
  );
  const statusLabel = (
    <QuestStatusHoverTarget quest={quest}>
      <span className={`inline-flex min-w-0 items-center gap-1.5 ${status.textClass}`} style={status.textStyle}>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dotClass ?? ""}`} style={status.dotStyle} />
        <span className="truncate">{status.label}</span>
      </span>
    </QuestStatusHoverTarget>
  );
  const questId = (
    <CopyableQuestId questId={quest.questId} className="shrink-0 font-mono-code text-[11px] text-cc-muted/70">
      {renderSearchHighlightText(quest.questId, searchText)}
    </CopyableQuestId>
  );
  const feedbackBadge = openFeedback > 0 && (
    <span className="shrink-0 rounded-full bg-cc-attention-bg px-1.5 text-[11px] text-cc-attention">
      {openFeedback} open
    </span>
  );

  const rowProps = {
    "data-quest-id": quest.questId,
    role: "button",
    tabIndex: 0,
    onClick: () => onOpenQuest(quest),
    onKeyDown: handleKeyDown,
  } as const;

  if (layout === "phone") {
    return (
      <div
        {...rowProps}
        className={`cursor-pointer px-3 py-2.5 focus-visible:bg-cc-hover/40 focus-visible:outline-none active:bg-cc-hover/40 ${
          isCancelled ? "opacity-70" : ""
        }`}
      >
        <div className="flex items-start gap-2">
          <div className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug">{title}</div>
          <span className="mt-px shrink-0 text-xs text-cc-muted">{updated}</span>
        </div>
        {/* Fixed slots, so status, owner and feedback line up from row to row. */}
        <div className="mt-1 grid min-w-0 items-center gap-2 text-xs" style={PHONE_META_COLUMNS}>
          <div className="min-w-0">{statusLabel}</div>
          <div className="flex min-w-0 items-center">
            <QuestOwnerRef quest={quest} />
          </div>
          <div className="min-w-0">{feedbackBadge}</div>
          <div className="justify-self-end">{questId}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      {...rowProps}
      style={DESKTOP_COLUMNS}
      className={`group grid cursor-pointer items-center gap-x-3 px-3 py-2 text-xs hover:bg-cc-hover/30 focus-visible:bg-cc-hover/40 focus-visible:outline-none ${
        isCancelled ? "opacity-70" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
          {feedbackBadge}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {questId}
          {tldr && (
            <span data-testid="quest-row-tldr" className="truncate text-cc-muted">
              {renderSearchHighlightText(tldr, searchText)}
            </span>
          )}
        </div>
      </div>
      <div className="min-w-0">{statusLabel}</div>
      <div data-testid="quest-row-owner" className="flex min-w-0 items-center">
        <QuestOwnerRef quest={quest} />
      </div>
      <div data-testid="quest-row-leader" className="flex min-w-0 items-center">
        <QuestLeaderRef quest={quest} />
      </div>
      <div className="text-right text-cc-muted">{updated}</div>
    </div>
  );
});

const SESSION_REF_CLASS =
  "cursor-pointer rounded px-1 py-0.5 font-mono-code text-[11px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg";

function QuestOwnerRef({ quest }: { quest: QuestListPreview }) {
  const owner = getQuestDisplayOwner(quest);
  if (owner?.kind === "codex") return <CodexQuestOwnerChip owner={owner} stopPropagation />;
  const sessionId = getQuestOwnerSessionId(quest);
  return sessionId ? <KnownSessionRef sessionId={sessionId} /> : null;
}

function QuestLeaderRef({ quest }: { quest: QuestListPreview }) {
  const sessionId = getQuestLeaderSessionId(quest);
  return sessionId ? <KnownSessionRef sessionId={sessionId} threadKey={quest.questId} /> : null;
}

/** A session reference, left out when the session is no longer known (an archived or removed session). */
function KnownSessionRef({ sessionId, threadKey }: { sessionId: string; threadKey?: string }) {
  const known = useStore((s) => resolveSessionNavigation(s, sessionId)?.sidebarItem.sessionNum != null);
  if (!known) return null;
  return <SessionNumChip sessionId={sessionId} threadKey={threadKey} className={SESSION_REF_CLASS} />;
}
