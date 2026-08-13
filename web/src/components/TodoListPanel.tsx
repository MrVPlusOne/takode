import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TODO_GRANT_ACTIONS,
  TODO_STATUSES,
  type TodoCategory,
  type TodoGrantAction,
  type TodoItem,
  type TodoPrincipal,
  type TodoState,
  type TodoStatus,
} from "../../shared/todo-types.js";
import { api } from "../api.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";
import { MarkdownContent } from "./MarkdownContent.js";
import {
  filterTodoItems,
  groupActiveItemsByCategory,
  groupDoneItemsByLocalDate,
  todoProposalSummary,
  type TodoStatusFilter,
} from "./todo-ui-utils.js";

const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Todo", doing: "Doing", done: "Done" };
const ACTION_LABELS: Record<TodoGrantAction, string> = {
  "item:add": "Add items",
  "item:edit": "Edit content",
  "item:status": "Change status",
  "item:move": "Move categories",
  "item:archive": "Archive items",
  "item:restore": "Restore items",
  "category:create": "Create categories",
  "category:rename": "Rename categories",
  "category:archive": "Archive categories",
  "category:restore": "Restore categories",
};

function statusClasses(status: TodoStatus): string {
  if (status === "doing") return "border-amber-500/30 bg-amber-500/10 text-amber-500";
  if (status === "done") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-500";
  return "border-sky-500/30 bg-sky-500/10 text-sky-500";
}

function formatUpdated(epochMs: number): string {
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    Math.round((epochMs - Date.now()) / 86_400_000),
    "day",
  );
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

