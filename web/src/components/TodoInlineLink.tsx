import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TodoLinkTarget } from "../../shared/todo-link.js";
import { isTodoOverdue } from "../../shared/todo-due.js";
import {
  TODO_STATUSES,
  type TodoCompletionUndoHandle,
  type TodoItem,
  type TodoProposal,
  type TodoProposalDecision,
  type TodoState,
  type TodoStateMutationResponse,
  type TodoStatus,
} from "../../shared/todo-types.js";
import { deriveTodoMarkdown } from "../../shared/todo-markdown.js";
import { api } from "../api.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import { useSdkSessionRow } from "../hooks/useSdkSessionRow.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { CalendarIcon, formatTodoDue, TodoDueEditor } from "./TodoDueControls.js";
import { useTodoDueNow } from "./todo-due-clock.js";
import {
  applyTodoProposalStatuses,
  type TodoProposalStatus,
  type TodoProposalStatusSource,
  useTodoProposalStatus,
  watchTodoProposalStatuses,
} from "./todo-proposal-statuses.js";

/**
 * Where to-do links read proposal statuses and the list, send proposal decisions and change a to-do;
 * the Playground swaps in mock data.
 */
export interface TodoLinkSource extends TodoProposalStatusSource {
  loadState: () => Promise<TodoState>;
  resolve: (proposalId: string, decision: TodoProposalDecision) => Promise<TodoStateMutationResponse>;
  setItemStatus: (itemId: string, status: TodoStatus) => Promise<TodoStateMutationResponse>;
  editItem: (itemId: string, markdown: string) => Promise<TodoStateMutationResponse>;
  /** Set a due date, or clear it with `null`. */
  setItemDue: (itemId: string, due: string | null) => Promise<TodoStateMutationResponse>;
  undoCompletion: (itemId: string, token: string) => Promise<TodoStateMutationResponse>;
}

const SERVER_TODO_LINK_SOURCE: TodoLinkSource = {
  loadProposalStatuses: () => api.getTodoProposalStatuses(),
  loadState: () => api.getTodoState(),
  resolve: (proposalId, decision) => api.resolveTodoProposal(proposalId, decision),
  setItemStatus: (itemId, status) => api.setTodoItemStatus(itemId, status),
  editItem: (itemId, markdown) => api.editTodoItem(itemId, { markdown }),
  setItemDue: (itemId, due) => api.setTodoItemDue(itemId, due),
  undoCompletion: (itemId, token) => api.undoTodoCompletion(itemId, token),
};

export const TodoLinkSourceContext = createContext<TodoLinkSource>(SERVER_TODO_LINK_SOURCE);

/**
 * Load proposal statuses at app start, so proposal links in the first messages shown already have
 * their status marker instead of gaining it a moment later.
 */
export function preloadTodoProposalStatuses(): void {
  watchTodoProposalStatuses(SERVER_TODO_LINK_SOURCE);
}

const TODOS_PAGE_HASH = "#/scheduled";
const INBOX_CATEGORY_ID = "cat-inbox";
const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };

/**
 * Inline link for `todo:td-<n>` (item) and `todo:tp-<n>` (proposal) hrefs. A small leading marker
 * sets it apart from web links; a proposal's marker also shows whether it is pending, approved or
 * rejected. Clicking or tapping it opens a preview, a bottom sheet on phones and a centered dialog
 * on wider screens. A to-do can be edited, moved between Todo, Doing and Done and given a due date
 * there; a pending proposal can be approved, rejected or, when it adds a to-do, marked done. The
 * href falls back to the to-dos page for new tabs.
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
        title={target.kind === "item" ? "Preview to-do" : "Preview to-do proposal"}
        data-testid="todo-inline-link"
      >
        {target.kind === "item" ? <TodoItemMarker /> : <ProposalMarker proposalId={target.id} />}
        {children}
      </a>
      {open && <TodoPreview target={target} onClose={close} />}
    </>
  );
}

// A text-sized glyph with the same box in every state, so a status that loads or changes never
// moves the text around it.
const MARKER_CLASS = "mr-[0.2em] inline-block h-[1em] w-[1em] align-[-0.15em]";

const PROPOSAL_MARKER_COLORS: Record<TodoProposalStatus | "missing", string> = {
  pending: "text-cc-attention",
  approved: "text-cc-success",
  rejected: "text-cc-muted",
  missing: "text-cc-muted",
};

/** A small checklist: this link is one of the user's to-dos. */
function TodoItemMarker() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
      className={MARKER_CLASS}
      data-testid="todo-link-marker"
      data-marker="item"
    >
      <rect x="1.75" y="2.25" width="4.5" height="4.5" rx="1" />
      <rect x="1.75" y="9.25" width="4.5" height="4.5" rx="1" />
      <path d="M9 4.5h5.25M9 11.5h5.25" />
    </svg>
  );
}

