import { describe, expect, it } from "vitest";
import {
  buildHighlightedLines,
  highlightCode,
  inferLanguageFromPath,
  splitHighlightedHtmlByLine,
} from "./syntax-highlighting.js";

describe("syntax-highlighting utils", () => {
  it("infers language from file path", () => {
    expect(inferLanguageFromPath("/repo/src/App.tsx")).toBe("typescript");
    expect(inferLanguageFromPath("script.py")).toBe("python");
    expect(inferLanguageFromPath("unknown.customext")).toBeNull();
    expect(inferLanguageFromPath("Mathlib/Order/Basic.lean")).toBe("lean");
    expect(inferLanguageFromPath("proof_lib.v")).toBe("rocq");
  });

  it("splits highlighted html by line while carrying open spans", () => {
    const lines = splitHighlightedHtmlByLine('<span class="hljs-string">"a\n b"</span>');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('<span class="hljs-string">');
    expect(lines[1]).toContain('<span class="hljs-string">');
    expect(lines[1]).toContain("</span>");
  });

  it("builds highlighted lines with stable line count", () => {
    const highlighted = buildHighlightedLines("const a = 1;\nconst b = 2;\n", "typescript");
    expect(highlighted).not.toBeNull();
    expect(highlighted).toHaveLength(2);
  });

  it("highlights Lean 4 under the lean and lean4 fence tags", () => {
    // Nested block comments, attributes, declaration names, keywords, tactics and types.
    const source = "/-- doc /- nested -/ still doc -/\n@[simp] theorem add_zero' (n : Nat) : n + 0 = n := by simp";
    for (const tag of ["lean", "lean4"]) {
      const html = highlightCode(source, tag) ?? "";
      expect(html).toContain(
        '<span class="hljs-comment">/-- doc <span class="hljs-comment">/- nested -/</span> still doc -/</span>',
      );
      expect(html).toContain('<span class="hljs-meta">@[simp]</span>');
      expect(html).toContain(
        '<span class="hljs-keyword">theorem</span> <span class="hljs-title function_">add_zero&#x27;</span>',
      );
      expect(html).toContain('<span class="hljs-type">Nat</span>');
      expect(html).toContain('<span class="hljs-keyword">by</span> <span class="hljs-built_in">simp</span>');
    }
  });

  it("highlights Rocq/Coq under the rocq, coq and v fence tags, case-insensitively", () => {
    const source = "Lemma foo : P.\nProof.\n  match goal with H : Q |- _ => eassumption || lia end.\nQed.";
    for (const tag of ["rocq", "coq", "Coq", "v"]) {
      const html = highlightCode(source, tag) ?? "";
      expect(html).toContain('<span class="hljs-keyword">Lemma</span>');
      expect(html).toContain('<span class="hljs-keyword">Qed</span>');
      // The upstream grammar coloured `|- _` and `|| lia` as types; goal patterns and the `||`
      // combinator must stay plain, with the tactic after `||` still highlighted as a tactic.
      expect(html).toContain("|- <span");
      expect(html).toContain('|| <span class="hljs-built_in">lia</span>');
      expect(html).not.toContain("hljs-type");
    }
  });

  it("still colours Rocq match-arm constructors as types", () => {
    const html = highlightCode("match n with\n| O => 0\n| S m => m\nend", "rocq") ?? "";
    expect(html).toContain('<span class="hljs-type">S</span>');
  });
});
