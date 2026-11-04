import { describe, expect, it, vi } from "vitest";
import type { TodoCategory, TodoItem } from "../../shared/todo-types.js";
import { todoRowMenuItems, type TodoRowMenuActions } from "./todo-row-menu.js";

/**
 * The submenus of a to-do row's menu: due date shortcuts (the sheet's quick picks, plus Clear when
 * it has one) and Move to (every other active category), each running the row's own action.
 */

const provenance = { actor: { kind: "user" as const, label: "User" }, authorization: { kind: "ui" as const }, at: 1 };
const category = (id: string, name: string): TodoCategory => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
  createdBy: provenance,
  lastModifiedBy: provenance,
});
const item: TodoItem = {
  id: "td-1",
  markdown: "Ship it",
  rank: 1,
  categoryId: "cat-inbox",
  status: "todo",
  due: "2026-11-04",
  createdAt: 1,
  updatedAt: 1,
  statusChangedAt: 1,
  createdBy: provenance,
  lastModifiedBy: provenance,
};

function actions(): TodoRowMenuActions {
  return {
    open: vi.fn(),
    complete: vi.fn(),
    setStatus: vi.fn(),
    insertBelow: vi.fn(),
    move: vi.fn(),
    setDue: vi.fn(),
    setArchived: vi.fn(),
    copy: vi.fn(),
  };
}

describe("to-do row menu", () => {
  it("sets a due date from the quick picks or clears it, and moves to another category", () => {
    const run = actions();
    const items = todoRowMenuItems({
      item,
      siblings: [item],
      categories: [category("cat-inbox", "Inbox"), category("cat-1", "Slack"), category("cat-2", "Reading")],
      selectedText: "",
      now: new Date(2026, 10, 3, 12).getTime(),
      actions: run,
    });
    const due = items.find((entry) => entry.label === "Due")!;
    expect(due.children!.map((entry) => entry.label)).toEqual(["Today", "Tomorrow", "Next week", "Clear due date"]);
    due.children![1]!.onClick();
    expect(run.setDue).toHaveBeenCalledWith("2026-11-04");
    due.children![3]!.onClick();
    expect(run.setDue).toHaveBeenLastCalledWith(null);

    // A lone row has nothing to move up or down past.
    expect(items.map((entry) => entry.label)).not.toContain("Move up");
    const moveTo = items.find((entry) => entry.label === "Move to")!;
    expect(moveTo.children!.map((entry) => entry.label)).toEqual(["Slack", "Reading"]);
    moveTo.children![0]!.onClick();
    expect(run.move).toHaveBeenCalledWith({ categoryId: "cat-1" });
  });

  it("lets a Done to-do go back to Todo or Doing, without due or order actions", () => {
    const items = todoRowMenuItems({
      item: { ...item, status: "done" },
      siblings: [item],
      categories: [category("cat-inbox", "Inbox")],
      selectedText: "",
      now: 0,
      actions: actions(),
    });
    expect(items.map((entry) => entry.label)).toEqual(["Open", "Mark Todo", "Mark Doing", "Copy text", "Archive"]);
  });
});
