import { describe, expect, it, vi } from "vitest";
import type { TodoCategory, TodoItem, TodoMutationProvenance, TodoProposal } from "../../shared/todo-types.js";
import {
  filterTodoItems,
  groupActiveItemsByCategory,
  groupDoneItemsByLocalDate,
  localDateLabel,
  todoProposalSummary,
} from "./todo-ui-utils.js";

const provenance: TodoMutationProvenance = {
  actor: { kind: "user" },
  authorization: { kind: "ui" },
  at: 1,
};
const categories: TodoCategory[] = [
  { id: "cat-inbox", name: "Inbox", createdAt: 1, updatedAt: 1, createdBy: provenance, lastModifiedBy: provenance },
  { id: "cat-slack", name: "Slack", createdAt: 1, updatedAt: 1, createdBy: provenance, lastModifiedBy: provenance },
];
function item(overrides: Partial<TodoItem>): TodoItem {
  return {
    id: "td-1",
    titleMarkdown: "Reply",
    categoryId: "cat-inbox",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
    statusChangedAt: 1,
    createdBy: provenance,
    lastModifiedBy: provenance,
    ...overrides,
  };
}

describe("todo UI grouping", () => {
  it("filters active, archived, category, and Markdown link source text", () => {
    const items = [
      item({ id: "td-1", detailsMarkdown: "[Slack](https://example.slack.com/thread)" }),
      item({ id: "td-2", categoryId: "cat-slack", status: "doing" }),
      item({ id: "td-3", status: "done", completedAt: 3 }),
      item({ id: "td-4", archivedAt: 4 }),
    ];
    expect(
      filterTodoItems(items, { status: "active", categoryId: "all", search: "" }).map((entry) => entry.id),
    ).toEqual(["td-1", "td-2"]);
    expect(
      filterTodoItems(items, { status: "archived", categoryId: "all", search: "" }).map((entry) => entry.id),
    ).toEqual(["td-4"]);
    expect(
      filterTodoItems(items, { status: "all", categoryId: "cat-slack", search: "" }).map((entry) => entry.id),
    ).toEqual(["td-2"]);
    expect(
      filterTodoItems(items, { status: "all", categoryId: "all", search: "example.slack" }).map((entry) => entry.id),
    ).toEqual(["td-1"]);
  });

  it("orders active groups by categories and Doing before Todo", () => {
    const groups = groupActiveItemsByCategory(
      [
        item({ id: "td-1", categoryId: "cat-slack", status: "todo", updatedAt: 3 }),
        item({ id: "td-2", categoryId: "cat-inbox", status: "todo", updatedAt: 4 }),
        item({ id: "td-3", categoryId: "cat-inbox", status: "doing", updatedAt: 2 }),
      ],
      categories,
    );
    expect(groups.map((group) => group.categoryName)).toEqual(["Inbox", "Slack"]);
    expect(groups[0]?.items.map((entry) => entry.id)).toEqual(["td-3", "td-2"]);
  });

  it("groups Done items by browser-local completion date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 12));
    const groups = groupDoneItemsByLocalDate([
      item({ id: "today", status: "done", completedAt: new Date(2026, 7, 13, 9).getTime() }),
      item({ id: "yesterday", status: "done", completedAt: new Date(2026, 7, 12, 23).getTime() }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Today", "Yesterday"]);
    expect(localDateLabel(groups[0]!.dateKey)).toBe("Today");
    vi.useRealTimers();
  });

  it("summarizes proposals without requiring full payload rendering", () => {
    expect(
      todoProposalSummary({
        id: "tp-1",
        status: "pending",
        mutation: { action: "item:status", itemId: "td-4", status: "done" },
        createdAt: 1,
        updatedAt: 1,
        requestedBy: { kind: "session" },
      } satisfies TodoProposal),
    ).toBe("Move td-4 to done");
  });
});
