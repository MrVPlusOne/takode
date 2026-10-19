/** Tests for the worker quiet marker syntax shared by the server and the feed. */
import { describe, it, expect } from "vitest";
import { extractQuietMarkerFromText, parseQuietMarkerLine } from "./quiet-turn-marker.js";

describe("quiet turn marker", () => {
  it("parses only a standalone marker line with a summary", () => {
    expect(parseQuietMarkerLine("{[(Quiet: nothing new)]}")).toBe("nothing new");
    expect(parseQuietMarkerLine("  {[(Quiet: nothing new)]}  ")).toBe("nothing new");
    expect(parseQuietMarkerLine("{[(Quiet: )]}")).toBeNull();
    expect(parseQuietMarkerLine("done {[(Quiet: nothing new)]}")).toBeNull();
    expect(parseQuietMarkerLine(`{[(Quiet: ${"x".repeat(201)})]}`)).toBeNull();
  });

  it("removes marker lines from text and keeps the last summary", () => {
    expect(extractQuietMarkerFromText("No alert.\n\n{[(Quiet: first)]}\n{[(Quiet: second)]}")).toEqual({
      text: "No alert.",
      summary: "second",
    });
  });

  it("leaves text without a marker unchanged", () => {
    expect(extractQuietMarkerFromText("Found it.\n\n\n")).toEqual({ text: "Found it.\n\n\n", summary: null });
  });
});
