import type { TodoCategory, TodoItem, TodoProposal, TodoStatus } from "../../shared/todo-types.js";

export type TodoStatusFilter = "active" | TodoStatus | "all" | "archived";

export function localDateKey(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function localDateLabel(key: string, now = new Date()): string {
  const today = localDateKey(now.getTime());
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = localDateKey(yesterdayDate.getTime());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    ...(year !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

export function filterTodoItems(
  items: TodoItem[],
  options: { status: TodoStatusFilter; categoryId: string; search: string },
): TodoItem[] {
  const query = options.search.trim().toLocaleLowerCase();
  return items.filter((item) => {
    if (options.status === "archived") {
      if (!item.archivedAt) return false;
    } else if (item.archivedAt) {
      return false;
    } else if (options.status === "active") {
      if (item.status === "done") return false;
    } else if (options.status !== "all" && item.status !== options.status) {
      return false;
    }
    if (options.categoryId !== "all" && item.categoryId !== options.categoryId) return false;
    if (!query) return true;
    return `${item.titleMarkdown}\n${item.detailsMarkdown ?? ""}`.toLocaleLowerCase().includes(query);
  });
}

export function groupActiveItemsByCategory(items: TodoItem[], categories: TodoCategory[]) {
  const categoryOrder = new Map(categories.map((category, index) => [category.id, index]));
  const groups = new Map<string, TodoItem[]>();
  for (const item of items) {
    const group = groups.get(item.categoryId) ?? [];
    group.push(item);
    groups.set(item.categoryId, group);
  }
  return [...groups.entries()]
    .sort(
      (a, b) =>
        (categoryOrder.get(a[0]) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder.get(b[0]) ?? Number.MAX_SAFE_INTEGER),
    )
    .map(([categoryId, groupedItems]) => ({
      categoryId,
      categoryName: categories.find((category) => category.id === categoryId)?.name ?? categoryId,
      items: groupedItems.sort((a, b) => {
        if (a.status !== b.status) return a.status === "doing" ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      }),
    }));
}

export function groupDoneItemsByLocalDate(items: TodoItem[]) {
  const groups = new Map<string, TodoItem[]>();
  for (const item of items) {
    const key = localDateKey(item.completedAt ?? item.updatedAt);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([dateKey, groupedItems]) => ({
      dateKey,
      label: localDateLabel(dateKey),
      items: groupedItems.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt)),
    }));
}

export function todoProposalSummary(proposal: TodoProposal): string {
  const mutation = proposal.mutation;
  switch (mutation.action) {
    case "item:add":
      return `Add “${mutation.input.titleMarkdown}”`;
    case "item:edit":
      return `Edit ${mutation.itemId}`;
    case "item:status":
      return `Move ${mutation.itemId} to ${mutation.status}`;
    case "item:move":
      return `Move ${mutation.itemId} to ${mutation.categoryId}`;
    case "item:archive":
      return `Archive ${mutation.itemId}`;
    case "item:restore":
      return `Restore ${mutation.itemId}`;
    case "category:create":
      return `Create category “${mutation.input.name}”`;
    case "category:rename":
      return `Rename ${mutation.categoryId} to “${mutation.name}”`;
    case "category:archive":
      return `Archive category ${mutation.categoryId}`;
    case "category:restore":
      return `Restore category ${mutation.categoryId}`;
  }
}
