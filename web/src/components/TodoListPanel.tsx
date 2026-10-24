import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from "react";
import { isTodoOverdue } from "../../shared/todo-due.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import {
  TODO_STATUSES,
  type TodoCompletionUndoHandle,
  type TodoItem,
  type TodoLinkedQuest,
  type TodoState,
  type TodoStatus,
} from "../../shared/todo-types.js";
import { api } from "../api.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { scopedGetItem, scopedSetItem } from "../utils/scoped-storage.js";
import { celebrationAnchor, playCompletionCelebration } from "./completion-celebration.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { TodoComposer } from "./TodoComposer.js";
import { TodoDueLabel } from "./TodoDueControls.js";
import { TodoItemSheet } from "./TodoInlineLink.js";
import { TodoStatusCircle } from "./TodoItemDesktopLayout.js";
import { activeTodoCategories, TodoManagementDrawer } from "./TodoManagementDrawer.js";
import { TodoQuestChips } from "./TodoQuestChips.js";
import { useTodoDueNow } from "./todo-due-clock.js";
import { useSwipeActions } from "./todo-swipe.js";
import {
  filterTodoItems,
  groupActiveItemsByCategory,
  groupDoneItemsByLocalDate,
  type TodoStatusFilter,
} from "./todo-ui-utils.js";

const COLLAPSED_CATEGORIES_KEY = "cc-todo-collapsed-categories";

function readCollapsedCategories(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(scopedGetItem(COLLAPSED_CATEGORIES_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-cc-error/25 bg-cc-error/10 px-4 py-3 text-sm text-cc-error">
      <span>{message}</span>
      <button type="button" onClick={onDismiss} className="shrink-0 cursor-pointer text-xs underline">
        Dismiss
      </button>
    </div>
  );
}

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  search: "M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11zM14.5 14.5l-3.6-3.6",
  plus: "M8 3v10M3 8h10",
  chevron: "M6 4l4 4-4 4",
  sliders: "M3 4.5h10M3 11.5h10M6 3v3M10 10v3",
  details: "M3 5h10M3 8h10M3 11h6",
};

/** Where the add box is open: at the top (New), at the end of a category (its +) or below a row. */
interface ComposerTarget {
  categoryId: string;
  afterItemId?: string;
  top?: boolean;
}

interface CompletionUndoNotice extends TodoCompletionUndoHandle {
  title: string;
}

interface DropTarget {
  categoryId: string;
  itemId?: string;
  before?: boolean;
}

function shouldIgnoreRowShortcut(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("button,select,input,textarea,a,summary");
}

/** The status circle: tap to complete, or to reopen a Done item. */
function TodoMarker({
  item,
  title,
  disabled,
  onClick,
  ref,
}: {
  item: TodoItem;
  title: string;
  disabled: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled}
      aria-label={item.status === "done" ? `Reopen ${title}` : `Complete ${title}`}
      onClick={onClick}
      className="group/check -m-1.5 shrink-0 p-1.5 disabled:opacity-40"
    >
      <TodoStatusCircle status={item.status} className="h-[18px] w-[18px] text-[10px]" />
    </button>
  );
}

interface TodoRowProps {
  item: TodoItem;
  siblings: TodoItem[];
  categoryLabel?: string;
  linkedQuests: ReadonlyMap<string, TodoLinkedQuest>;
  /** Current time for due dates, refreshed when one passes. */
  now: number;
  isDragging: boolean;
  dropBefore?: boolean;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
  onToggleCompletion: (item: TodoItem) => Promise<void>;
  onInsertBelow: () => void;
  onOpen: () => void;
  onDragStart: (itemId: string) => void;
  onDragHover: (target: TodoItem, before: boolean) => void;
  onDragEnd: () => void;
  onDropItem: (target: TodoItem, before: boolean) => void;
}

/**
 * A quiet to-do row: the status circle and the text. Tapping the text opens the to-do sheet with
 * every action. On touch screens a swipe right completes it and a swipe left reveals Start (or
 * Pause) and More; with a mouse, a drag handle appears on hover. Keyboard: Enter opens, Alt+Enter
 * adds below, Alt+↑/↓ reorders.
 */
