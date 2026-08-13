import { useEffect, useMemo, useState } from "react";
import {
  TODO_GRANT_ACTIONS,
  type TodoCategory,
  type TodoGrantAction,
  type TodoPrincipal,
  type TodoState,
} from "../../shared/todo-types.js";
import { api } from "../api.js";
import { todoProposalSummary } from "./todo-ui-utils.js";

const ACTION_LABELS: Record<TodoGrantAction, string> = {
  "item:add": "Add items",
  "item:edit": "Edit content",
  "item:status": "Change status",
  "item:move": "Move or order items",
  "item:archive": "Archive items",
  "item:restore": "Restore items",
  "category:create": "Create categories",
  "category:rename": "Rename categories",
  "category:archive": "Archive categories",
  "category:restore": "Restore categories",
};

type DrawerSection = "categories" | "proposals" | "grants";

type ManagerProps = {
  state: TodoState;
  onState: (state: TodoState) => void;
  onError: (message: string) => void;
};

function CategoryManager({ state, onState, onError }: ManagerProps) {
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
              <span className="text-[10px] text-cc-muted">{activeCounts.get(category.id) ?? 0} items</span>
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

function ProposalManager({ state, onState, onError }: ManagerProps) {
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

function GrantManager({ state, onState, onError }: ManagerProps) {
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
    setCategoryIds((current) => current.filter((categoryId) => activeIds.has(categoryId)));
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

export function TodoManagementDrawer({ state, onState, onError }: ManagerProps) {
  const [section, setSection] = useState<DrawerSection>("categories");
  const pendingCount = state.proposals.filter((proposal) => proposal.status === "pending").length;
  return (
    <div
      className="rounded-xl border border-cc-border bg-cc-card p-3 shadow-lg sm:p-4"
      data-testid="todo-management-drawer"
    >
      <div className="mb-4 flex flex-wrap gap-1 border-b border-cc-border pb-3">
        {(["categories", "proposals", "grants"] as const).map((candidate) => (
          <button
            key={candidate}
            type="button"
            onClick={() => setSection(candidate)}
            className={`rounded-md px-3 py-1.5 text-xs capitalize ${section === candidate ? "bg-cc-primary/12 text-cc-primary" : "text-cc-muted hover:text-cc-fg"}`}
          >
            {candidate}
            {candidate === "proposals" && pendingCount > 0 ? ` (${pendingCount})` : ""}
          </button>
        ))}
      </div>
      {section === "categories" ? (
        <CategoryManager state={state} onState={onState} onError={onError} />
      ) : section === "proposals" ? (
        <ProposalManager state={state} onState={onState} onError={onError} />
      ) : (
        <GrantManager state={state} onState={onState} onError={onError} />
      )}
    </div>
  );
}

export function activeTodoCategories(state: TodoState): TodoCategory[] {
  return state.categories.filter((category) => !category.archivedAt);
}
