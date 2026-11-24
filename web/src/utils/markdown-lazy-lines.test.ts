import { describe, expect, it } from "vitest";
import { separateLazyLines } from "./markdown-lazy-lines.js";

// A message line typed without its quote's ">" or its list item's indentation must start outside that
// quote or item, as the message box draws it, instead of continuing the paragraph above (Markdown's
// lazy continuation). The transform inserts a separator line that keeps the marks the line does carry.
describe("separateLazyLines", () => {
  it("ends a quote at a line typed without >", () => {
    expect(separateLazyLines("> abc\nabc")).toBe("> abc\n\nabc");
    // Later unmarked lines continue the line that left the quote, and a new ">" line is a new quote.
    expect(separateLazyLines("> a\nb\nc\n> d")).toBe("> a\n\nb\nc\n> d");
  });

  it("leaves only the quote levels a line drops", () => {
    // "> b" stays in the outer quote; "c" leaves both.
    expect(separateLazyLines(">> a\n> b\nc")).toBe(">> a\n>\n> b\n\nc");
  });

  it("ends a list item at a line not indented to its text", () => {
    expect(separateLazyLines("- a\nb")).toBe("- a\n\nb");
    expect(separateLazyLines("1. a\n   b\nc")).toBe("1. a\n   b\n\nc");
    expect(separateLazyLines("> - a\n>   b\n> c")).toBe("> - a\n>   b\n>\n> c");
    // An item whose text starts on the next line needs the indentation of its marker and one space.
    expect(separateLazyLines("10.\n    a\n   b")).toBe("10.\n    a\n\n   b");
  });

  it("keeps a quote inside a list item when the line stays in the item", () => {
    expect(separateLazyLines("- > a\n  b")).toBe("- > a\n\n  b");
  });

  it("leaves text without lazy lines unchanged", () => {
    for (const text of ["plain\ntext", "- a\n  b", "- a\n- b", "> a\n> b", "> a\n\nb"]) {
      expect(separateLazyLines(text)).toBe(text);
    }
  });

  it("never changes code or math blocks", () => {
    for (const text of ["```\n> x\ny\n```", "$$\n> x\ny\n$$", "\\[\n+ x\ny\n\\]", "> ```\n> x\ny"]) {
      expect(separateLazyLines(text)).toBe(text);
    }
  });
});