/**
 * A circle that shows where the proposal stands: dashed with a plus while it waits for a decision
 * (amber, like other things waiting on the user), a green check once approved, a muted cross once
 * rejected. It stays invisible, but takes its space, until the statuses first load, so it never
 * shows a wrong state.
 */
function ProposalMarker({ proposalId }: { proposalId: string }) {
  const status = useTodoProposalStatus(useContext(TodoLinkSourceContext), proposalId);
  const resolved = status === "approved" || status === "rejected";
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`${MARKER_CLASS} ${status ? PROPOSAL_MARKER_COLORS[status] : "invisible"}`}
      data-testid="todo-link-marker"
      data-marker="proposal"
      data-status={status ?? "loading"}
    >
      <circle cx="8" cy="8" r="6.25" pathLength={40} strokeDasharray={resolved ? undefined : "3 2"} />
      {status === "approved" && <path d="M5.25 8.25l1.9 1.9 3.6-4" />}
      {status === "rejected" && <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />}
      {(status === "pending" || status === null) && <path d="M8 5.5v5M5.5 8h5" />}
    </svg>
  );
}

function TodoPreview({ target, onClose }: { target: TodoLinkTarget; onClose: () => void }) {
  const source = useContext(TodoLinkSourceContext);
  const [state, setState] = useState<TodoState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<TodoProposalDecision | null>(null);
  // An open text editor keeps the preview open on a stray backdrop tap, so a draft is not lost.
  const [editing, setEditing] = useState(false);
  const action = usePendingAction("Could not update the proposal.");
  const panelRef = useRef<HTMLDivElement>(null);

  const applyState = useCallback(
    (next: TodoState) => {
      setState((current) => (!current || next.revision >= current.revision ? next : current));
      // Keep the link markers in step with what the preview shows, e.g. right after a decision.
      applyTodoProposalStatuses(source, {
        statuses: Object.fromEntries(next.proposals.map((proposal) => [proposal.id, proposal.status])),
        revision: next.revision,
      });
    },
    [source],
  );

  useEffect(() => {
    // Keep the preview current while it is open, e.g. when the proposal is resolved elsewhere.
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

  const proposal =
    target.kind === "proposal" ? (state?.proposals.find((candidate) => candidate.id === target.id) ?? null) : null;
  const item = target.kind === "item" ? (state?.items.find((candidate) => candidate.id === target.id) ?? null) : null;
  const resolve = (next: TodoProposalDecision) => {
    setDecision(next);
    void action.run(async () => applyState((await source.resolve(target.id, next)).state));
  };

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
        aria-label={target.kind === "item" ? "To-do" : "To-do proposal"}
        tabIndex={-1}
        className="flex max-h-[85dvh] w-full flex-col rounded-t-2xl border border-cc-border bg-cc-card text-left shadow-2xl focus:outline-none sm:max-w-md sm:rounded-2xl"
        data-testid="todo-preview"
      >
        <div className="flex items-center gap-2 px-4 pt-3 text-[11px] text-cc-muted">
          <span className="uppercase tracking-wide">{target.kind === "item" ? "To-do" : "To-do proposal"}</span>
          {proposal && <ProposalStatusChip proposal={proposal} />}
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
          <ItemPreview item={item} state={state} onState={applyState} onClose={onClose} onEditingChange={setEditing} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
            {!state ? (
              <p className="py-2 text-[13px] italic text-cc-muted">
                {loadError
                  ? `Could not load the ${target.kind === "item" ? "to-do" : "proposal"}: ${loadError}`
                  : target.kind === "item"
                    ? "Loading to-do…"
                    : "Loading proposal…"}
              </p>
            ) : proposal ? (
              <>
                <ProposalChange proposal={proposal} state={state} />
                <ProposalRequester proposal={proposal} onNavigate={onClose} />
              </>
            ) : (
              <p className="py-2 text-[13px] italic text-cc-muted">
                {target.kind === "item" ? "To-do" : "Proposal"} {target.id} was not found.
              </p>
            )}
          </div>
        )}
        {proposal && (
          <div className="border-t border-cc-border/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
            {action.error && <p className="mb-2 text-xs text-cc-error">{action.error}</p>}
            {proposal.status === "pending" ? (
              // Approve sits last, at the right, where the right thumb reaches on a phone.
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => resolve("reject")}
                  disabled={action.pending}
                  aria-busy={action.pending && decision === "reject"}
                  className="inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-60"
                  data-testid="todo-proposal-reject"
                >
                  Reject
                </button>
                {/* For a to-do that was already done by the time the user read the proposal. */}
                {proposal.mutation.action === "item:add" && proposal.mutation.input.status !== "done" && (
                  <button
                    type="button"
                    onClick={() => resolve("mark-done")}
                    disabled={action.pending}
                    aria-busy={action.pending && decision === "mark-done"}
                    className="inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm text-cc-fg hover:bg-cc-hover disabled:opacity-60"
                    data-testid="todo-proposal-mark-done"
                  >
                    Mark as done
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => resolve("approve")}
                  disabled={action.pending}
                  aria-busy={action.pending && decision === "approve"}
                  className="inline-flex min-h-11 items-center rounded-lg bg-cc-primary px-5 text-sm font-semibold text-white hover:bg-cc-primary-hover disabled:opacity-60"
                  data-testid="todo-proposal-approve"
                >
                  Approve
                </button>
              </div>
            ) : (
              <PreviewFooter onClose={onClose}>
                {proposal.status === "rejected" ? "Rejected" : proposal.markedDone ? "Marked done" : "Approved"}
                {proposal.resolvedAt ? ` ${timeAgo(proposal.resolvedAt)}` : ""}
              </PreviewFooter>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The preview's status line and the way on to the full list. */
function PreviewFooter({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-[13px] text-cc-muted">
      <span data-testid="todo-preview-footer-status">{children}</span>
      <a href={TODOS_PAGE_HASH} onClick={onClose} className="text-cc-primary hover:underline">
        Open to-dos
      </a>
    </div>
  );
}

const STATUS_SELECTED_TONES: Record<TodoStatus, string> = {
  todo: "bg-cc-hover text-cc-fg",
  doing: "bg-cc-primary/15 text-cc-primary",
  done: "bg-cc-success/15 text-cc-success",
};

const SECONDARY_BUTTON_CLASS =
  "inline-flex min-h-11 items-center rounded-lg border border-cc-border px-4 text-sm text-cc-fg hover:bg-cc-hover disabled:opacity-60";

/**
 * An existing to-do: its text, where it lives, its due date and linked quests, with the changes the
 * To-dos page offers for it: edit the text, move it between Todo, Doing and Done (with a short Undo
 * after completing it) and set or clear the due date. These are the user's own actions, like the
 * page's. The status control sits at the bottom right, under the right thumb on a phone.
 */
function ItemPreview({
  item,
  state,
  onState,
  onClose,
  onEditingChange,
}: {
  item: TodoItem;
  state: TodoState;
  onState: (state: TodoState) => void;
  onClose: () => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const source = useContext(TodoLinkSourceContext);
  const action = usePendingAction("Could not update the to-do.");
  // Which control started the running action, so only that one shows it is waiting.
  const [busyControl, setBusyControl] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [dueOpen, setDueOpen] = useState(false);
  const [undo, setUndo] = useState<TodoCompletionUndoHandle | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  const current = !item.archivedAt && item.status !== "done";
  const now = useTodoDueNow(current && item.due ? [item.due] : []);
  const overdue = isTodoOverdue(item, now);
  const category = state.categories.find((candidate) => candidate.id === item.categoryId)?.name ?? item.categoryId;
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

  const setStatus = (status: TodoStatus) => {
    if (status === item.status) return;
    run(
      `status:${status}`,
      () => source.setItemStatus(item.id, status),
      (response) => setUndo(status === "done" ? (response.completionUndo ?? null) : null),
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

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-1">
        {editing ? (
          <textarea
            ref={textareaRef}
            value={draft}
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
        ) : (
          <TodoBody markdown={item.markdown} />
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[13px] text-cc-muted">
          <span>In {category}</span>
          {current && (
            <button
              type="button"
              onClick={() => setDueOpen((open) => !open)}
              aria-expanded={dueOpen}
              className={`-mx-1 inline-flex min-h-8 items-center gap-1 rounded-md px-1 hover:bg-cc-hover ${
                overdue ? "text-cc-error" : item.due ? "text-cc-fg" : "text-cc-muted hover:text-cc-fg"
              }`}
              data-testid="todo-preview-due"
            >
              <CalendarIcon className="h-3.5 w-3.5" />
              {item.due ? `${overdue ? "Overdue" : "Due"} ${formatTodoDue(item.due, now)}` : "Add due date"}
            </button>
          )}
        </div>
        {current && dueOpen && (
          <div className="mt-2 rounded-lg border border-cc-border p-2.5">
            <TodoDueEditor
              key={item.due ?? ""}
              due={item.due}
              busy={action.pending}
              onSet={(due) =>
                run(
                  "due",
                  () => source.setItemDue(item.id, due),
                  () => setDueOpen(false),
                )
              }
            />
          </div>
        )}
        {quests && <MarkdownContent text={`Linked quests: ${quests}`} size="md" className="mt-1 text-cc-muted" />}
      </div>
      <div className="border-t border-cc-border/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1">
        <PreviewFooter onClose={onClose}>
          {canUndo ? (
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
          )}
        </PreviewFooter>
        {action.error && (
          <p role="alert" className="mb-2 text-xs text-cc-error">
            {action.error}
          </p>
        )}
        {editing ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft(null)}
              disabled={action.pending}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={action.pending || !draftValid}
              aria-busy={busy("save") || undefined}
              className="inline-flex min-h-11 items-center rounded-lg bg-cc-primary px-5 text-sm font-semibold text-white hover:bg-cc-primary-hover disabled:opacity-60"
              data-testid="todo-preview-save"
            >
              Save
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                action.clearError();
                setDraft(item.markdown);
              }}
              className={SECONDARY_BUTTON_CLASS}
            >
              Edit
            </button>
            {!item.archivedAt && (
              <div role="group" aria-label="Status" className="flex rounded-lg border border-cc-border p-0.5">
                {TODO_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setStatus(status)}
                    disabled={action.pending && !busy(`status:${status}`)}
                    aria-pressed={item.status === status}
                    aria-busy={busy(`status:${status}`) || undefined}
                    className={`inline-flex min-h-10 items-center rounded-md px-3.5 text-sm disabled:opacity-60 ${
                      item.status === status ? STATUS_SELECTED_TONES[status] : "text-cc-muted hover:text-cc-fg"
                    }`}
                  >
                    {STATUS_LABELS[status]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

function ProposalStatusChip({ proposal }: { proposal: TodoProposal }) {
  const label = proposal.status === "pending" ? "Pending" : proposal.status === "approved" ? "Approved" : "Rejected";
  const tone =
    proposal.status === "pending"
      ? "bg-cc-warning/15 text-cc-warning"
      : proposal.status === "approved"
        ? "bg-cc-success/15 text-cc-success"
        : "bg-cc-hover text-cc-muted";
  return (
    <span className={`rounded-full px-2 py-0.5 normal-case ${tone}`} data-testid="todo-preview-status">
      {label}
    </span>
  );
}

/** What approving the proposal would change, with names resolved from the current list. */
function ProposalChange({ proposal, state }: { proposal: TodoProposal; state: TodoState }) {
  const mutation = proposal.mutation;
  const itemMarkdown = (itemId: string) => state.items.find((item) => item.id === itemId)?.markdown;
  const categoryName = (categoryId: string) =>
    state.categories.find((category) => category.id === categoryId)?.name ?? categoryId;

  switch (mutation.action) {
    case "item:add": {
      const { input } = mutation;
      const markdown = input.markdown ?? input.titleMarkdown ?? "";
      // Same category the server picks: the named one, else the ordering anchor's, else the inbox.
      const anchorId = input.beforeItemId ?? input.afterItemId;
      const categoryId =
        input.categoryId ?? state.items.find((item) => item.id === anchorId)?.categoryId ?? INBOX_CATEGORY_ID;
      const status = input.status && input.status !== "todo" ? `, ${STATUS_LABELS[input.status]}` : "";
      return (
        <ChangeLayout heading="Add to-do" note={`In ${categoryName(categoryId)}${status}`}>
          <TodoBody markdown={markdown} />
        </ChangeLayout>
      );
    }
    case "item:edit": {
      const proposed = mutation.input.markdown ?? mutation.input.titleMarkdown ?? "";
      const current = itemMarkdown(mutation.itemId);
      return (
        <ChangeLayout heading="Edit to-do">
          {/* Approval replaces whatever the to-do says now, so show that next to the proposed text. */}
          <SectionLabel>Current</SectionLabel>
          {current === undefined ? <MissingItem itemId={mutation.itemId} /> : <TodoBody markdown={current} muted />}
          <SectionLabel>Proposed</SectionLabel>
          <TodoBody markdown={proposed} />
        </ChangeLayout>
      );
    }
    case "item:status":
      return (
        <ItemChange
          heading={`Move to ${STATUS_LABELS[mutation.status]}`}
          markdown={itemMarkdown(mutation.itemId)}
          itemId={mutation.itemId}
        />
      );
    case "item:move":
      return (
        <ItemChange
          heading={mutation.categoryId ? `Move to ${categoryName(mutation.categoryId)}` : "Reorder to-do"}
          markdown={itemMarkdown(mutation.itemId)}
          itemId={mutation.itemId}
        />
      );
    case "item:archive":
      return <ItemChange heading="Archive to-do" markdown={itemMarkdown(mutation.itemId)} itemId={mutation.itemId} />;
    case "item:restore":
      return <ItemChange heading="Restore to-do" markdown={itemMarkdown(mutation.itemId)} itemId={mutation.itemId} />;
    case "item:link": {
      const added = mutation.addQuestIds ?? [];
      const removed = mutation.removeQuestIds ?? [];
      const questLinks = (ids: string[]) => ids.map((id) => `[${id}](quest:${id})`).join(", ");
      const note = [
        added.length ? `Link ${questLinks(added)}` : "",
        removed.length ? `Unlink ${questLinks(removed)}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      return (
        <ItemChange heading="Change quest links" markdown={itemMarkdown(mutation.itemId)} itemId={mutation.itemId}>
          <MarkdownContent text={note} size="md" />
        </ItemChange>
      );
    }
    case "category:create":
      return <ChangeLayout heading="Create category" title={mutation.input.name} />;
    case "category:rename":
      return (
        <ChangeLayout heading="Rename category" title={`${categoryName(mutation.categoryId)} → ${mutation.name}`} />
      );
    case "category:archive":
      return <ChangeLayout heading="Archive category" title={categoryName(mutation.categoryId)} />;
    case "category:restore":
      return <ChangeLayout heading="Restore category" title={categoryName(mutation.categoryId)} />;
  }
}

function ChangeLayout({
  heading,
  title,
  note,
  children,
}: {
  heading: string;
  title?: string;
  note?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pt-1">
      <div className="text-[13px] text-cc-muted">{heading}</div>
      {title && <div className="mt-1 text-[15px] font-semibold leading-snug text-cc-fg">{title}</div>}
      {children}
      {note && <div className="mt-2 text-[13px] text-cc-muted">{note}</div>}
    </div>
  );
}

function ItemChange({
  heading,
  markdown,
  itemId,
  children,
}: {
  heading: string;
  markdown: string | undefined;
  itemId: string;
  children?: ReactNode;
}) {
  return (
    <ChangeLayout heading={heading}>
      {markdown === undefined ? <MissingItem itemId={itemId} /> : <TodoBody markdown={markdown} />}
      {children && <div className="mt-2">{children}</div>}
    </ChangeLayout>
  );
}

/** A to-do's Markdown body: the first line as its title, later lines as details. */
function TodoBody({ markdown, muted = false }: { markdown: string; muted?: boolean }) {
  const { titleMarkdown, detailsMarkdown } = deriveTodoMarkdown(markdown);
  return (
    <div className={`mt-1 ${muted ? "opacity-70" : ""}`}>
      <MarkdownContent text={titleMarkdown} className="font-semibold" />
      {detailsMarkdown && <MarkdownContent text={detailsMarkdown} size="md" className="mt-1" />}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="mt-3 text-[11px] uppercase tracking-wide text-cc-muted">{children}</div>;
}

function MissingItem({ itemId }: { itemId: string }) {
  return <p className="mt-1 text-[13px] italic text-cc-muted">To-do {itemId} no longer exists.</p>;
}

function ProposalRequester({ proposal, onNavigate }: { proposal: TodoProposal; onNavigate: () => void }) {
  const requester = proposal.requestedBy;
  const session = useSdkSessionRow(requester.sessionId ?? null);
  return (
    <div className="mt-3 text-[12px] text-cc-muted">
      Proposed {timeAgo(proposal.createdAt)} by{" "}
      {session ? (
        <SessionInlineLink
          sessionId={session.sessionId}
          sessionNum={session.sessionNum}
          className="text-cc-primary hover:underline"
          onNavigate={onNavigate}
        >
          {session.sessionNum != null ? `#${session.sessionNum}` : "session"}
          {session.name ? ` ${session.name}` : ""}
        </SessionInlineLink>
      ) : (
        // A session's label is its name, or its number when it has none.
        (requester.label?.replace(/^\d+$/, "#$&") ?? requester.kind)
      )}
    </div>
  );
}