function TodoItemRow({
  item,
  categories,
  onState,
  onError,
}: {
  item: TodoItem;
  categories: TodoCategory[];
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.titleMarkdown);
  const [details, setDetails] = useState(item.detailsMarkdown ?? "");
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (action: () => Promise<{ state: TodoState }>) => {
      setBusy(true);
      try {
        onState((await action()).state);
      } catch (error) {
        onError(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [onError, onState],
  );

  const activeCategories = categories.filter((category) => !category.archivedAt);
  const currentCategory = categories.find((category) => category.id === item.categoryId);

  return (
    <article
      className={`rounded-xl border px-3 py-3 sm:px-4 ${item.archivedAt ? "border-cc-border/60 bg-cc-bg/35 opacity-80" : "border-cc-border bg-cc-card/60"}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusClasses(item.status)}`}
            >
              {STATUS_LABELS[item.status]}
            </span>
            <span className="rounded-full bg-cc-bg px-2 py-0.5 text-[10px] text-cc-muted">
              {currentCategory?.name ?? item.categoryId}
            </span>
            {item.archivedAt && (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-cc-muted">Archived</span>
            )}
          </div>
          {editing ? (
            <div className="mt-3 space-y-2">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={500}
                className="w-full rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-sm text-cc-fg outline-none focus:border-cc-primary"
                aria-label={`Edit title for ${item.id}`}
              />
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={4}
                className="w-full resize-y rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg outline-none focus:border-cc-primary"
                aria-label={`Edit details for ${item.id}`}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !title.trim()}
                  onClick={() =>
                    void run(async () => {
                      const response = await api.editTodoItem(item.id, {
                        titleMarkdown: title,
                        detailsMarkdown: details || null,
                      });
                      setEditing(false);
                      return response;
                    })
                  }
                  className="rounded-lg bg-cc-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTitle(item.titleMarkdown);
                    setDetails(item.detailsMarkdown ?? "");
                    setEditing(false);
                  }}
                  className="rounded-lg border border-cc-border px-3 py-1.5 text-xs text-cc-muted hover:text-cc-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <MarkdownContent
                text={item.titleMarkdown}
                size="md"
                variant="conservative"
                wrapLongContent
                stopLinkPropagation
                className="mt-2 font-medium"
              />
              {item.detailsMarkdown && expanded && (
                <div className="mt-3 rounded-lg bg-cc-bg/70 px-3 py-2.5">
                  <MarkdownContent text={item.detailsMarkdown} size="sm" wrapLongContent stopLinkPropagation />
                </div>
              )}
            </>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-cc-muted">
            <span>{item.id}</span>
            <span>Updated {formatUpdated(item.updatedAt)}</span>
            {item.completedAt && <span>Completed {new Date(item.completedAt).toLocaleString()}</span>}
          </div>
        </div>

        {!editing && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:max-w-[250px] sm:justify-end">
            {item.detailsMarkdown && (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg"
              >
                {expanded ? "Hide details" : "Details"}
              </button>
            )}
            {!item.archivedAt &&
              TODO_STATUSES.filter((status) => status !== item.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => api.setTodoItemStatus(item.id, status))}
                  className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted hover:border-cc-primary/40 hover:text-cc-fg disabled:opacity-50"
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            {!item.archivedAt && (
              <select
                aria-label={`Move ${item.id}`}
                value={item.categoryId}
                disabled={busy}
                onChange={(event) => void run(() => api.moveTodoItem(item.id, event.target.value))}
                className="rounded-lg border border-cc-border bg-cc-bg px-2 py-1.5 text-[11px] text-cc-fg"
              >
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
            {!item.archivedAt && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() => (item.archivedAt ? api.restoreTodoItem(item.id) : api.archiveTodoItem(item.id)))
              }
              className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg disabled:opacity-50"
            >
              {item.archivedAt ? "Restore" : "Archive"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function AddTodoForm({
  state,
  onState,
  onError,
}: {
  state: TodoState;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
}) {
  const categories = state.categories.filter((category) => !category.archivedAt);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [categoryId, setCategoryId] = useState("cat-inbox");
  const [status, setStatus] = useState<TodoStatus>("todo");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!categories.some((category) => category.id === categoryId)) setCategoryId("cat-inbox");
  }, [categories, categoryId]);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        void api
          .createTodoItem({ titleMarkdown: title, detailsMarkdown: details || undefined, categoryId, status })
          .then((response) => {
            onState(response.state);
            setTitle("");
            setDetails("");
            setStatus("todo");
            setExpanded(false);
          })
          .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
          .finally(() => setBusy(false));
      }}
      className="rounded-2xl border border-cc-primary/25 bg-cc-primary/5 p-3 sm:p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onFocus={() => setExpanded(true)}
          maxLength={500}
          placeholder="Add a personal to-do (inline Markdown supported)"
          aria-label="New to-do title"
          className="min-w-0 flex-1 rounded-xl border border-cc-border bg-cc-bg px-3 py-2.5 text-sm text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary"
        />
        <button
          type="submit"
          disabled={busy || !title.trim()}
          className="rounded-xl bg-cc-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {expanded && (
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_130px]">
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            rows={3}
            placeholder="Optional Markdown details"
            aria-label="New to-do details"
            className="resize-y rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary"
          />
          <select
            aria-label="New to-do category"
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            aria-label="New to-do status"
            value={status}
            onChange={(event) => setStatus(event.target.value as TodoStatus)}
            className="rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            {TODO_STATUSES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {STATUS_LABELS[candidate]}
              </option>
            ))}
          </select>
        </div>
      )}
    </form>
  );
}

