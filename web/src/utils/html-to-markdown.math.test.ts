// @vitest-environment jsdom
import katex from "katex";
import { describe, expect, it } from "vitest";
import {
  htmlFragmentToMarkdown,
  htmlFragmentToPlainText,
  htmlFragmentToRichText,
  normalizeMathSelectionRange,
  rangeContainsMath,
} from "./html-to-markdown.js";

function appendMath(host: HTMLElement, source: string, value: string, display = false): HTMLElement {
  const wrapper = document.createElement("span");
  wrapper.className = `takode-math ${display ? "takode-math-display" : "takode-math-inline"}`;
  wrapper.setAttribute("data-math-source", source);
  wrapper.innerHTML = katex.renderToString(value, { displayMode: display, output: "htmlAndMathml" });
  host.appendChild(wrapper);
  return wrapper;
}

function firstNonEmptyTextNode(node: Node): Text | null {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    if (current.textContent) return current as Text;
    current = walker.nextNode();
  }
  return null;
}

function selectNodeContents(node: Node): Range {
  const range = document.createRange();
  range.selectNodeContents(node);
  return range;
}

describe("math-aware selection conversion", () => {
  it("converts each rendered formula to its exact source once", () => {
    // KaTeX contains both MathML and visual HTML, but Markdown/plain selection
    // must preserve one exact source token with its original delimiters.
    const host = document.createElement("div");
    host.append("Before ");
    appendMath(host, "\\(x^2\\)", "x^2");
    host.append(" and ");
    appendMath(host, "$y_i$", "y_i");
    host.append(" after");

    const range = selectNodeContents(host);
    expect(rangeContainsMath(range)).toBe(true);
    expect(htmlFragmentToMarkdown(range)).toBe("Before \\(x^2\\) and $y_i$ after");
    expect(htmlFragmentToPlainText(range)).toBe("Before \\(x^2\\) and $y_i$ after");
  });

  it("expands a partial visual-glyph selection to the whole formula", () => {
    // A Range wholly inside KaTeX would otherwise lose the wrapper metadata and
    // copy a fragment of the duplicated visual branch.
    const host = document.createElement("div");
    const wrapper = appendMath(host, "\\[\\frac{s}{7}\\]", "\\frac{s}{7}", true);
    const visualRoot = wrapper.querySelector(".katex-html");
    const visualText = visualRoot ? firstNonEmptyTextNode(visualRoot) : null;
    if (!visualText?.textContent) throw new Error("Expected KaTeX visual text");

    const range = document.createRange();
    range.setStart(visualText, 0);
    range.setEnd(visualText, visualText.textContent.length);

    const normalized = normalizeMathSelectionRange(range);
    expect(normalized.startContainer).toBe(host);
    expect(normalized.endContainer).toBe(host);
    expect(htmlFragmentToMarkdown(range)).toBe("\\[\\frac{s}{7}\\]");
    expect(htmlFragmentToPlainText(range)).toBe("\\[\\frac{s}{7}\\]");
  });

  it("keeps repeated equal formulas repeated while deduplicating each DOM subtree", () => {
    const host = document.createElement("div");
    appendMath(host, "$x$", "x");
    host.append(" + ");
    appendMath(host, "$x$", "x");

    expect(htmlFragmentToMarkdown(selectNodeContents(host))).toBe("$x$ + $x$");
  });

  it("builds portable rich HTML with escaped source instead of KaTeX internals", () => {
    const host = document.createElement("div");
    host.append("Formula: ");
    appendMath(host, '\\(x < y & \\"z\\"\\)', "x < y");

    const result = htmlFragmentToRichText(selectNodeContents(host));
    expect(result.plainText).toBe('Formula: \\(x < y & \\"z\\"\\)');
    expect(result.html).not.toContain("katex-mathml");
    expect(result.html).not.toContain("katex-html");
    expect(result.html).toContain('data-takode-math-source="true"');
    expect(result.html).toContain("&lt;");
    expect(result.html).toContain("&amp;");
  });

  it("uses the math-aware walker for whole-table plain and rich copy", () => {
    const table = document.createElement("table");
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.append("Value: ");
    appendMath(cell, String.raw`\(x^2\)`, "x^2");

    const host = document.createElement("div");
    host.appendChild(table);
    const range = document.createRange();
    range.selectNode(table);

    expect(htmlFragmentToMarkdown(range)).toContain(String.raw`Value: \(x^2\)`);
    expect(htmlFragmentToPlainText(range)).toBe(String.raw`Value: \(x^2\)`);
    expect(htmlFragmentToRichText(range).plainText).toBe(String.raw`Value: \(x^2\)`);
  });

  it("falls back to the TeX annotation when wrapper metadata is absent", () => {
    const host = document.createElement("div");
    host.innerHTML = katex.renderToString("a+b", { output: "htmlAndMathml" });

    expect(htmlFragmentToMarkdown(selectNodeContents(host))).toBe("$a+b$");
    expect(htmlFragmentToPlainText(selectNodeContents(host))).toBe("$a+b$");
  });
});
