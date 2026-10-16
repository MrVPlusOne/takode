import { formatTodoMarkdownLink, parseTodoLinkHref, summarizeTodoItems, todoLinkSummary } from "./todo-link.js";
import type { TodoItem, TodoMutationProvenance } from "./todo-types.js";

describe("to-do link syntax", () => {
  it("parses item hrefs and retired proposal hrefs from older messages", () => {
    expect(parseTodoLinkHref("todo:td-12")).toEqual({ kind: "item", id: "td-12" });
    expect(parseTodoLinkHref("todo:tp-36")).toEqual({ kind: "proposal", id: "tp-36" });
    // Tolerate the forms agents tend to produce: surrounding space, a `//` prefix and upper case.
    expect(parseTodoLinkHref(" todo://TP-36 ")).toEqual({ kind: "proposal", id: "tp-36" });
  });

  it("does not claim other IDs or malformed hrefs", () => {
    // Category and grant IDs have no preview.
    expect(parseTodoLinkHref("todo:tg-1")).toBeNull();
    expect(parseTodoLinkHref("todo:cat-inbox")).toBeNull();
    expect(parseTodoLinkHref("todo:tp-")).toBeNull();
    expect(parseTodoLinkHref("tp-36")).toBeNull();
    expect(parseTodoLinkHref("todo:td-12:extra")).toBeNull();
    expect(parseTodoLinkHref(undefined)).toBeNull();
  });

  it("formats a link whose label survives Markdown and round-trips through the parser", () => {
    const link = formatTodoMarkdownLink("td-36", "Review [PR]\n98888");
    expect(link).toBe("[Review \\[PR\\] 98888](todo:td-36)");
    expect(parseTodoLinkHref(link.slice(link.indexOf("](") + 2, -1))).toEqual({ kind: "item", id: "td-36" });
    expect(formatTodoMarkdownLink("td-12", " ")).toBe("[to-do](todo:td-12)");
  });
});

describe("to-do summaries for links", () => {
  const provenance = (proposalId?: string): TodoMutationProvenance => ({
    actor: { kind: "system" },
    authorization: proposalId ? { kind: "proposal_approval", proposalId } : { kind: "bootstrap" },
    at: 1,
  });
  const item = (id: string, overrides: Partial<TodoItem> = {}): TodoItem => ({
    id,
    markdown: id,
    rank: 1,
    categoryId: "cat-inbox",
    status: "todo",
    createdAt: 1,
    updatedAt: 1,
    statusChangedAt: 1,
    createdBy: provenance(),
    lastModifiedBy: provenance(),
    ...overrides,
  });

  it("keeps only status, due date and archive time, and maps retired proposals to the to-do they created", () => {
    const summaries = summarizeTodoItems({
      revision: 9,
      items: [
        item("td-1", { status: "doing", due: "2026-10-16" }),
        item("td-2", { status: "done", archivedAt: 5, createdBy: provenance("tp-36") }),
      ],
    });
    expect(summaries).toEqual({
      items: { "td-1": { status: "doing", due: "2026-10-16" }, "td-2": { status: "done", archivedAt: 5 } },
      proposalItems: { "tp-36": "td-2" },
      revision: 9,
    });
    // A proposal link stands for the to-do it created; one that never created a to-do has none.
    expect(todoLinkSummary(summaries, { kind: "proposal", id: "tp-36" })).toEqual(summaries.items["td-2"]);
    expect(todoLinkSummary(summaries, { kind: "proposal", id: "tp-35" })).toBeNull();
    expect(todoLinkSummary(summaries, { kind: "item", id: "td-9" })).toBeNull();
  });
});