function CategoryManager({
  state,
  onState,
  onError,
}: {
  state: TodoState;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const activeCounts = useMemo(
    () =>
      new Map(
        state.categories.map((category) => [
          category.id,
          state.items.filter((item) => !item.archivedAt && item.categoryId === category.id).length,
        ]),
      ),
    [state],
  );
  const run = async (action: () => Promise<{ state: TodoState }>) => {
    try {
      onState((await action()).state);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="New category"
          aria-label="New category name"
          className="min-w-0 flex-1 rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
        />
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() =>
            void run(async () => {
              const response = await api.createTodoCategory(name);
              setName("");
              return response;
            })
          }
          className="rounded-lg bg-cc-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
        >
          Create
        </button>
      </div>
      <div className="space-y-2">
        {state.categories
          .filter((category) => !category.archivedAt)
          .map((category) => (
            <div
              key={category.id}
              className="flex flex-col gap-2 rounded-lg border border-cc-border bg-cc-bg/60 p-2.5 sm:flex-row sm:items-center"
            >
              <input
                value={drafts[category.id] ?? category.name}
                onChange={(event) => setDrafts((current) => ({ ...current, [category.id]: event.target.value }))}
                aria-label={`Category name ${category.id}`}
                className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-cc-fg focus:border-cc-border"
              />
              <span className="text-[10px] text-cc-muted">{activeCounts.get(category.id) ?? 0} active</span>
              <button
                type="button"
                onClick={() =>
                  void run(() => api.renameTodoCategory(category.id, drafts[category.id] ?? category.name))
                }
                className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:text-cc-fg"
              >
                Save
              </button>
              {category.id !== "cat-inbox" && (
                <button
                  type="button"
                  disabled={(activeCounts.get(category.id) ?? 0) > 0}
                  title={
                    (activeCounts.get(category.id) ?? 0) > 0 ? "Move or archive active items first" : "Archive category"
                  }
                  onClick={() => void run(() => api.archiveTodoCategory(category.id))}
                  className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Archive
                </button>
              )}
            </div>
          ))}
        {state.categories
          .filter((category) => !!category.archivedAt)
          .map((category) => (
            <div
              key={category.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-cc-border bg-cc-bg/40 p-2.5 opacity-80"
            >
              <div>
                <p className="text-xs text-cc-fg">{category.name}</p>
                <p className="text-[10px] text-cc-muted">Archived category</p>
              </div>
              <button
                type="button"
                onClick={() => void run(() => api.restoreTodoCategory(category.id))}
                className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:text-cc-fg"
              >
                Restore
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}

function ProposalManager({
  state,
  onState,
  onError,
}: {
  state: TodoState;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
}) {
  const pending = state.proposals.filter((proposal) => proposal.status === "pending");
  if (pending.length === 0) return <p className="text-xs text-cc-muted">No pending agent proposals.</p>;
  return (
    <div className="space-y-2">
      {pending.map((proposal) => (
        <div key={proposal.id} className="rounded-lg border border-cc-border bg-cc-bg/60 p-3">
          <p className="text-xs font-medium text-cc-fg">{todoProposalSummary(proposal)}</p>
          <p className="mt-1 text-[10px] text-cc-muted">
            {proposal.id} · {proposal.requestedBy.label ?? proposal.requestedBy.kind}
          </p>
          <div className="mt-3 flex gap-2">
            {(["approve", "reject"] as const).map((decision) => (
              <button
                key={decision}
                type="button"
                onClick={() =>
                  void api
                    .resolveTodoProposal(proposal.id, decision)
                    .then((response) => onState(response.state))
                    .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
                }
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${decision === "approve" ? "bg-cc-primary text-white" : "border border-cc-border text-cc-muted hover:text-cc-fg"}`}
              >
                {decision === "approve" ? "Approve" : "Reject"}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function GrantManager({
  state,
  onState,
  onError,
}: {
  state: TodoState;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
}) {
  const [principals, setPrincipals] = useState<TodoPrincipal[]>([]);
  const [principalKey, setPrincipalKey] = useState("");
  const [actions, setActions] = useState<TodoGrantAction[]>(["item:add"]);
  const [allCategories, setAllCategories] = useState(false);
  const [categoryIds, setCategoryIds] = useState<string[]>(["cat-inbox"]);
  useEffect(() => {
    void api
      .listTodoPrincipals()
      .then((response) => {
        setPrincipals(response.principals);
        setPrincipalKey(
          (current) =>
            current || (response.principals[0] ? `${response.principals[0].kind}:${response.principals[0].id}` : ""),
        );
      })
      .catch(() => setPrincipals([]));
  }, []);
  useEffect(() => {
    const activeIds = new Set(
      state.categories.filter((category) => !category.archivedAt).map((category) => category.id),
    );
    setCategoryIds((current) => {
      const next = current.filter((categoryId) => activeIds.has(categoryId));
      return next.length === current.length ? current : next;
    });
  }, [state.categories]);

  const create = async () => {
    const separator = principalKey.indexOf(":");
    const kind = principalKey.slice(0, separator) as TodoPrincipal["kind"];
    const id = principalKey.slice(separator + 1);
    const selected = principals.find((principal) => principal.kind === kind && principal.id === id);
    if (!selected || actions.length === 0) return;
    try {
      onState(
        (await api.createTodoGrant({ principal: selected, actions, categoryIds: allCategories ? null : categoryIds }))
          .state,
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-cc-border bg-cc-bg/60 p-3">
        <p className="text-xs font-medium text-cc-fg">Create a scoped workflow grant</p>
        <select
          value={principalKey}
          onChange={(event) => setPrincipalKey(event.target.value)}
          aria-label="Workflow grant principal"
          className="mt-2 w-full rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
        >
          {principals.length === 0 && <option value="">No sessions or cron workflows available</option>}
          {principals.map((principal) => (
            <option key={`${principal.kind}:${principal.id}`} value={`${principal.kind}:${principal.id}`}>
              {principal.kind === "cron" ? "Workflow" : "Session"}: {principal.label ?? principal.id}
            </option>
          ))}
        </select>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {TODO_GRANT_ACTIONS.map((action) => (
            <label key={action} className="flex items-center gap-2 text-[11px] text-cc-muted">
              <input
                type="checkbox"
                checked={actions.includes(action)}
                onChange={(event) =>
                  setActions((current) =>
                    event.target.checked ? [...current, action] : current.filter((candidate) => candidate !== action),
                  )
                }
              />
              {ACTION_LABELS[action]}
            </label>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-[11px] text-cc-muted">
          <input type="checkbox" checked={allCategories} onChange={(event) => setAllCategories(event.target.checked)} />
          All categories
        </label>
        {!allCategories && (
          <div className="mt-2 flex flex-wrap gap-2">
            {state.categories
              .filter((category) => !category.archivedAt)
              .map((category) => (
                <label
                  key={category.id}
                  className="flex items-center gap-1.5 rounded-full border border-cc-border px-2 py-1 text-[10px] text-cc-muted"
                >
                  <input
                    type="checkbox"
                    checked={categoryIds.includes(category.id)}
                    onChange={(event) =>
                      setCategoryIds((current) =>
                        event.target.checked ? [...current, category.id] : current.filter((id) => id !== category.id),
                      )
                    }
                  />
                  {category.name}
                </label>
              ))}
          </div>
        )}
        <button
          type="button"
          disabled={!principalKey || actions.length === 0 || (!allCategories && categoryIds.length === 0)}
          onClick={() => void create()}
          className="mt-3 rounded-lg bg-cc-primary px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          Create grant
        </button>
      </div>
      <div className="space-y-2">
        {state.grants
          .filter((grant) => !grant.revokedAt)
          .map((grant) => (
            <div
              key={grant.id}
              className="flex flex-col gap-2 rounded-lg border border-cc-border bg-cc-bg/60 p-3 sm:flex-row sm:items-start sm:justify-between"
            >
              <div>
                <p className="text-xs font-medium text-cc-fg">
                  {grant.principal.label ?? `${grant.principal.kind}:${grant.principal.id}`}
                </p>
                <p className="mt-1 text-[10px] text-cc-muted">
                  {grant.actions.map((action) => ACTION_LABELS[action]).join(", ")} ·{" "}
                  {grant.categoryIds === null
                    ? "all categories"
                    : grant.categoryIds
                        .map((id) => state.categories.find((category) => category.id === id)?.name ?? id)
                        .join(", ")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void api
                    .revokeTodoGrant(grant.id)
                    .then((response) => onState(response.state))
                    .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)))
                }
                className="rounded-lg border border-cc-border px-2.5 py-1.5 text-[11px] text-cc-muted hover:text-cc-fg"
              >
                Revoke
              </button>
            </div>
          ))}
        {state.grants.every((grant) => !!grant.revokedAt) && (
          <p className="text-xs text-cc-muted">No active workflow grants.</p>
        )}
      </div>
    </div>
  );
}

export function TodoListPanel() {
  const [state, setState] = useState<TodoState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TodoStatusFilter>("active");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [manageOpen, setManageOpen] = useState<"categories" | "proposals" | "grants" | null>(null);

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

  const counts = useMemo(() => {
    const active = state?.items.filter((item) => !item.archivedAt) ?? [];
    return Object.fromEntries(
      TODO_STATUSES.map((status) => [status, active.filter((item) => item.status === status).length]),
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
            visibleItems.filter((item) => item.status !== "done"),
            state.categories,
          )
        : [],
    [state, visibleItems],
  );
  const doneGroups = useMemo(
    () => groupDoneItemsByLocalDate(visibleItems.filter((item) => item.status === "done")),
    [visibleItems],
  );

  if (loading && !state)
    return (
      <div className="rounded-2xl border border-cc-border bg-cc-card px-4 py-12 text-center text-sm text-cc-muted">
        Loading personal to-dos...
      </div>
    );
  if (!state)
    return <ErrorBanner message={error || "Unable to load personal to-dos."} onDismiss={() => setError("")} />;

  const activeCategories = state.categories.filter((category) => !category.archivedAt);
  const pendingCount = state.proposals.filter((proposal) => proposal.status === "pending").length;

  return (
    <section className="space-y-4" data-testid="todo-list-panel">
      {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}
      <div className="rounded-2xl border border-cc-border bg-cc-card/90 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-cc-fg">Personal To-dos</h2>
            <p className="mt-1 text-xs text-cc-muted">
              Your durable reminders, separate from agent quests and session-local task checklists.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {TODO_STATUSES.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
                className={`rounded-full border px-3 py-1 text-xs font-medium ${statusFilter === status ? statusClasses(status) : "border-cc-border text-cc-muted hover:text-cc-fg"}`}
              >
                {STATUS_LABELS[status]} {counts[status]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-4">
          <AddTodoForm state={state} onState={applyState} onError={setError} />
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_170px_150px]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search Markdown text or links"
            aria-label="Search to-dos"
            className="rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg outline-none focus:border-cc-primary"
          />
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filter by category"
            className="rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            <option value="all">All categories</option>
            {activeCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as TodoStatusFilter)}
            aria-label="Filter by status"
            className="rounded-xl border border-cc-border bg-cc-bg px-3 py-2 text-xs text-cc-fg"
          >
            <option value="active">Todo + Doing</option>
            <option value="all">All active</option>
            {TODO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
            <option value="archived">Archived</option>
          </select>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-cc-border pt-3">
          {(["categories", "proposals", "grants"] as const).map((section) => (
            <button
              key={section}
              type="button"
              onClick={() => setManageOpen((current) => (current === section ? null : section))}
              className={`rounded-lg border px-3 py-1.5 text-xs capitalize ${manageOpen === section ? "border-cc-primary/40 bg-cc-primary/10 text-cc-primary" : "border-cc-border text-cc-muted hover:text-cc-fg"}`}
            >
              {section}
              {section === "proposals" && pendingCount > 0 ? ` (${pendingCount})` : ""}
            </button>
          ))}
        </div>
        {manageOpen && (
          <div className="mt-4 rounded-xl border border-cc-border bg-cc-card p-3 sm:p-4">
            {manageOpen === "categories" ? (
              <CategoryManager state={state} onState={applyState} onError={setError} />
            ) : manageOpen === "proposals" ? (
              <ProposalManager state={state} onState={applyState} onError={setError} />
            ) : (
              <GrantManager state={state} onState={applyState} onError={setError} />
            )}
          </div>
        )}
      </div>

      {visibleItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-cc-border bg-cc-card/40 px-4 py-10 text-center text-sm text-cc-muted">
          No to-dos match these filters.
        </div>
      ) : (
        <div className="space-y-5">
          {activeGroups.map((group) => (
            <section key={group.categoryId}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">{group.categoryName}</h3>
                <span className="text-[10px] text-cc-muted">{group.items.length}</span>
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <TodoItemRow
                    key={item.id}
                    item={item}
                    categories={state.categories}
                    onState={applyState}
                    onError={setError}
                  />
                ))}
              </div>
            </section>
          ))}
          {doneGroups.map((group) => (
            <section key={group.dateKey}>
              <div className="mb-2 flex items-center gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Done · {group.label}</h3>
                <span className="text-[10px] text-cc-muted">{group.items.length}</span>
              </div>
              <div className="space-y-2">
                {group.items.map((item) => (
                  <TodoItemRow
                    key={item.id}
                    item={item}
                    categories={state.categories}
                    onState={applyState}
                    onError={setError}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
