import type { TodoItemSummaries, TodoItemSummary, TodoState } from "./todo-types.js";

/**
 * Takode link syntax for personal to-dos: `[title](todo:td-12)`. Users never see to-do IDs, so the
 * visible label stays human-readable. The link opens a preview.
 *
 * Older messages may also hold `todo:tp-36` links to to-do proposals, which Takode no longer has;
 * they still parse so their preview can show the to-do the proposal created.
 */
export interface TodoLinkTarget {
  kind: "item" | "proposal";
  /** `td-12` or `tp-36`. */
  id: string;
}

const TODO_LINK_PATTERN = /^todo:(?:\/\/)?(td|tp)-(\d+)$/i;

/** Return the to-do item or proposal named by a `todo:td-12` / `todo:tp-36` href, or null. */
export function parseTodoLinkHref(href?: string): TodoLinkTarget | null {
  const match = href?.trim().match(TODO_LINK_PATTERN);
  if (!match) return null;
  const prefix = match[1]!.toLowerCase();
  return { kind: prefix === "td" ? "item" : "proposal", id: `${prefix}-${Number.parseInt(match[2]!, 10)}` };
}

/** The compact summaries of a to-do list, as `GET /todos/item-summaries` returns them. */
export function summarizeTodoItems(state: Pick<TodoState, "items" | "revision">): TodoItemSummaries {
  const items: TodoItemSummaries["items"] = {};
  const proposalItems: TodoItemSummaries["proposalItems"] = {};
  for (const item of state.items) {
    items[item.id] = {
      status: item.status,
      ...(item.due ? { due: item.due } : {}),
      ...(item.archivedAt ? { archivedAt: item.archivedAt } : {}),
    };
    const proposalId = item.createdBy.authorization.proposalId;
    if (proposalId) proposalItems[proposalId] = item.id;
  }
  return { items, proposalItems, revision: state.revision };
}

/** The to-do a link names, or for a retired proposal's link the to-do it created; null when there is none. */
export function todoLinkSummary(summaries: TodoItemSummaries, target: TodoLinkTarget): TodoItemSummary | null {
  const itemId = target.kind === "item" ? target.id : summaries.proposalItems[target.id];
  return (itemId && summaries.items[itemId]) || null;
}

/** Build a ready-to-paste Markdown link to a to-do, e.g. `[Review PR 98888](todo:td-36)`. */
export function formatTodoMarkdownLink(id: string, label: string): string {
  const singleLine = label.replace(/\s+/g, " ").trim();
  const safeLabel = singleLine ? singleLine.replace(/[\\[\]]/g, "\\$&") : "to-do";
  return `[${safeLabel}](todo:${id})`;
}
