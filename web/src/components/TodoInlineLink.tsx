import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { summarizeTodoItems, todoLinkSummary, type TodoLinkTarget } from "../../shared/todo-link.js";
import { isTodoOverdue } from "../../shared/todo-due.js";
import {
  type TodoCompletionUndoHandle,
  type TodoItem,
  type TodoItemMoveInput,
  type TodoState,
  type TodoStateMutationResponse,
  type TodoStatus,
} from "../../shared/todo-types.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import { api } from "../api.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { celebrationAnchor, playCompletionCelebration } from "./completion-celebration.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";
import { TODO_SELECT_CLASS } from "./TodoComposer.js";
import { CalendarIcon, formatTodoDue, TodoDueQuickPicks } from "./TodoDueControls.js";
import { useTodoDueNow } from "./todo-due-clock.js";
import {
  applyTodoItemSummaries,
  SERVER_TODO_ITEM_SUMMARIES,
  type TodoItemSummarySource,
  useTodoItemSummaries,
} from "./todo-item-summaries.js";
import { TodoItemDesktopLayout, type TodoItemParts, TodoStatusControl } from "./TodoItemDesktopLayout.js";
import { TodoProvenance } from "./TodoProvenance.js";

/** Where to-do links read statuses and the list and change a to-do; the Playground swaps in mock data. */
export interface TodoLinkSource {
  /** Every to-do's status for the markers, shared with the overdue count. */
  itemSummaries: TodoItemSummarySource;
  loadState: () => Promise<TodoState>;
  setItemStatus: (itemId: string, status: TodoStatus) => Promise<TodoStateMutationResponse>;
  editItem: (itemId: string, markdown: string) => Promise<TodoStateMutationResponse>;
  /** Set a due date, or clear it with `null`. */
  setItemDue: (itemId: string, due: string | null) => Promise<TodoStateMutationResponse>;
  undoCompletion: (itemId: string, token: string) => Promise<TodoStateMutationResponse>;
  /** Move to another category or position. */
  moveItem: (itemId: string, input: TodoItemMoveInput) => Promise<TodoStateMutationResponse>;
  setItemArchived: (itemId: string, archived: boolean) => Promise<TodoStateMutationResponse>;
}

const SERVER_TODO_LINK_SOURCE: TodoLinkSource = {
  itemSummaries: SERVER_TODO_ITEM_SUMMARIES,
  loadState: () => api.getTodoState(),
  setItemStatus: (itemId, status) => api.setTodoItemStatus(itemId, status),
  editItem: (itemId, markdown) => api.editTodoItem(itemId, { markdown }),
  setItemDue: (itemId, due) => api.setTodoItemDue(itemId, due),
  undoCompletion: (itemId, token) => api.undoTodoCompletion(itemId, token),
  moveItem: (itemId, input) => api.moveTodoItem(itemId, input),
  setItemArchived: (itemId, archived) => (archived ? api.archiveTodoItem(itemId) : api.restoreTodoItem(itemId)),
};

export const TodoLinkSourceContext = createContext<TodoLinkSource>(SERVER_TODO_LINK_SOURCE);

const TODOS_PAGE_HASH = "#/scheduled";
const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };

/**
 * Inline link for `todo:td-<n>` hrefs, and for `todo:tp-<n>` links to retired to-do proposals in
 * older messages. A small leading marker shows the to-do's current status and sets the link apart
 * from web links. Clicking or tapping it opens a preview, a bottom sheet on phones and a centered
 * dialog on wider screens, where the to-do can be edited, moved between Todo, Doing and Done and
 * given a due date. A proposal link stands for the to-do its approval created, if any. The href
 * falls back to the to-dos page for new tabs.
 */
