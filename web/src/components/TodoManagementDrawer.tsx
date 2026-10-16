import { useMemo, useState } from "react";
import type { TodoCategory, TodoState } from "../../shared/todo-types.js";
import { api } from "../api.js";

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

/** Category management: create, rename, archive and restore. */
export function TodoManagementDrawer({ state, onState, onError }: ManagerProps) {
  return (
    <div
      className="rounded-xl border border-cc-border bg-cc-card p-3 shadow-lg sm:p-4"
      data-testid="todo-management-drawer"
    >
      <CategoryManager state={state} onState={onState} onError={onError} />
    </div>
  );
}

export function activeTodoCategories(state: TodoState): TodoCategory[] {
  return state.categories.filter((category) => !category.archivedAt);
}
