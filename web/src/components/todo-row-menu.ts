import type { TodoCategory, TodoItem, TodoStatus } from "../../shared/todo-types.js";
import type { ContextMenuItem } from "./ContextMenu.js";
import { todoDueQuickPicks } from "./TodoDueControls.js";

const STATUS_LABELS: Record<TodoStatus, string> = { todo: "Mark Todo", doing: "Mark Doing", done: "Mark Done" };

/** What a to-do row's menu can do; each action is the one the row or its sheet already runs. */
export interface TodoRowMenuActions {
  open: () => void;
  /** Done goes through the row's completion, which celebrates and offers Undo. */
  complete: () => void;
  setStatus: (status: Exclude<TodoStatus, "done">) => void;
  insertBelow: () => void;
  move: (input: { categoryId?: string; beforeItemId?: string; afterItemId?: string }) => void;
  setDue: (due: string | null) => void;
  setArchived: (archived: boolean) => void;
  copy: (text: string) => void;
}

/**
 * A to-do row's right-click (or long-press) menu: its quick actions in the order they are most
 * used. Archived to-dos can only be opened, copied or restored, as in their sheet. When text in the
 * row is selected, Copy comes first, so the menu doesn't take that away from the browser's.
 */
export function todoRowMenuItems({
  item,
  siblings,
  categories,
  selectedText,
  now,
  actions,
}: {
  item: TodoItem;
  siblings: readonly TodoItem[];
  categories: readonly TodoCategory[];
  selectedText: string;
  now: number;
  actions: TodoRowMenuActions;
}): ContextMenuItem[] {
  const archived = !!item.archivedAt;
  const active = !archived && item.status !== "done";
  const items: ContextMenuItem[] = [];
  if (selectedText) items.push({ label: "Copy", onClick: () => actions.copy(selectedText) });
  items.push({ label: "Open", onClick: actions.open });
  if (!archived) {
    for (const status of ["todo", "doing", "done"] as const) {
      if (status === item.status) continue;
      items.push({
        label: STATUS_LABELS[status],
        onClick: status === "done" ? actions.complete : () => actions.setStatus(status),
      });
    }
  }
  if (active) {
    items.push(
      {
        label: "Due",
        onClick: () => {},
        children: [
          ...todoDueQuickPicks(now).map((pick) => ({ label: pick.label, onClick: () => actions.setDue(pick.due) })),
          ...(item.due ? [{ label: "Clear due date", onClick: () => actions.setDue(null) }] : []),
        ],
      },
      { label: "Add below", onClick: actions.insertBelow },
    );
    const index = siblings.findIndex((candidate) => candidate.id === item.id);
    if (index > 0) {
      items.push({ label: "Move up", onClick: () => actions.move({ beforeItemId: siblings[index - 1]!.id }) });
    }
    if (index >= 0 && index < siblings.length - 1) {
      items.push({ label: "Move down", onClick: () => actions.move({ afterItemId: siblings[index + 1]!.id }) });
    }
  }
  if (!archived) {
    const others = categories.filter((category) => category.id !== item.categoryId);
    if (others.length > 0) {
      items.push({
        label: "Move to",
        onClick: () => {},
        children: others.map((category) => ({
          label: category.name,
          onClick: () => actions.move({ categoryId: category.id }),
        })),
      });
    }
  }
  items.push(
    { label: "Copy text", onClick: () => actions.copy(item.markdown) },
    { label: archived ? "Restore" : "Archive", onClick: () => actions.setArchived(!archived) },
  );
  return items;
}