export function TodoInlineLink({
  target,
  children,
  className,
  stopPropagation = false,
}: {
  target: TodoLinkTarget;
  children: ReactNode;
  className?: string;
  stopPropagation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const status = useTodoLinkStatus(target);
  return (
    <>
      <a
        href={TODOS_PAGE_HASH}
        onClick={(event) => {
          if (stopPropagation) event.stopPropagation();
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setOpen(true);
        }}
        className={className ?? "text-cc-primary hover:underline"}
        title={status ? `Preview to-do · ${LINK_STATUS_LABELS[status]}` : "Preview to-do"}
        data-testid="todo-inline-link"
      >
        <TodoLinkMarker status={status} />
        {children}
      </a>
      {open && <TodoPreview target={target} onClose={close} />}
    </>
  );
}

/** What a to-do link's marker shows; `null` until the statuses first load. */
type TodoLinkStatus = TodoStatus | "overdue-todo" | "overdue-doing" | "archived" | "missing";

const LINK_STATUS_LABELS: Record<TodoLinkStatus, string> = {
  ...STATUS_LABELS,
  "overdue-todo": "Overdue",
  "overdue-doing": "Doing, overdue",
  archived: "Archived",
  missing: "Not found",
};

function useTodoLinkStatus(target: TodoLinkTarget): TodoLinkStatus | null {
  const summaries = useTodoItemSummaries(useContext(TodoLinkSourceContext).itemSummaries);
  const item = summaries && todoLinkSummary(summaries, target);
  // Only a current to-do with a due date needs the clock, to turn overdue the moment it passes.
  const now = useTodoDueNow(item?.due && item.status !== "done" && !item.archivedAt ? [item.due] : []);
  if (!summaries) return null;
  if (!item) return "missing";
  if (item.archivedAt) return "archived";
  if (isTodoOverdue(item, now)) return item.status === "doing" ? "overdue-doing" : "overdue-todo";
  return item.status;
}

/**
 * A text-sized circle in the To-dos page's colors: an empty ring for Todo, an amber ring with a dot
 * for Doing, a filled green check for Done, the ring or dot in red once overdue. An archived to-do
 * gets a muted box, a missing one a muted dashed ring. Every state has the same box, and until the
 * statuses first load the marker is invisible but keeps its space, so nothing moves or shows a
 * wrong state.
 */
function TodoLinkMarker({ status }: { status: TodoLinkStatus | null }) {
  const shape = status ?? "todo";
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`mr-[0.2em] inline-block h-[1em] w-[1em] align-[-0.15em] ${status ? MARKER_COLORS[status] : "invisible"}`}
      data-testid="todo-link-marker"
      data-status={status ?? "loading"}
    >
      {shape === "archived" ? (
        <>
          <rect x="2" y="3" width="12" height="3.25" rx="0.75" />
          <path d="M3.25 6.25v6a1 1 0 0 0 1 1h7.5a1 1 0 0 0 1-1v-6M6.5 9h3" />
        </>
      ) : shape === "done" ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="none" />
          <path d="M5.25 8.25l1.9 1.9 3.6-4" stroke="white" strokeWidth="1.75" />
        </>
      ) : (
        <>
          <circle cx="8" cy="8" r="6.25" pathLength={40} strokeDasharray={shape === "missing" ? "3 2" : undefined} />
          {(shape === "doing" || shape === "overdue-doing") && (
            <circle cx="8" cy="8" r="2.5" fill="currentColor" stroke="none" />
          )}
        </>
      )}
    </svg>
  );
}

const MARKER_COLORS: Record<TodoLinkStatus, string> = {
  todo: "text-cc-muted",
  doing: "text-amber-500",
  done: "text-emerald-500",
  "overdue-todo": "text-cc-error",
  "overdue-doing": "text-cc-error",
  archived: "text-cc-muted",
  missing: "text-cc-muted",
};

/**
 * The to-do sheet opened from a row of the To-dos page: the link preview, plus moving the to-do up
 * or down in its category, and without the way on to the page it is already on.
 */
