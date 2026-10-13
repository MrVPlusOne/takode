import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TodoLinkTarget } from "../../shared/todo-link.js";
import type {
  TodoItem,
  TodoProposal,
  TodoState,
  TodoStateMutationResponse,
  TodoStatus,
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

/** Where to-do previews read the list and send proposal decisions; the Playground swaps in mock data. */
export interface TodoLinkSource {
  loadState: () => Promise<TodoState>;
  resolve: (proposalId: string, decision: "approve" | "reject") => Promise<TodoStateMutationResponse>;
}

export const TodoLinkSourceContext = createContext<TodoLinkSource>({
  loadState: () => api.getTodoState(),
  resolve: (proposalId, decision) => api.resolveTodoProposal(proposalId, decision),
});

const TODOS_PAGE_HASH = "#/scheduled";
const INBOX_CATEGORY_ID = "cat-inbox";
const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };

/**
 * Inline link for `todo:td-<n>` (item) and `todo:tp-<n>` (proposal) hrefs. Clicking or tapping it
 * opens a preview, a bottom sheet on phones and a centered dialog on wider screens; a pending
 * proposal can be approved or rejected there. The href falls back to the to-dos page for new tabs.
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
        {children}
      </a>
      {open && <TodoPreview target={target} onClose={close} />}
    </>
  );
}

function TodoPreview({ target, onClose }: { target: TodoLinkTarget; onClose: () => void }) {
  const source = useContext(TodoLinkSourceContext);
  const [state, setState] = useState<TodoState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const action = usePendingAction("Could not update the proposal.");
  const panelRef = useRef<HTMLDivElement>(null);

  const applyState = useCallback((next: TodoState) => {
    setState((current) => (!current || next.revision >= current.revision ? next : current));
  }, []);

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
  const resolve = (next: "approve" | "reject") => {
    setDecision(next);
    void action.run(async () => applyState((await source.resolve(target.id, next)).state));
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[82] flex items-end justify-center bg-black/40 sm:items-center sm:p-6"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
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
          {item && <ItemStatusChip item={item} />}
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
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-3">
          {!state ? (
            <p className="py-2 text-[13px] italic text-cc-muted">
              {loadError ? `Could not load the proposal: ${loadError}` : "Loading proposal…"}
            </p>
          ) : proposal ? (
            <>
              <ProposalChange proposal={proposal} state={state} />
              <ProposalRequester proposal={proposal} onNavigate={onClose} />
            </>
          ) : item ? (
            <ItemDetails item={item} state={state} />
          ) : (
            <p className="py-2 text-[13px] italic text-cc-muted">
              {target.kind === "item" ? "To-do" : "Proposal"} {target.id} was not found.
            </p>
          )}
        </div>
        {item && (
          <PreviewFooter onClose={onClose}>
            {item.completedAt ? `Done ${timeAgo(item.completedAt)}` : `Updated ${timeAgo(item.updatedAt)}`}
          </PreviewFooter>
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
              <PreviewFooter onClose={onClose} bare>
                {proposal.status === "approved" ? "Approved" : "Rejected"}
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

/** The preview's bottom row: a status line and the way on to the full list. */
function PreviewFooter({
  children,
  onClose,
  bare = false,
}: {
  children: ReactNode;
  onClose: () => void;
  bare?: boolean;
}) {
  const row = (
    <div className="flex min-h-11 items-center justify-between gap-3 text-[13px] text-cc-muted">
      <span data-testid="todo-preview-footer-status">{children}</span>
      <a href={TODOS_PAGE_HASH} onClick={onClose} className="text-cc-primary hover:underline">
        Open to-dos
      </a>
    </div>
  );
  if (bare) return row;
  return (
    <div className="border-t border-cc-border/60 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">{row}</div>
  );
}

function ItemStatusChip({ item }: { item: TodoItem }) {
  const label = item.archivedAt ? "Archived" : STATUS_LABELS[item.status];
  const tone = item.archivedAt
    ? "bg-cc-hover text-cc-muted"
    : item.status === "done"
      ? "bg-cc-success/15 text-cc-success"
      : item.status === "doing"
        ? "bg-cc-primary/15 text-cc-primary"
        : "bg-cc-hover text-cc-fg";
  return (
    <span className={`rounded-full px-2 py-0.5 normal-case ${tone}`} data-testid="todo-preview-status">
      {label}
    </span>
  );
}

/** An existing to-do: its title and details, where it lives and the quests it is linked to. */
function ItemDetails({ item, state }: { item: TodoItem; state: TodoState }) {
  const category = state.categories.find((candidate) => candidate.id === item.categoryId)?.name ?? item.categoryId;
  const quests = (item.questIds ?? []).map((id) => `[${id}](quest:${id})`).join(", ");
  return (
    <div className="pt-1">
      <TodoBody markdown={item.markdown} />
      <div className="mt-2 text-[13px] text-cc-muted">In {category}</div>
      {quests && <MarkdownContent text={`Linked quests: ${quests}`} size="md" className="mt-1 text-cc-muted" />}
    </div>
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