function TodoRow({
  item,
  siblings,
  categoryLabel,
  linkedQuests,
  now,
  isDragging,
  dropBefore,
  onState,
  onError,
  onToggleCompletion,
  onInsertBelow,
  onOpen,
  onDragStart,
  onDragHover,
  onDragEnd,
  onDropItem,
}: TodoRowProps) {
  const [busy, setBusy] = useState(false);
  const parts = useMemo(() => deriveTodoMarkdown(item.markdown), [item.markdown]);
  const active = !item.archivedAt && item.status !== "done";
  const overdue = isTodoOverdue(item, now);

  const run = useCallback(
    (action: () => Promise<{ state: TodoState }>) => {
      setBusy(true);
      void action()
        .then((response) => onState(response.state))
        .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
        .finally(() => setBusy(false));
    },
    [onError, onState],
  );

  const markerRef = useRef<HTMLButtonElement>(null);
  const toggleCompletion = () => {
    // Measured now: the completed row leaves the list as soon as the server confirms.
    const completing = item.status !== "done";
    const celebrateAt = completing ? celebrationAnchor(markerRef.current, markerRef.current?.closest("article")) : null;
    setBusy(true);
    void onToggleCompletion(item)
      .then(() => {
        if (completing) playCompletionCelebration(celebrateAt);
      })
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };

  const swipe = useSwipeActions({ enabled: active && !busy, onComplete: toggleCompletion });

  const openFromClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a,button,select,summary")) return;
    if (swipe.consumeClick()) return;
    onOpen();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (shouldIgnoreRowShortcut(event.target)) return;
    if (event.altKey && event.key === "Enter" && active) {
      event.preventDefault();
      onInsertBelow();
      return;
    }
    if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && active) {
      const index = siblings.findIndex((candidate) => candidate.id === item.id);
      const reference = event.key === "ArrowUp" ? siblings[index - 1] : siblings[index + 1];
      if (!reference) return;
      event.preventDefault();
      run(() =>
        api.moveTodoItem(
          item.id,
          event.key === "ArrowUp" ? { beforeItemId: reference.id } : { afterItemId: reference.id },
        ),
      );
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpen();
    }
  };

  const row = (
    <article
      data-todo-id={item.id}
      data-overdue={overdue || undefined}
      className={`group relative flex items-start gap-2.5 rounded-lg bg-cc-bg py-1.5 pl-2 pr-1 transition-colors hover:bg-cc-hover/50 ${item.archivedAt ? "opacity-65" : ""} ${isDragging ? "opacity-35" : ""}`}
      style={swipe.rowStyle}
      {...swipe.handlers}
      onDragOver={(event) => {
        if (!active) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        onDragHover(item, event.clientY < rect.top + rect.height / 2);
      }}
      onDrop={(event) => {
        if (!active) return;
        event.preventDefault();
        event.stopPropagation();
        const rect = event.currentTarget.getBoundingClientRect();
        onDropItem(item, dropBefore ?? event.clientY < rect.top + rect.height / 2);
      }}
    >
      {/* Overdue: a red bar on the row's left edge. */}
      {overdue && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-cc-error" />}
      <TodoMarker
        ref={markerRef}
        item={item}
        title={parts.titleMarkdown}
        disabled={busy || !!item.archivedAt}
        onClick={toggleCompletion}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open ${parts.titleMarkdown}`}
        title={active ? "Alt+Enter adds below · Alt+↑/↓ reorders" : undefined}
        onClick={openFromClick}
        onKeyDown={handleKeyDown}
        className="min-w-0 flex-1 cursor-pointer rounded px-0.5 text-sm leading-snug outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/50 [&>*+*]:ml-1.5"
      >
        {/* One flowing line: the title, then its due date, details hint and quest chips after the last word. */}
        <MarkdownContent
          text={parts.titleMarkdown}
          size="md"
          variant="conservative"
          wrapLongContent
          stopLinkPropagation
          className={`inline [&>p]:inline ${item.status === "done" ? "text-cc-muted line-through decoration-cc-muted/50" : ""}`}
        />
        {item.due && active && <TodoDueLabel due={item.due} overdue={overdue} now={now} />}
        {parts.detailsMarkdown && (
          <span className="inline-flex align-[-0.15em] text-cc-muted" title="Has details">
            <Icon path={ICONS.details} className="h-3.5 w-3.5" />
          </span>
        )}
        {categoryLabel && <span className="text-[11px] text-cc-muted">{categoryLabel}</span>}
        {item.questIds?.length ? (
          <TodoQuestChips questIds={item.questIds} linkedQuests={linkedQuests} className="inline-flex align-[0.05em]" />
        ) : null}
      </div>
      {active && (
        <button
          type="button"
          draggable
          aria-label={`Drag ${parts.titleMarkdown}`}
          title="Drag to reorder"
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", item.id);
            const element = event.currentTarget.closest<HTMLElement>("[data-todo-id]");
            if (element) event.dataTransfer.setDragImage?.(element, 24, Math.min(element.offsetHeight / 2, 32));
            onDragStart(item.id);
          }}
          onDragEnd={onDragEnd}
          className="hidden shrink-0 cursor-grab rounded px-1 py-0.5 text-xs text-cc-muted opacity-0 hover:bg-cc-hover hover:text-cc-fg group-hover:opacity-100 focus-visible:opacity-100 pointer-fine:block"
        >
          ⠿
        </button>
      )}
    </article>
  );

  if (!active) return row;
  return (
    <div ref={swipe.containerRef} className="relative overflow-hidden rounded-lg">
      {swipe.renderBackground({
        item,
        busy,
        onSetStatus: (status) => run(() => api.setTodoItemStatus(item.id, status)),
        onMore: onOpen,
      })}
      {row}
    </div>
  );
}

function TodoDropPlaceholder() {
  return (
    <div
      role="separator"
      aria-label="Drop to-do here"
      data-testid="todo-drop-placeholder"
      className="my-1 h-8 rounded-lg border-2 border-dashed border-cc-primary/70 bg-cc-primary/10"
    />
  );
}

function SectionHeader({
  name,
  count,
  collapsed,
  onToggle,
  onAdd,
  children,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-1 pr-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggle}
        className="-ml-1 flex min-h-8 min-w-0 items-center gap-1.5 rounded-md px-1 text-[13px] text-cc-muted hover:text-cc-fg"
      >
        <Icon
          path={ICONS.chevron}
          className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
        />
        <span className="truncate font-medium text-cc-fg">{name}</span>
        <span className="text-[11px]">{count}</span>
        {children}
      </button>
      {onAdd && (
        <button
          type="button"
          aria-label={`Add to ${name}`}
          title={`Add to ${name}`}
          onClick={onAdd}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        >
          <Icon path={ICONS.plus} className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const STATUS_FILTERS: { value: TodoStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "todo", label: "Todo" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
  { value: "archived", label: "Archived" },
];

/**
 * Status filter as one segmented control with equal cells, so the labels and counts line up
 * instead of reading as loose chips of different widths.
 */
function StatusFilter({
  value,
  counts,
  onChange,
}: {
  value: TodoStatusFilter;
  counts: Record<TodoStatus, number>;
  onChange: (value: TodoStatusFilter) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by status"
      className="grid grid-cols-5 rounded-lg border border-cc-border p-0.5 sm:inline-grid sm:w-[26rem]"
    >
      {STATUS_FILTERS.map((filter) => {
        const count =
          filter.value === "all"
            ? counts.todo + counts.doing
            : filter.value === "archived"
              ? undefined
              : counts[filter.value as TodoStatus];
        const selected = value === filter.value;
        return (
          <button
            key={filter.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(filter.value)}
            className={`flex h-7 min-w-0 items-center justify-center gap-1 rounded-md text-xs ${
              selected ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:text-cc-fg"
            }`}
          >
            <span className="truncate">{filter.label}</span>
            {count !== undefined && <span className="text-cc-muted">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The personal to-do list: a one-row header (search, category management, New), a status filter,
 * collapsible category sections of quiet rows, a collapsed Done history by completion date, and
 * an Undo toast after completing. Each row opens the shared to-do sheet for every other action.
 */
export function TodoListPanel() {
  const [state, setState] = useState<TodoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TodoStatusFilter>("all");
  const [manageOpen, setManageOpen] = useState(false);
  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [completionUndo, setCompletionUndo] = useState<CompletionUndoNotice | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [sheetItemId, setSheetItemId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedCategories);

  const [linkedQuests, setLinkedQuests] = useState<ReadonlyMap<string, TodoLinkedQuest>>(() => new Map());
  const activeDues = useMemo(
    () =>
      state?.items.flatMap((item) => (item.due && item.status !== "done" && !item.archivedAt ? [item.due] : [])) ?? [],
    [state],
  );
  const now = useTodoDueNow(activeDues);

  const applyState = useCallback((next: TodoState) => {
    setState((current) => (!current || next.revision >= current.revision ? next : current));
  }, []);
  const refresh = useCallback(() => {
    // Linked quest status is a separate server lookup so quest progress reaches the
    // chips on every refresh; if it fails, the chips keep their last known status.
    void api
      .getTodoLinkedQuests()
      .then((response) => setLinkedQuests(new Map(response.quests.map((quest) => [quest.questId, quest]))))
      .catch((reason: unknown) => console.warn("[todos] linked quest status unavailable:", reason));
    return api
      .getTodoState()
      .then(applyState)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  }, [applyState]);

  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener(TODO_STATE_UPDATED_EVENT, listener);
    const interval = window.setInterval(listener, 30_000);
    return () => {
      window.removeEventListener(TODO_STATE_UPDATED_EVENT, listener);
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    if (!completionUndo) return;
    const delay = Math.max(0, completionUndo.expiresAt - Date.now());
    const timeout = window.setTimeout(() => setCompletionUndo(null), delay);
    return () => window.clearTimeout(timeout);
  }, [completionUndo]);

  const toggleCollapsed = useCallback((categoryId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(categoryId)) next.add(categoryId);
      scopedSetItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const counts = useMemo(() => {
    const current = state?.items.filter((item) => !item.archivedAt) ?? [];
    return Object.fromEntries(
      TODO_STATUSES.map((status) => [status, current.filter((item) => item.status === status).length]),
    ) as Record<TodoStatus, number>;
  }, [state]);
  const visibleItems = useMemo(
    () => (state ? filterTodoItems(state.items, { status: statusFilter, categoryId: "all", search }) : []),
    [search, state, statusFilter],
  );
  const activeGroups = useMemo(
    () =>
      state
        ? groupActiveItemsByCategory(
            visibleItems.filter((item) => item.status !== "done" && !item.archivedAt),
            state.categories,
          )
        : [],
    [state, visibleItems],
  );
  const doneGroups = useMemo(
    () => groupDoneItemsByLocalDate(visibleItems.filter((item) => item.status === "done" && !item.archivedAt)),
    [visibleItems],
  );
  const archivedGroups = useMemo(
    () =>
      state
        ? groupActiveItemsByCategory(
            visibleItems.filter((item) => !!item.archivedAt),
            state.categories,
          )
        : [],
    [state, visibleItems],
  );

  const runMove = useCallback(
    async (itemId: string, input: { categoryId?: string; beforeItemId?: string; afterItemId?: string }) => {
      try {
        applyState((await api.moveTodoItem(itemId, input)).state);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setDraggedItemId(null);
        setDropTarget(null);
      }
    },
    [applyState],
  );

  const toggleCompletion = useCallback(
    async (item: TodoItem) => {
      const response = await api.setTodoItemStatus(item.id, item.status === "done" ? "todo" : "done");
      applyState(response.state);
      if (item.status === "done") {
        setCompletionUndo((current) => (current?.itemId === item.id ? null : current));
      } else if (response.completionUndo) {
        setCompletionUndo({ ...response.completionUndo, title: deriveTodoMarkdown(item.markdown).titleMarkdown });
      }
    },
    [applyState],
  );

  const undoCompletion = useCallback(async () => {
    if (!completionUndo || undoBusy) return;
    setUndoBusy(true);
    try {
      const response = await api.undoTodoCompletion(completionUndo.itemId, completionUndo.token);
      applyState(response.state);
      setCompletionUndo(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUndoBusy(false);
    }
  }, [applyState, completionUndo, undoBusy]);

  const clearDrag = useCallback(() => {
    setDraggedItemId(null);
    setDropTarget(null);
  }, []);

  if (loading && !state)
    return (
      <div className="rounded-2xl border border-cc-border bg-cc-card px-4 py-12 text-center text-sm text-cc-muted">
        Loading personal to-dos…
      </div>
    );
  if (!state)
    return <ErrorBanner message={error || "Unable to load personal to-dos."} onDismiss={() => setError("")} />;

  const categories = activeTodoCategories(state);
  const activeGroupByCategory = new Map(activeGroups.map((group) => [group.categoryId, group]));
  const searching = !!search.trim();
  const shownCategories = categories.filter(
    (category) => !searching || (activeGroupByCategory.get(category.id)?.items.length ?? 0) > 0,
  );
  const showActiveOutline = statusFilter === "all" || statusFilter === "todo" || statusFilter === "doing";
  // A search or status filter shows every match; collapsing is for browsing the whole list.
  const isCollapsed = (categoryId: string) => !searching && statusFilter === "all" && collapsed.has(categoryId);
  const doneCount = doneGroups.reduce((total, group) => total + group.items.length, 0);

  const renderComposer = (target: ComposerTarget) => (
    <div className={target.top ? "" : "py-1"}>
      <TodoComposer
        key={`${target.categoryId}:${target.afterItemId ?? ""}:${target.top ? "top" : ""}`}
        categories={categories}
        categoryId={target.categoryId}
        afterItemId={target.afterItemId}
        onState={applyState}
        onClose={() => setComposer(null)}
      />
    </div>
  );

  const renderRow = (item: TodoItem, siblings: TodoItem[], categoryLabel?: string) => (
    <div key={item.id}>
      {dropTarget?.itemId === item.id && dropTarget.before && <TodoDropPlaceholder />}
      <TodoRow
        item={item}
        siblings={siblings}
        categoryLabel={categoryLabel}
        linkedQuests={linkedQuests}
        now={now}
        isDragging={draggedItemId === item.id}
        dropBefore={dropTarget?.itemId === item.id ? dropTarget.before : undefined}
        onState={applyState}
        onError={setError}
        onToggleCompletion={toggleCompletion}
        onInsertBelow={() => setComposer({ categoryId: item.categoryId, afterItemId: item.id })}
        onOpen={() => setSheetItemId(item.id)}
        onDragStart={(itemId) => {
          setDraggedItemId(itemId);
          setDropTarget(null);
        }}
        onDragHover={(target, before) => {
          if (!draggedItemId || draggedItemId === target.id) {
            setDropTarget(null);
            return;
          }
          setDropTarget({ categoryId: target.categoryId, itemId: target.id, before });
        }}
        onDragEnd={clearDrag}
        onDropItem={(target, before) => {
          if (!draggedItemId || draggedItemId === target.id) return;
          void runMove(draggedItemId, {
            categoryId: target.categoryId,
            ...(before ? { beforeItemId: target.id } : { afterItemId: target.id }),
          });
        }}
      />
      {dropTarget?.itemId === item.id && !dropTarget.before && <TodoDropPlaceholder />}
      {composer?.afterItemId === item.id && renderComposer(composer)}
    </div>
  );

  return (
    <section className="space-y-3" data-testid="todo-list-panel">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

      <div className="space-y-2">
        <div className="flex items-center gap-1.5">
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border border-cc-border bg-cc-bg px-2.5 text-cc-muted focus-within:border-cc-primary">
            <Icon path={ICONS.search} className="h-3.5 w-3.5 shrink-0" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search to-dos"
              aria-label="Search to-dos"
              className="min-w-0 flex-1 bg-transparent text-sm text-cc-fg outline-none placeholder:text-cc-muted"
            />
          </label>
          <button
            type="button"
            aria-label="Manage categories"
            aria-pressed={manageOpen}
            title="Manage categories"
            onClick={() => setManageOpen((value) => !value)}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${manageOpen ? "border-cc-primary/40 bg-cc-primary/10 text-cc-primary" : "border-cc-border text-cc-muted hover:text-cc-fg"}`}
          >
            <Icon path={ICONS.sliders} />
          </button>
          <button
            type="button"
            onClick={() =>
              setComposer((current) =>
                current?.top ? null : { categoryId: categories[0]?.id ?? "cat-inbox", top: true },
              )
            }
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-cc-primary px-3 text-sm text-white hover:bg-cc-primary-hover"
          >
            <Icon path={ICONS.plus} className="h-3.5 w-3.5" />
            New
          </button>
        </div>
        <StatusFilter value={statusFilter} counts={counts} onChange={setStatusFilter} />
        {manageOpen && <TodoManagementDrawer state={state} onState={applyState} onError={setError} />}
      </div>

      {composer?.top && renderComposer(composer)}

      {showActiveOutline && (
        <div className="space-y-2" aria-label="Active to-do outline">
          {shownCategories.map((category) => {
            const items = activeGroupByCategory.get(category.id)?.items ?? [];
            const hidden = isCollapsed(category.id);
            const overdueCount = hidden ? items.filter((item) => isTodoOverdue(item, now)).length : 0;
            return (
              <section
                key={category.id}
                aria-label={category.name}
                onDragOver={(event) => {
                  if (!draggedItemId) return;
                  event.preventDefault();
                  if ((event.target as HTMLElement).closest("[data-todo-id]")) return;
                  setDropTarget({ categoryId: category.id });
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  if (draggedItemId) void runMove(draggedItemId, { categoryId: category.id });
                }}
              >
                <SectionHeader
                  name={category.name}
                  count={items.length}
                  collapsed={hidden}
                  onToggle={() => toggleCollapsed(category.id)}
                  onAdd={() => setComposer({ categoryId: category.id })}
                >
                  {overdueCount > 0 && <span className="text-[11px] text-cc-error">{overdueCount} overdue</span>}
                </SectionHeader>
                {!hidden && <div>{items.map((item) => renderRow(item, items))}</div>}
                {dropTarget?.categoryId === category.id && !dropTarget.itemId && <TodoDropPlaceholder />}
                {composer?.categoryId === category.id &&
                  !composer.afterItemId &&
                  !composer.top &&
                  renderComposer(composer)}
              </section>
            );
          })}
        </div>
      )}

      {doneCount > 0 && (
        <details
          className="border-t border-cc-border pt-2"
          aria-label="Completed to-dos"
          data-testid="todo-done-section"
          open={statusFilter === "done" || undefined}
        >
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-md px-1 text-[13px] text-cc-muted hover:text-cc-fg [&::-webkit-details-marker]:hidden">
            <Icon path={ICONS.chevron} className="h-3 w-3" />
            <span className="font-medium">Done</span>
            <span className="text-[11px]">{doneCount}</span>
          </summary>
          <div className="space-y-2 pt-1">
            {doneGroups.map((group) => (
              <section key={group.dateKey}>
                <h4 className="px-2 pb-0.5 text-[11px] text-cc-muted">{group.label}</h4>
                {group.items.map((item) =>
                  renderRow(
                    item,
                    group.items,
                    categories.find((category) => category.id === item.categoryId)?.name ?? item.categoryId,
                  ),
                )}
              </section>
            ))}
          </div>
        </details>
      )}

      {statusFilter === "archived" && (
        <section className="space-y-2" aria-label="Archived to-dos">
          {archivedGroups.map((group) => (
            <div key={group.categoryId}>
              <h4 className="px-2 pb-0.5 text-[11px] text-cc-muted">{group.categoryName}</h4>
              {group.items.map((item) => renderRow(item, group.items))}
            </div>
          ))}
        </section>
      )}

      {visibleItems.length === 0 && (!showActiveOutline || shownCategories.length === 0) && (
        <div className="rounded-xl border border-dashed border-cc-border px-4 py-8 text-center text-sm text-cc-muted">
          No to-dos match these filters.
        </div>
      )}

      {completionUndo && (
        <div
          role="status"
          className="sticky bottom-3 z-20 mx-auto flex w-fit max-w-full items-center gap-3 rounded-full border border-cc-border bg-cc-card py-1.5 pl-4 pr-1.5 text-[13px] text-cc-fg shadow-lg"
        >
          <span className="min-w-0 truncate">Done: {completionUndo.title}</span>
          <button
            type="button"
            disabled={undoBusy}
            onClick={() => void undoCompletion()}
            className="shrink-0 rounded-full px-3 py-1 font-medium text-cc-primary hover:bg-cc-hover disabled:opacity-40"
          >
            {undoBusy ? "Undoing…" : "Undo"}
          </button>
          <button
            type="button"
            aria-label="Dismiss completion notice"
            onClick={() => setCompletionUndo(null)}
            className="shrink-0 rounded-full px-2 py-1 text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          >
            ×
          </button>
        </div>
      )}

      {sheetItemId && <TodoItemSheet itemId={sheetItemId} onClose={() => setSheetItemId(null)} onState={applyState} />}
    </section>
  );
}