export function TodoItemSheet({
  itemId,
  onClose,
  onState,
}: {
  itemId: string;
  onClose: () => void;
  /** The page's own list, kept in step with changes made in the sheet. */
  onState: (state: TodoState) => void;
}) {
  return <TodoPreview target={{ kind: "item", id: itemId }} onClose={onClose} onPage onState={onState} />;
}

function TodoPreview({
  target,
  onClose,
  onPage = false,
  onState,
}: {
  target: TodoLinkTarget;
  onClose: () => void;
  onPage?: boolean;
  onState?: (state: TodoState) => void;
}) {
  const source = useContext(TodoLinkSourceContext);
  const [state, setState] = useState<TodoState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // An open text editor keeps the preview open on a stray backdrop tap, so a draft is not lost.
  const [editing, setEditing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const applyState = useCallback(
    (next: TodoState) => {
      setState((current) => (!current || next.revision >= current.revision ? next : current));
      // Keep link markers and the overdue count in step with the preview, e.g. right after marking it done.
      applyTodoItemSummaries(source.itemSummaries, summarizeTodoItems(next));
      onState?.(next);
    },
    [onState, source],
  );

  useEffect(() => {
    // Keep the preview current while it is open, e.g. when the to-do changes elsewhere.
    const load = () =>
      source
        .loadState()
        .then((next) => {
          applyState(next);
          setLoadError(null);
        })
        .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
    void load();
    window.addEventListener(TODO_STATE_UPDATED_EVENT, load);
    return () => window.removeEventListener(TODO_STATE_UPDATED_EVENT, load);
  }, [applyState, source]);

  useEffect(() => {
    panelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  usePreviewSheetHistoryEntry(true, panelRef, onClose);
  // The desktop shell gets the wide side-panel layout; phones keep the one-column sheet.
  const desktop = useDesktopShellLayout();

  // A retired proposal link shows the to-do its approval created; the to-do records the proposal.
  const item =
    state?.items.find((candidate) =>
      target.kind === "item" ? candidate.id === target.id : candidate.createdBy.authorization.proposalId === target.id,
    ) ?? null;

  return createPortal(
    <div
      className="fixed inset-0 z-[82] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget && !editing) onClose();
      }}
      data-testid="todo-preview-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="To-do"
        tabIndex={-1}
        className={`flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-cc-border bg-cc-card text-left shadow-2xl focus:outline-none sm:rounded-2xl ${desktop ? "sm:max-w-[60rem]" : "sm:max-w-md"}`}
        data-testid="todo-preview"
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[11px] text-cc-muted">
          <span className="uppercase tracking-wide">To-do</span>
          {/* A current to-do shows its status in the status control at the bottom instead. */}
          {item?.archivedAt && (
            <span
              className="rounded-full bg-cc-hover px-2 py-0.5 normal-case text-cc-muted"
              data-testid="todo-preview-status"
            >
              Archived
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="-mr-2 ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
              <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        {state && item ? (
          <ItemPreview
            desktop={desktop}
            item={item}
            state={state}
            onPage={onPage}
            onState={applyState}
            onClose={onClose}
            onEditingChange={setEditing}
          />
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
              <p className="py-2 text-[13px] italic text-cc-muted">
                {!state
                  ? loadError
                    ? `Could not load the to-do: ${loadError}`
                    : "Loading to-do…"
                  : target.kind === "item"
                    ? `To-do ${target.id} was not found.`
                    : "This was a suggestion to add a to-do, a feature Takode no longer has. It wasn't added to your list."}
              </p>
            </div>
            {state && (
              <div className="border-t border-cc-border/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
                <PreviewFooter pageLink={onPage ? null : <OpenTodosLink onClose={onClose} />} />
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The preview's status line and, outside the To-dos page, the way on to the full list. */
function PreviewFooter({ children, pageLink }: { children?: ReactNode; pageLink: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-[13px] text-cc-muted">
      <span data-testid="todo-preview-footer-status">{children}</span>
      {pageLink}
    </div>
  );
}

/** The way on from a to-do link's preview to the full list. */
function OpenTodosLink({ onClose }: { onClose: () => void }) {
  return (
    <a href={TODOS_PAGE_HASH} onClick={onClose} className="text-cc-primary hover:underline">
      Open to-dos
    </a>
  );
}

const SMALL_BUTTON_CLASS =
  "inline-flex min-h-8 items-center justify-center rounded-lg border border-cc-border px-2 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-40 pointer-coarse:min-h-10";

const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm text-cc-fg hover:bg-cc-hover disabled:opacity-60";

/**
 * An existing to-do: its text, where it lives, its due date and linked quests, with the changes the
 * To-dos page offers for it: edit the text, move it between Todo, Doing and Done (with a short Undo
 * after completing it) and set or clear the due date. These are the user's own actions, like the
 * page's. It builds each part once and lays them out for a phone or a desktop screen.
 */
function ItemPreview({
  desktop,
  item,
  state,
  onPage,
  onState,
  onClose,
  onEditingChange,
}: {
  /** Lay the sheet out for a desktop screen rather than a phone. */
  desktop: boolean;
  item: TodoItem;
  state: TodoState;
  onPage: boolean;
  onState: (state: TodoState) => void;
  onClose: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const source = useContext(TodoLinkSourceContext);
  const action = usePendingAction("Could not update the to-do.");
  // Which control started the running action, so only that one shows it is waiting.
  const [busyControl, setBusyControl] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [undo, setUndo] = useState<TodoCompletionUndoHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  const current = !item.archivedAt && item.status !== "done";
  const now = useTodoDueNow(current && item.due ? [item.due] : []);
  const overdue = isTodoOverdue(item, now);
  const categories = state.categories.filter((candidate) => !candidate.archivedAt || candidate.id === item.categoryId);
  // Neighbours in the same category, in the page's order, for moving up and down.
  const siblings = state.items
    .filter(
      (candidate) => candidate.categoryId === item.categoryId && !candidate.archivedAt && candidate.status !== "done",
    )
    .sort((a, b) => a.rank - b.rank || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const index = siblings.findIndex((candidate) => candidate.id === item.id);
  const quests = (item.questIds ?? []).map((id) => `[${id}](quest:${id})`).join(", ");
  // The receipt expires on a timer below; it only applies while the to-do is still Done.
  const canUndo = !!undo && item.status === "done";

  useEffect(() => {
    onEditingChange(editing);
    return () => onEditingChange(false);
  }, [editing, onEditingChange]);

  useEffect(() => {
    if (!undo) return;
    const timeout = window.setTimeout(() => setUndo(null), Math.max(0, undo.expiresAt - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [undo]);

  const resizeEditor = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    // The height includes the border, which scrollHeight leaves out.
    const border = textarea.offsetHeight - textarea.clientHeight;
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight + border, 44), 320)}px`;
  }, []);

  useEffect(() => {
    if (!editing) return;
    const textarea = textareaRef.current;
    resizeEditor();
    textarea?.focus();
    textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [editing, resizeEditor]);

  const run = (
    control: string,
    change: () => Promise<TodoStateMutationResponse>,
    after?: (response: TodoStateMutationResponse) => void,
  ) => {
    setBusyControl(control);
    void action.run(async () => {
      const response = await change();
      onState(response.state);
      after?.(response);
    });
  };
  const busy = (control: string) => action.pending && busyControl === control;

  const setStatus = (status: TodoStatus, control: Element) => {
    if (status === item.status) return;
    const celebrateAt = status === "done" ? celebrationAnchor(control) : null;
    run(
      `status:${status}`,
      () => source.setItemStatus(item.id, status),
      (response) => {
        setUndo(status === "done" ? (response.completionUndo ?? null) : null);
        if (status === "done") playCompletionCelebration(celebrateAt);
      },
    );
  };
  const draftValid = draft !== null && !!deriveTodoMarkdown(draft).titleMarkdown;
  const saveDraft = () => {
    if (draft === null || !draftValid) return;
    if (draft === item.markdown) {
      setDraft(null);
      return;
    }
    run(
      "save",
      () => source.editItem(item.id, draft),
      () => setDraft(null),
    );
  };

  const editor = (
    <textarea
      ref={textareaRef}
      value={draft ?? ""}
      disabled={busy("save")}
      onChange={(event) => {
        setDraft(event.target.value);
        requestAnimationFrame(resizeEditor);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          // Escape leaves the editor, not the whole preview, as on the To-dos page.
          event.preventDefault();
          event.stopPropagation();
          setDraft(null);
        } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          saveDraft();
        }
      }}
      aria-label="To-do text"
      placeholder={"Title\nOptional Markdown details"}
      className="mt-1 block max-h-80 min-h-11 w-full resize-none overflow-y-auto rounded-lg border border-cc-primary/35 bg-cc-bg px-3 py-2 text-sm leading-relaxed text-cc-fg outline-none focus:border-cc-primary disabled:opacity-70"
    />
  );
  const parts: TodoItemParts = {
    editing,
    pending: action.pending,
    content: editing ? editor : <TodoBody markdown={item.markdown} />,
    category: item.archivedAt ? (
      <span className="text-cc-fg">
        {categories.find((candidate) => candidate.id === item.categoryId)?.name ?? item.categoryId}
      </span>
    ) : (
      <select
        aria-label="Category"
        value={item.categoryId}
        disabled={action.pending}
        onChange={(event) => run("category", () => source.moveItem(item.id, { categoryId: event.target.value }))}
        className={`${TODO_SELECT_CLASS} w-full`}
      >
        {categories.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
    ),
    due: current ? (
      <div className="space-y-2">
        <TodoDueQuickPicks
          due={item.due}
          busy={action.pending}
          now={now}
          onSet={(due) => run("due", () => source.setItemDue(item.id, due))}
        />
        {item.due && (
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1 ${overdue ? "text-cc-error" : "text-cc-fg"}`}
              data-testid="todo-preview-due"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {`${overdue ? "Overdue" : "Due"} ${formatTodoDue(item.due, now)}`}
            </span>
            <button
              type="button"
              disabled={action.pending}
              onClick={() => run("due", () => source.setItemDue(item.id, null))}
              className="rounded-md px-1.5 py-0.5 text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-40"
            >
              Clear
            </button>
          </div>
        )}
      </div>
    ) : null,
    quests: quests ? <MarkdownContent text={quests} size="md" /> : null,
    // Moving and archiving are the page's own changes, so the link preview leaves them out.
    moveUp:
      onPage && current
        ? {
            disabled: action.pending || index <= 0,
            run: () => run("up", () => source.moveItem(item.id, { beforeItemId: siblings[index - 1]!.id })),
          }
        : null,
    moveDown:
      onPage && current
        ? {
            disabled: action.pending || index < 0 || index >= siblings.length - 1,
            run: () => run("down", () => source.moveItem(item.id, { afterItemId: siblings[index + 1]!.id })),
          }
        : null,
    archive: onPage
      ? {
          label: item.archivedAt ? "Restore" : "Archive",
          disabled: action.pending,
          run: () => run("archive", () => source.setItemArchived(item.id, !item.archivedAt)),
        }
      : null,
    provenance: <TodoProvenance item={item} onNavigate={onClose} className="space-y-0.5 text-[12px] text-cc-muted" />,
    footerStatus: canUndo ? (
      <>
        Moved to Done ·{" "}
        <button
          type="button"
          onClick={() =>
            run(
              "undo",
              () => source.undoCompletion(item.id, undo!.token),
              () => setUndo(null),
            )
          }
          disabled={action.pending}
          aria-busy={busy("undo") || undefined}
          className="text-cc-primary hover:underline"
        >
          Undo
        </button>
      </>
    ) : item.completedAt ? (
      `Done ${timeAgo(item.completedAt)}`
    ) : (
      `Updated ${timeAgo(item.updatedAt)}`
    ),
    pageLink: onPage ? null : <OpenTodosLink onClose={onClose} />,
    error: action.error ? (
      <p role="alert" className="text-xs text-cc-error">
        {action.error}
      </p>
    ) : null,
    startEdit: () => {
      action.clearError();
      setDraft(item.markdown);
    },
    cancelEdit: () => setDraft(null),
    saveEdit: { disabled: action.pending || !draftValid, busy: busy("save"), run: saveDraft },
    status: item.archivedAt
      ? null
      : {
          value: item.status,
          set: setStatus,
          disabled: (status) => action.pending && !busy(`status:${status}`),
          busy: (status) => busy(`status:${status}`),
        },
  };

  return desktop ? <TodoItemDesktopLayout parts={parts} /> : <PhoneItemLayout parts={parts} />;
}

/** The phone layout: one column, with Edit and the status control at the bottom, under the thumb. */
function PhoneItemLayout({ parts }: { parts: TodoItemParts }) {
  const { content, category, due, quests, moveUp, moveDown, archive, status } = parts;
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
        {content}
        {/* Label and control columns, so every setting lines up. */}
        <div className="mt-3 grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2 text-[13px]">
          <span className="text-cc-muted">Category</span>
          {category}
          {due && (
            <>
              <span className="self-start pt-1.5 text-cc-muted pointer-coarse:pt-2.5">Due</span>
              {due}
            </>
          )}
          {quests && (
            <>
              <span className="text-cc-muted">Quests</span>
              {quests}
            </>
          )}
        </div>
        {archive && (
          <div className={`mt-3 grid gap-1.5 ${moveUp ? "grid-cols-3" : "grid-cols-1"}`}>
            {moveUp && moveDown && (
              <>
                <button type="button" disabled={moveUp.disabled} onClick={moveUp.run} className={SMALL_BUTTON_CLASS}>
                  ↑ Move up
                </button>
                <button
                  type="button"
                  disabled={moveDown.disabled}
                  onClick={moveDown.run}
                  className={SMALL_BUTTON_CLASS}
                >
                  ↓ Move down
                </button>
              </>
            )}
            <button type="button" disabled={archive.disabled} onClick={archive.run} className={SMALL_BUTTON_CLASS}>
              {archive.label}
            </button>
          </div>
        )}
        <div className="mt-2 empty:hidden">{parts.provenance}</div>
      </div>
      <div className="border-t border-cc-border/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <PreviewFooter pageLink={parts.pageLink}>{parts.footerStatus}</PreviewFooter>
        {parts.error && <div className="mb-2">{parts.error}</div>}
        {parts.editing ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={parts.cancelEdit}
              disabled={parts.pending}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={parts.saveEdit.run}
              disabled={parts.saveEdit.disabled}
              aria-busy={parts.saveEdit.busy || undefined}
              className="inline-flex min-h-11 items-center rounded-lg bg-cc-primary px-5 text-sm font-semibold text-white hover:bg-cc-primary-hover disabled:opacity-60"
              data-testid="todo-preview-save"
            >
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={parts.startEdit} className={SECONDARY_BUTTON_CLASS}>
              Edit
            </button>
            {status && <TodoStatusControl status={status} size="phone" />}
          </div>
        )}
      </div>
    </>
  );
}

/** A to-do's Markdown body: the first line as its title, later lines as details. */
function TodoBody({ markdown }: { markdown: string }) {
  const { titleMarkdown, detailsMarkdown } = deriveTodoMarkdown(markdown);
  return (
    <div className="mt-1">
      <MarkdownContent text={titleMarkdown} className="font-semibold" />
      {detailsMarkdown && <MarkdownContent text={detailsMarkdown} size="md" className="mt-1" />}
    </div>
  );
}
