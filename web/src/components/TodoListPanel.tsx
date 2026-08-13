import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import {
  TODO_STATUSES,
  type TodoCategory,
  type TodoCompletionUndoHandle,
  type TodoItem,
  type TodoState,
  type TodoStatus,
} from "../../shared/todo-types.js";
import { api } from "../api.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { activeTodoCategories, TodoManagementDrawer } from "./TodoManagementDrawer.js";
import {
  filterTodoItems,
  groupActiveItemsByCategory,
  groupDoneItemsByLocalDate,
  type TodoStatusFilter,
} from "./todo-ui-utils.js";

const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };

function statusClasses(status: TodoStatus): string {
  if (status === "doing") return "text-amber-500";
  if (status === "done") return "text-emerald-500";
  return "text-sky-500";
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

function MarkdownEditor({
  initialValue,
  label,
  placeholder,
  onSave,
  onDiscard,
}: {
  initialValue: string;
  label: string;
  placeholder: string;
  onSave: (markdown: string) => Promise<void>;
  onDiscard: () => void;
}) {
  const [markdown, setMarkdown] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const savingRef = useRef(false);
  const valid = !!deriveTodoMarkdown(markdown).titleMarkdown;

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 44), 360)}px`;
  }, []);

  useEffect(() => {
    resize();
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(initialValue.length, initialValue.length);
  }, [initialValue.length, resize]);

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (markdown === initialValue) {
      onDiscard();
      return;
    }
    if (!valid) {
      setSaveError("Keep a non-empty title line before leaving this editor.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    setRecoveryMessage("");
    try {
      await onSave(markdown);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [initialValue, markdown, onDiscard, onSave, valid]);

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    void save();
  };

  const recoverDraft = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(markdown);
      setRecoveryMessage("Draft copied.");
    } catch {
      textareaRef.current?.focus();
      textareaRef.current?.select();
      setRecoveryMessage("Draft selected — copy it manually.");
    }
  };

  return (
    <div className="min-w-0 flex-1" onBlurCapture={handleBlur}>
      <textarea
        ref={textareaRef}
        value={markdown}
        disabled={saving}
        onChange={(event) => {
          setMarkdown(event.target.value);
          setSaveError("");
          setRecoveryMessage("");
          requestAnimationFrame(resize);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onDiscard();
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
        aria-label={label}
        placeholder={placeholder}
        className="block max-h-[360px] min-h-11 w-full resize-none overflow-y-auto rounded-lg border border-cc-primary/35 bg-cc-bg px-3 py-2 text-sm leading-relaxed text-cc-fg outline-none focus:border-cc-primary disabled:opacity-70"
      />
      <div className="mt-1.5 text-[10px] text-cc-muted">
        {saving ? "Saving…" : "Saves on click-away · first non-empty line is the title · Esc discards"}
      </div>
      {saveError && (
        <div
          role="alert"
          className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cc-error/30 bg-cc-error/10 px-2.5 py-2 text-xs text-cc-error"
        >
          <span>Save failed; your draft is still here. {saveError}</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void save()}
              className="rounded border border-cc-error/30 px-2 py-1 font-medium hover:bg-cc-error/10"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void recoverDraft()}
              className="rounded border border-cc-error/30 px-2 py-1 hover:bg-cc-error/10"
            >
              Copy draft
            </button>
          </div>
        </div>
      )}
      {recoveryMessage && (
        <p aria-live="polite" className="mt-1 text-[10px] text-cc-muted">
          {recoveryMessage}
        </p>
      )}
    </div>
  );
}

interface InsertTarget {
  categoryId: string;
  afterItemId?: string;
}

interface CompletionUndoNotice extends TodoCompletionUndoHandle {
  title: string;
}

interface DropTarget {
  categoryId: string;
  itemId?: string;
  before?: boolean;
}

function InlineComposer({
  target,
  onState,
  onClose,
}: {
  target: InsertTarget;
  onState: (state: TodoState) => void;
  onClose: () => void;
}) {
  return (
    <div className="ml-7 border-l border-cc-primary/30 py-1 pl-4">
      <MarkdownEditor
        initialValue=""
        label="New to-do Markdown"
        placeholder="New to-do\nOptional Markdown details"
        onDiscard={onClose}
        onSave={async (markdown) => {
          const response = await api.createTodoItem({
            markdown,
            categoryId: target.categoryId,
            status: "todo",
            ...(target.afterItemId ? { afterItemId: target.afterItemId } : {}),
          });
          onState(response.state);
          onClose();
        }}
      />
    </div>
  );
}

function shouldIgnoreRowShortcut(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("button,select,input,textarea,a,summary");
}

function TodoItemOverflow({
  item,
  categories,
  siblings,
  busy,
  onRun,
  onInsertBelow,
}: {
  item: TodoItem;
  categories: TodoCategory[];
  siblings: TodoItem[];
  busy: boolean;
  onRun: (action: () => Promise<{ state: TodoState }>) => void;
  onInsertBelow: () => void;
}) {
  const index = siblings.findIndex((candidate) => candidate.id === item.id);
  const active = !item.archivedAt && item.status !== "done";
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const closeMenu = () => {
    if (detailsRef.current) detailsRef.current.open = false;
  };
  const runAndClose = (action: () => Promise<{ state: TodoState }>) => {
    closeMenu();
    onRun(action);
  };
  return (
    <details ref={detailsRef} className="relative shrink-0">
      <summary
        aria-label={`More actions for ${deriveTodoMarkdown(item.markdown).titleMarkdown}`}
        className="list-none rounded-md px-2 py-1 text-sm tracking-widest text-cc-muted hover:bg-cc-bg hover:text-cc-fg [&::-webkit-details-marker]:hidden"
      >
        •••
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-2 rounded-xl border border-cc-border bg-cc-card p-3 shadow-xl">
        {active && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                runAndClose(() => api.setTodoItemStatus(item.id, item.status === "todo" ? "doing" : "todo"))
              }
              className="w-full rounded-lg border border-cc-border px-2 py-1.5 text-left text-xs text-cc-muted hover:text-cc-fg disabled:opacity-40"
            >
              {item.status === "todo" ? "Move to Doing" : "Move to Todo"}
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy || index <= 0}
                onClick={() => runAndClose(() => api.moveTodoItem(item.id, { beforeItemId: siblings[index - 1]?.id }))}
                className="rounded-lg border border-cc-border px-2 py-1.5 text-xs text-cc-muted hover:text-cc-fg disabled:opacity-35"
              >
                Move earlier
              </button>
              <button
                type="button"
                disabled={busy || index < 0 || index >= siblings.length - 1}
                onClick={() => runAndClose(() => api.moveTodoItem(item.id, { afterItemId: siblings[index + 1]?.id }))}
                className="rounded-lg border border-cc-border px-2 py-1.5 text-xs text-cc-muted hover:text-cc-fg disabled:opacity-35"
              >
                Move later
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                closeMenu();
                onInsertBelow();
              }}
              className="w-full rounded-lg border border-cc-border px-2 py-1.5 text-left text-xs text-cc-muted hover:text-cc-fg"
            >
              Add item below
            </button>
          </>
        )}
        {!item.archivedAt && (
          <label className="block text-[10px] font-medium uppercase tracking-wide text-cc-muted">
            Category
            <select
              aria-label={`Move ${item.id} to category`}
              value={item.categoryId}
              disabled={busy}
              onChange={(event) => runAndClose(() => api.moveTodoItem(item.id, { categoryId: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-cc-border bg-cc-bg px-2 py-1.5 text-xs normal-case tracking-normal text-cc-fg"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            runAndClose(() => (item.archivedAt ? api.restoreTodoItem(item.id) : api.archiveTodoItem(item.id)))
          }
          className="w-full rounded-lg border border-cc-border px-2 py-1.5 text-left text-xs text-cc-muted hover:text-cc-fg disabled:opacity-40"
        >
          {item.archivedAt ? "Restore item" : "Archive item"}
        </button>
        <p className="border-t border-cc-border pt-2 text-[10px] text-cc-muted">
          {item.id} · Updated {new Date(item.updatedAt).toLocaleString()}
        </p>
      </div>
    </details>
  );
}

function TodoOutlineRow({
  item,
  categories,
  siblings,
  categoryLabel,
  isDragging,
  dropBefore,
  onState,
  onError,
  onToggleCompletion,
  onInsertBelow,
  onDragStart,
  onDragHover,
  onDragEnd,
  onDropItem,
}: {
  item: TodoItem;
  categories: TodoCategory[];
  siblings: TodoItem[];
  categoryLabel?: string;
  isDragging: boolean;
  dropBefore?: boolean;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
  onToggleCompletion: (item: TodoItem) => Promise<void>;
  onInsertBelow: () => void;
  onDragStart: (itemId: string) => void;
  onDragHover: (target: TodoItem, before: boolean) => void;
  onDragEnd: () => void;
  onDropItem: (target: TodoItem, before: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const parts = useMemo(() => deriveTodoMarkdown(item.markdown), [item.markdown]);
  const active = !item.archivedAt && item.status !== "done";

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

  const toggleCompletion = () => {
    setBusy(true);
    void onToggleCompletion(item)
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false));
  };

  const editFromClick = (event: MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("a,button,select,summary")) return;
    setEditing(true);
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
      setEditing(true);
    }
  };

  return (
    <article
      data-todo-id={item.id}
      className={`group relative flex items-start gap-2 rounded-lg px-1 py-1.5 transition-colors hover:bg-cc-card/70 focus-within:bg-cc-card/70 ${item.archivedAt ? "opacity-65" : ""} ${isDragging ? "opacity-35" : ""}`}
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
      <button
        type="button"
        disabled={busy || editing || !!item.archivedAt}
        aria-label={item.status === "done" ? `Reopen ${parts.titleMarkdown}` : `Complete ${parts.titleMarkdown}`}
        onClick={toggleCompletion}
        className={`mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          item.status === "done"
            ? "border-emerald-500 bg-emerald-500 text-white"
            : item.status === "doing"
              ? "border-amber-500 text-amber-500 hover:border-emerald-500 hover:text-emerald-500"
              : "border-cc-muted/60 text-transparent hover:border-emerald-500"
        } disabled:opacity-40`}
      >
        {item.status === "doing" ? "•" : "✓"}
      </button>

      {parts.detailsMarkdown && (
        <button
          type="button"
          aria-label={`${expanded ? "Collapse" : "Expand"} details for ${parts.titleMarkdown}`}
          onClick={() => setExpanded((value) => !value)}
          className="mt-0.5 w-4 shrink-0 rounded text-xs text-cc-muted hover:text-cc-fg"
        >
          {expanded ? "▾" : "▸"}
        </button>
      )}
      {!parts.detailsMarkdown && <span className="w-4 shrink-0" />}

      {editing ? (
        <MarkdownEditor
          initialValue={item.markdown}
          label={`Edit ${parts.titleMarkdown}`}
          placeholder="Title\nOptional Markdown details"
          onDiscard={() => setEditing(false)}
          onSave={async (markdown) => {
            const response = await api.editTodoItem(item.id, { markdown });
            onState(response.state);
            setEditing(false);
          }}
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={`Edit ${parts.titleMarkdown}`}
          title={active ? "Click to edit · Alt+Enter adds below · Alt+↑/↓ reorders" : "Click to edit"}
          onClick={editFromClick}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 cursor-text rounded px-0.5 outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/50"
        >
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <MarkdownContent
              text={parts.titleMarkdown}
              size="md"
              variant="conservative"
              wrapLongContent
              stopLinkPropagation
              className={`min-w-0 font-medium ${item.status === "done" ? "text-cc-muted line-through decoration-cc-muted/50" : ""}`}
            />
          </div>
          {parts.detailsMarkdown && expanded && (
            <div className="mt-1.5 border-l border-cc-border pl-3 text-cc-muted">
              <MarkdownContent text={parts.detailsMarkdown} size="sm" wrapLongContent stopLinkPropagation />
            </div>
          )}
        </div>
      )}

      {!editing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {categoryLabel && (
            <span className="max-w-28 truncate px-1 text-[10px] text-cc-muted" title={categoryLabel}>
              {categoryLabel}
            </span>
          )}
          {active && (
            <button
              type="button"
              draggable
              aria-label={`Drag ${parts.titleMarkdown}`}
              title="Drag to reorder"
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
                const row = event.currentTarget.closest<HTMLElement>("[data-todo-id]");
                if (row) event.dataTransfer.setDragImage?.(row, 24, Math.min(row.offsetHeight / 2, 32));
                onDragStart(item.id);
              }}
              onDragEnd={onDragEnd}
              className="hidden cursor-grab rounded px-1 py-1 text-xs text-cc-muted opacity-50 hover:bg-cc-bg hover:opacity-100 sm:block"
            >
              ⠿
            </button>
          )}
          <TodoItemOverflow
            item={item}
            categories={categories}
            siblings={siblings}
            busy={busy}
            onRun={run}
            onInsertBelow={onInsertBelow}
          />
        </div>
      )}
    </article>
  );
}

function AddAtBottomButton({ categoryName, onClick }: { categoryName: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ml-7 mt-1 rounded px-2 py-1 text-left text-xs text-cc-muted/80 hover:bg-cc-card hover:text-cc-fg"
    >
      + Add to {categoryName}
    </button>
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

export function TodoListPanel() {
  const [state, setState] = useState<TodoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TodoStatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [manageOpen, setManageOpen] = useState(false);
  const [insertTarget, setInsertTarget] = useState<InsertTarget | null>(null);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [completionUndo, setCompletionUndo] = useState<CompletionUndoNotice | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);

  const applyState = useCallback((next: TodoState) => {
    setState((current) => (!current || next.revision >= current.revision ? next : current));
  }, []);
  const refresh = useCallback(() => {
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
    if (
      state &&
      categoryFilter !== "all" &&
      !state.categories.some((category) => category.id === categoryFilter && !category.archivedAt)
    ) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, state]);

  useEffect(() => {
    if (!completionUndo) return;
    const delay = Math.max(0, completionUndo.expiresAt - Date.now());
    const timeout = window.setTimeout(() => setCompletionUndo(null), delay);
    return () => window.clearTimeout(timeout);
  }, [completionUndo]);

  const counts = useMemo(() => {
    const current = state?.items.filter((item) => !item.archivedAt) ?? [];
    return Object.fromEntries(
      TODO_STATUSES.map((status) => [status, current.filter((item) => item.status === status).length]),
    ) as Record<TodoStatus, number>;
  }, [state]);
  const visibleItems = useMemo(
    () => (state ? filterTodoItems(state.items, { status: statusFilter, categoryId: categoryFilter, search }) : []),
    [categoryFilter, search, state, statusFilter],
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
        setCompletionUndo({
          ...response.completionUndo,
          title: deriveTodoMarkdown(item.markdown).titleMarkdown,
        });
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
  const pendingCount = state.proposals.filter((proposal) => proposal.status === "pending").length;
  const activeGroupByCategory = new Map(activeGroups.map((group) => [group.categoryId, group]));
  const shownCategories = categories.filter(
    (category) =>
      (categoryFilter === "all" || category.id === categoryFilter) &&
      (!search.trim() || (activeGroupByCategory.get(category.id)?.items.length ?? 0) > 0),
  );
  const showActiveOutline =
    statusFilter === "all" || statusFilter === "active" || statusFilter === "todo" || statusFilter === "doing";

  const renderRow = (item: TodoItem, siblings: TodoItem[], categoryLabel?: string) => (
    <div key={item.id}>
      {dropTarget?.itemId === item.id && dropTarget.before && <TodoDropPlaceholder />}
      <TodoOutlineRow
        item={item}
        categories={categories}
        siblings={siblings}
        categoryLabel={categoryLabel}
        isDragging={draggedItemId === item.id}
        dropBefore={dropTarget?.itemId === item.id ? dropTarget.before : undefined}
        onState={applyState}
        onError={setError}
        onToggleCompletion={toggleCompletion}
        onInsertBelow={() => setInsertTarget({ categoryId: item.categoryId, afterItemId: item.id })}
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
      {insertTarget?.afterItemId === item.id && (
        <InlineComposer target={insertTarget} onState={applyState} onClose={() => setInsertTarget(null)} />
      )}
    </div>
  );

  return (
    <section className="space-y-5" data-testid="todo-list-panel">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      {completionUndo && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-cc-fg"
        >
          <span>Moved “{completionUndo.title}” to Done.</span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={undoBusy}
              onClick={() => void undoCompletion()}
              className="rounded-lg border border-emerald-500/30 px-2.5 py-1 font-medium text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-400"
            >
              {undoBusy ? "Undoing…" : "Undo"}
            </button>
            <button
              type="button"
              aria-label="Dismiss completion notice"
              onClick={() => setCompletionUndo(null)}
              className="rounded px-1.5 py-1 text-cc-muted hover:bg-cc-card hover:text-cc-fg"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3 border-b border-cc-border pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-cc-fg">Personal To-dos</h2>
            <p className="mt-0.5 text-xs text-cc-muted">A durable Markdown outline for your own reminders.</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {TODO_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter((current) => (current === status ? "all" : status))}
                className={`rounded-full px-2.5 py-1 text-[11px] ${statusFilter === status ? `bg-cc-card font-semibold ${statusClasses(status)}` : "text-cc-muted hover:bg-cc-card hover:text-cc-fg"}`}
              >
                {STATUS_LABELS[status]} {counts[status]}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setManageOpen((value) => !value)}
              className={`rounded-lg border px-2.5 py-1 text-[11px] ${manageOpen ? "border-cc-primary/40 bg-cc-primary/10 text-cc-primary" : "border-cc-border text-cc-muted hover:text-cc-fg"}`}
            >
              Manage{pendingCount ? ` · ${pendingCount}` : ""}
            </button>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px_140px]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Markdown or links"
            aria-label="Search to-dos"
            className="rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg outline-none focus:border-cc-primary"
          />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
            className="rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            <option value="all">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TodoStatusFilter)}
            aria-label="Filter by status"
            className="rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            <option value="all">All current</option>
            <option value="active">Todo + Doing</option>
            {TODO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
            <option value="archived">Archived</option>
          </select>
        </div>
        {manageOpen && <TodoManagementDrawer state={state} onState={applyState} onError={setError} />}
      </div>

      {showActiveOutline && (
        <div className="space-y-5" aria-label="Active to-do outline">
          {shownCategories.map((category) => {
            const items = activeGroupByCategory.get(category.id)?.items ?? [];
            return (
              <section
                key={category.id}
                className="border-l border-cc-border pl-3 sm:pl-4"
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
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-sm font-medium text-cc-fg">{category.name}</h3>
                  <span className="text-[10px] text-cc-muted">{items.length}</span>
                </div>
                <div className="space-y-0.5">{items.map((item) => renderRow(item, items))}</div>
                {dropTarget?.categoryId === category.id && !dropTarget.itemId && <TodoDropPlaceholder />}
                {insertTarget?.categoryId === category.id && !insertTarget.afterItemId ? (
                  <InlineComposer target={insertTarget} onState={applyState} onClose={() => setInsertTarget(null)} />
                ) : (
                  <AddAtBottomButton
                    categoryName={category.name}
                    onClick={() => setInsertTarget({ categoryId: category.id })}
                  />
                )}
              </section>
            );
          })}
        </div>
      )}

      {doneGroups.length > 0 && (
        <details
          className="border-t border-cc-border pt-4"
          aria-label="Completed to-dos"
          data-testid="todo-done-section"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-2 text-sm font-medium text-cc-muted hover:text-cc-fg [&::-webkit-details-marker]:hidden">
            <span>▸ Done</span>
            <span className="text-xs font-normal">
              {doneGroups.reduce((total, group) => total + group.items.length, 0)}
            </span>
          </summary>
          <div className="space-y-4 pt-2">
            {doneGroups.map((group) => (
              <section key={group.dateKey} className="rounded-lg border border-cc-border/70 bg-cc-card/35 px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-semibold uppercase tracking-wide text-cc-muted">
                  <h4>{group.label}</h4>
                  <span>{group.items.length}</span>
                </div>
                <div className="space-y-0.5">
                  {group.items.map((item) =>
                    renderRow(
                      item,
                      group.items,
                      categories.find((category) => category.id === item.categoryId)?.name ?? item.categoryId,
                    ),
                  )}
                </div>
              </section>
            ))}
          </div>
        </details>
      )}

      {statusFilter === "archived" && (
        <section className="space-y-3 border-t border-cc-border pt-4" aria-label="Archived to-dos">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Archived</h3>
          {archivedGroups.map((group) => (
            <div key={group.categoryId} className="border-l border-cc-border pl-3">
              <h4 className="mb-1 text-xs font-medium text-cc-muted">{group.categoryName}</h4>
              {group.items.map((item) => renderRow(item, group.items, group.categoryName))}
            </div>
          ))}
        </section>
      )}

      {visibleItems.length === 0 && (!showActiveOutline || shownCategories.length === 0) && (
        <div className="rounded-xl border border-dashed border-cc-border px-4 py-8 text-center text-sm text-cc-muted">
          No to-dos match these filters.
        </div>
      )}
    </section>
  );
}
