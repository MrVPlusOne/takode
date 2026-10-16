import { formatTodoMarkdownLink, parseTodoLinkHref } from "./todo-link.js";

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
