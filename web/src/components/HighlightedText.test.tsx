import { describe, it, expect } from "vitest";
import { buildHighlightPattern } from "./HighlightedText.js";

describe("buildHighlightPattern", () => {
  it("returns null for empty query", () => {
    expect(buildHighlightPattern("", "strict")).toBeNull();
    expect(buildHighlightPattern("   ", "strict")).toBeNull();
    expect(buildHighlightPattern("", "fuzzy")).toBeNull();
  });

  describe("strict mode", () => {
    it("creates case-insensitive pattern for exact substring", () => {
      const pattern = buildHighlightPattern("hello", "strict")!;
      expect(pattern).toBeInstanceOf(RegExp);
      expect(pattern.flags).toContain("i");
      expect("say Hello world".split(pattern)).toEqual(["say ", "Hello", " world"]);
    });

    it("escapes regex special characters", () => {
      const pattern = buildHighlightPattern("foo.bar()", "strict")!;
      // Should match the literal string, not treat . and () as regex
      expect("foo.bar() test".split(pattern)).toEqual(["", "foo.bar()", " test"]);
      expect("fooXbar() test".split(pattern)).toEqual(["fooXbar() test"]);
    });

    it("finds multiple occurrences", () => {
      const pattern = buildHighlightPattern("ab", "strict")!;
      const parts = "ab cd ab ef ab".split(pattern);
      // split with capture group: ["", "ab", " cd ", "ab", " ef ", "ab", ""]
      expect(parts.filter((_, i) => i % 2 === 1)).toEqual(["ab", "ab", "ab"]);
    });
  });

  describe("fuzzy mode", () => {
    it("highlights each query word independently", () => {
      const pattern = buildHighlightPattern("hello world", "fuzzy")!;
      expect(pattern).toBeInstanceOf(RegExp);
      const parts = "hello beautiful world".split(pattern);
      const matches = parts.filter((_, i) => i % 2 === 1);
      expect(matches).toEqual(["hello", "world"]);
    });

    it("matches words case-insensitively", () => {
      const pattern = buildHighlightPattern("FOO bar", "fuzzy")!;
      const parts = "foo is Bar".split(pattern);
      const matches = parts.filter((_, i) => i % 2 === 1);
      expect(matches).toEqual(["foo", "Bar"]);
    });

    it("escapes special characters in fuzzy words", () => {
      const pattern = buildHighlightPattern("a.b c+d", "fuzzy")!;
      expect("a.b and c+d".split(pattern).filter((_, i) => i % 2 === 1)).toEqual(["a.b", "c+d"]);
      // Should NOT match "axb" (the . should be literal)
      expect("axb and c+d".split(pattern).filter((_, i) => i % 2 === 1)).toEqual(["c+d"]);
    });
  });
});
