import { describe, expect, it } from "vitest";
import { formatSelectedTextAsBlockquote } from "./SelectionContextMenu.js";

describe("formatSelectedTextAsBlockquote", () => {
  // Browser selections can include a leading line break from the chat markup;
  // quoting should not turn that edge artifact into an empty quoted line.
  it("trims a leading newline before quoting selected text", () => {
    expect(formatSelectedTextAsBlockquote("\nSelected line")).toBe("> Selected line");
  });

  // Trailing line breaks from a selection boundary should not leave a blank
  // quoted line at the end of the composer draft.
  it("trims a trailing newline before quoting selected text", () => {
    expect(formatSelectedTextAsBlockquote("Selected line\n")).toBe("> Selected line");
  });

  // The screenshot-backed regression can have both edge boundaries present,
  // so cover both ends in one selection.
  it("trims newlines from both edges before quoting selected text", () => {
    expect(formatSelectedTextAsBlockquote("\nSelected line\n")).toBe("> Selected line");
  });

  // Blank lines inside the user's selected content are intentional structure,
  // unlike edge newlines, and must remain quoted.
  it("preserves internal blank lines when quoting selected text", () => {
    expect(formatSelectedTextAsBlockquote("First line\n\nSecond line")).toBe("> First line\n> \n> Second line");
  });

  // Only newline edges are normalized. Ordinary selected spaces and tabs remain
  // part of the quote unless the selection is entirely whitespace.
  it("preserves selected spaces and tabs around non-whitespace content", () => {
    expect(formatSelectedTextAsBlockquote("\n\t Selected line  \n")).toBe("> \t Selected line  ");
  });
});
