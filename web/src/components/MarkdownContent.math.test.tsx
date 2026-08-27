// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "../store.js";
import { MarkdownContent } from "./MarkdownContent.js";
import {
  MAX_BACKSLASH_COMPAT_SOURCE_LENGTH,
  MAX_MATH_SOURCE_LENGTH,
  prepareMarkdownMathSource,
} from "../utils/markdown-math.js";

function mathWrappers(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".takode-math"));
}

function expectAccessibleKatex(wrapper: HTMLElement): void {
  expect(wrapper.querySelectorAll(".katex-mathml")).toHaveLength(1);
  expect(wrapper.querySelectorAll("math")).toHaveLength(1);
  expect(wrapper.querySelectorAll('.katex-html[aria-hidden="true"]')).toHaveLength(1);
}

describe("MarkdownContent math rendering", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("renders inline and display dollar delimiters with accessible KaTeX output", () => {
    // Same-line `$$...$$` must be display math even though stock remark-math
    // classifies that form as inline math.
    const { container } = render(
      <MarkdownContent text={"Inline $x_i + y_i$.\n\n$$x^2 + y^2$$\n\n$$\n\\frac{1}{2}\n$$"} />,
    );

    const wrappers = mathWrappers(container);
    expect(wrappers).toHaveLength(3);
    expect(wrappers[0].classList.contains("takode-math-inline")).toBe(true);
    expect(wrappers[0].getAttribute("data-math-source")).toBe("$x_i + y_i$");
    expect(wrappers[1].classList.contains("takode-math-display")).toBe(true);
    expect(wrappers[1].getAttribute("data-math-source")).toBe("$$x^2 + y^2$$");
    expect(wrappers[2].classList.contains("takode-math-display")).toBe(true);
    expect(wrappers[2].getAttribute("data-math-source")).toBe("$$\n\\frac{1}{2}\n$$");
    for (const wrapper of wrappers) expectAccessibleKatex(wrapper);
  });

  it("renders the exact stored backslash-delimiter source without rewriting it", () => {
    const source = "For a utility score \\(s\\) from 1 to 7:\n\n\\[\n\\left(\\frac{s}{7}\\right)^2\n\\]";
    const { container } = render(<MarkdownContent text={source} />);

    const wrappers = mathWrappers(container);
    expect(wrappers).toHaveLength(2);
    expect(wrappers[0].classList.contains("takode-math-inline")).toBe(true);
    expect(wrappers[0].getAttribute("data-math-source")).toBe("\\(s\\)");
    expect(wrappers[1].classList.contains("takode-math-display")).toBe(true);
    expect(wrappers[1].getAttribute("data-math-source")).toBe("\\[\n\\left(\\frac{s}{7}\\right)^2\n\\]");
    for (const wrapper of wrappers) expectAccessibleKatex(wrapper);
  });

  it("renders multiline display environments containing TeX line breaks", () => {
    // A display formula may contain `\\` row separators; the compatibility
    // scan must not terminate early and expose following lines as Markdown lists.
    const source = String.raw`\[
\begin{aligned}
R(\theta) &= \sum_{i=1}^{24} \alpha_i \left(\frac{x_i - \mu_i}{\sigma_i}\right)^2
+ \lambda \prod_{j=1}^{16}\left(1 + \frac{\beta_j}{1 + e^{-z_j}}\right) \\
&\quad + \int_{0}^{T} \left\|A(t)\theta - b(t)\right\|_2^2\,dt
\end{aligned}
\]`;
    const { container } = render(<MarkdownContent text={source} />);

    const wrappers = mathWrappers(container);
    expect(wrappers).toHaveLength(1);
    expect(wrappers[0].classList.contains("takode-math-display")).toBe(true);
    expect(wrappers[0].getAttribute("data-math-source")).toBe(source);
    expect(wrappers[0].querySelector("annotation")?.textContent).toContain("\\begin{aligned}");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("uses parser-derived boundaries around CommonMark code, HTML, definitions, and images", () => {
    const nestedFences = [
      "- ```tex",
      String.raw`  \(list code\)`,
      "  ```",
      "- ~~~tex",
      String.raw`  \[tilde code\]`,
      "  ~~~",
      "",
      String.raw`After \(nested fences\).`,
    ].join("\n");
    const nested = render(<MarkdownContent text={nestedFences} />).container;
    expect(nested.querySelectorAll("pre code")).toHaveLength(2);
    expect(nested.querySelectorAll("pre code")[0]?.textContent).toContain(String.raw`\(list code\)`);
    expect(nested.querySelectorAll("pre code")[1]?.textContent).toContain(String.raw`\[tilde code\]`);
    expect(mathWrappers(nested)).toHaveLength(1);

    const indented = render(
      <MarkdownContent text={["    ```", String.raw`Valid \(after indent\).`].join("\n")} />,
    ).container;
    expect(indented.querySelector("pre code")?.textContent).toContain("```");
    expect(mathWrappers(indented)).toHaveLength(1);

    const realFence = render(
      <MarkdownContent
        text={["```tex", "    ```", String.raw`\(still code\)`, "```", "", String.raw`After \(real fence\).`].join(
          "\n",
        )}
      />,
    ).container;
    expect(realFence.querySelector("pre code")?.textContent).toContain(String.raw`\(still code\)`);
    expect(mathWrappers(realFence)).toHaveLength(1);

    const protectedBlocks = [
      "<div>",
      String.raw`\(raw html\)`,
      "</div>",
      "",
      String.raw`[ref]: /url "title`,
      String.raw`  \(definition\)"`,
      "",
      String.raw`After \(protected blocks\).`,
    ].join("\n");
    const protectedContainer = render(<MarkdownContent text={protectedBlocks} />).container;
    expect(protectedContainer.textContent).toContain(String.raw`\(raw html\)`);
    expect(mathWrappers(protectedContainer)).toHaveLength(1);

    for (const container of [nested, indented, realFence, protectedContainer]) {
      expect(container.innerHTML).not.toMatch(/[\uE000-\uF8FF\uFDD0-\uFDEF]/);
    }
  });

  it("renders TeX punctuation that resembles HTML and Markdown links", () => {
    const source = String.raw`\(0 < x > -1\), \[a < b > c\], and \(f[x](y)\).`;
    const { container } = render(<MarkdownContent text={source} />);

    const wrappers = mathWrappers(container);
    expect(wrappers).toHaveLength(3);
    expect(wrappers.map((wrapper) => wrapper.getAttribute("data-math-source"))).toEqual([
      String.raw`\(0 < x > -1\)`,
      String.raw`\[a < b > c\]`,
      String.raw`\(f[x](y)\)`,
    ]);
    for (const wrapper of wrappers) expectAccessibleKatex(wrapper);
  });

  it("normalizes container prefixes out of blockquote and list display source", () => {
    const source = [
      String.raw`> \[`,
      "> x + y",
      String.raw`> \]`,
      "",
      "> $$",
      "> a + b",
      "> $$",
      "",
      String.raw`- \[`,
      "  c + d",
      String.raw`  \]`,
      "",
      "- $$",
      "  e + f",
      "  $$",
    ].join("\n");
    const { container } = render(<MarkdownContent text={source} />);

    expect(mathWrappers(container).map((wrapper) => wrapper.getAttribute("data-math-source"))).toEqual([
      String.raw`\[
x + y
\]`,
      "$$\na + b\n$$",
      String.raw`\[
c + d
\]`,
      "$$\ne + f\n$$",
    ]);
  });

  it("does not pair display delimiters across table cells or block-container boundaries", () => {
    const cases = [
      String.raw`| A | B |
|---|---|
| \[a | b\] |`,
      String.raw`> \[
> x

\]`,
      String.raw`- \[
  x

\]`,
      String.raw`# \[x
y\]`,
      String.raw`\[x
---
y\]`,
      String.raw`\[
x + y \]`,
      String.raw`Intro \[x
# y
z\]`,
      String.raw`Title \[x
---
y\]`,
      String.raw`\[x

y\]`,
    ];

    for (const source of cases) {
      const { container, unmount } = render(<MarkdownContent text={source} />);
      expect(mathWrappers(container)).toHaveLength(0);
      expect(container.textContent).not.toContain("$$");
      expect(container.innerHTML).not.toMatch(/[\uE000-\uF8FF\uFDD0-\uFDEF]/);
      unmount();
    }
  });

  it("preserves math source in image alt text without regressing CommonMark decoding", () => {
    const source = String.raw`![escaped \*star\*, plain **bold**, backslash \(x\), dollar $y_i$, lone \]](https://example.com/formula.png)`;
    const { container } = render(<MarkdownContent text={source} />);

    expect(mathWrappers(container)).toHaveLength(0);
    expect(container.querySelector("img")?.getAttribute("alt")).toBe(
      String.raw`escaped *star*, plain bold, backslash \(x\), dollar $y_i$, lone ]`,
    );
    expect(container.innerHTML).not.toMatch(/[\uE000-\uF8FF\uFDD0-\uFDEF]/);
  });

  it("keeps ordinary escaped image alt text on baseline CommonMark semantics", () => {
    const source = String.raw`![a \] b, \*star\*, and \\ slash](https://example.com/plain.png)`;
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelector("img")?.getAttribute("alt")).toBe("a ] b, *star*, and \\ slash");
  });

  it("leaves code spans, fenced code, and escaped delimiter literals untouched", () => {
    // Parser-level compatibility must defer to Markdown code constructs instead
    // of rewriting their source before CommonMark sees it.
    const source =
      "Inline code `\\(x\\) and $y$` plus escaped literals \\\\(x\\\\) and \\$z\\$.\n\n```tex\n\\[x^2\\] and $y$\n```";
    const { container } = render(<MarkdownContent text={source} />);

    expect(mathWrappers(container)).toHaveLength(0);
    expect(container.querySelector("p code")?.textContent).toBe("\\(x\\) and $y$");
    expect(container.querySelector("pre code")?.textContent).toContain("\\[x^2\\] and $y$");
    expect(container.textContent).toContain("escaped literals \\(x\\) and $z$");
  });

  it("keeps currency, unmatched delimiters, and ordinary punctuation literal", () => {
    // Stock remark-math incorrectly treats the two currency markers as one
    // formula and accepts an unclosed display fence through EOF.
    const source = "Prices are $5 and $10. Keep \\(open and \\[display open.\n\n$$\nx + 1";
    const { container } = render(<MarkdownContent text={source} />);

    expect(mathWrappers(container)).toHaveLength(0);
    expect(container.textContent).toContain("Prices are $5 and $10.");
    expect(container.textContent).toContain("\\(open");
    expect(container.textContent).toContain("\\[display open");
    expect(container.textContent).toContain("$$\nx + 1");
  });

  it("restores unsupported, untrusted, oversized, and over-expanded formulas as exact source", () => {
    // KaTeX failures are deliberately readable source, never partial HTML or
    // executable/trusted output.
    const formulas = [
      "$\\notARealCommand{x}$",
      "$\\href{javascript:alert(1)}{click}$",
      "$\\rule{100em}{1em}$",
      "$\\def\\loop{\\loop}\\loop$",
    ];
    const { container } = render(<MarkdownContent text={formulas.join(" ")} />);

    const wrappers = mathWrappers(container);
    expect(wrappers).toHaveLength(formulas.length);
    expect(wrappers.slice(0, 2).map((wrapper) => wrapper.textContent)).toEqual(formulas.slice(0, 2));
    expect(wrappers[3].textContent).toBe(formulas[3]);
    expect(wrappers[0].classList.contains("takode-math-error")).toBe(true);
    expect(wrappers[1].classList.contains("takode-math-error")).toBe(true);
    expect(wrappers[2].classList.contains("takode-math-error")).toBe(false);
    expect(wrappers[2].innerHTML).toMatch(/(?:width|border-right-width):\s*20em/);
    expect(wrappers[2].innerHTML).not.toMatch(/(?:width|border-right-width):\s*100em/);
    expect(wrappers[3].classList.contains("takode-math-error")).toBe(true);
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("style")).toBeNull();
  });

  it("falls back before KaTeX when a formula exceeds the source budget", () => {
    const source = String.raw`\(` + "x".repeat(MAX_MATH_SOURCE_LENGTH + 1) + String.raw`\)`;
    const { container } = render(<MarkdownContent text={source} />);

    expect(mathWrappers(container)).toHaveLength(0);
    expect(container.textContent).toBe(source);
    expect(container.innerHTML.length).toBeLessThan(source.length * 2);
  });

  it("keeps compatibility preprocessing bounded and nonthrowing on adversarial markers", () => {
    const privateUse = Array.from({ length: 0xf8ff - 0xe000 + 1 }, (_, index) =>
      String.fromCharCode(0xe000 + index),
    ).join("");
    const withBmpPrivateUse = `${privateUse} ${String.raw`\(x\)`}`;
    const prepared = prepareMarkdownMathSource(withBmpPrivateUse);
    expect(prepared.renderText).toHaveLength(withBmpPrivateUse.length);

    const allCandidates =
      privateUse +
      Array.from({ length: 0xfdef - 0xfdd0 + 1 }, (_, index) => String.fromCharCode(0xfdd0 + index)).join("") +
      String.raw`\(x\)`;
    expect(() => prepareMarkdownMathSource(allCandidates)).not.toThrow();
    expect(prepareMarkdownMathSource(allCandidates).renderText).toBe(allCandidates);
    const exhaustedContainer = render(<MarkdownContent text={allCandidates} />).container;
    expect(mathWrappers(exhaustedContainer)).toHaveLength(0);
    expect(exhaustedContainer.textContent?.endsWith(String.raw`\(x\)`)).toBe(true);

    const overGate = "a".repeat(MAX_BACKSLASH_COMPAT_SOURCE_LENGTH + 1) + String.raw` \(x\) and \[open`;
    const overGateContainer = render(<MarkdownContent text={overGate} />).container;
    expect(mathWrappers(overGateContainer)).toHaveLength(0);
    expect(overGateContainer.textContent?.endsWith(String.raw`\(x\) and \[open`)).toBe(true);

    const malformed = String.raw`\(` + "\\".repeat(32_000);
    expect(() => prepareMarkdownMathSource(malformed)).not.toThrow();
    expect(prepareMarkdownMathSource(malformed).renderText).toHaveLength(malformed.length);
  });

  it("does not synthesize closing fences from mismatched quote containers", () => {
    const cases = [
      String.raw`$$
x
> $$`,
      String.raw`> $$
> x
> > $$`,
    ];
    for (const source of cases) {
      const { container, unmount } = render(<MarkdownContent text={source} />);
      expect(mathWrappers(container)).toHaveLength(0);
      expect(container.textContent).toContain("$$");
      expect(container.textContent?.match(/\$\$/g)?.length).toBe(2);
      unmount();
    }
  });

  it("does not mistake an intentional red formula for a KaTeX parse error", () => {
    const { container } = render(<MarkdownContent text={String.raw`$\color{#cc0000}{x}$`} />);
    const wrapper = mathWrappers(container)[0];

    expect(wrapper.classList.contains("takode-math-error")).toBe(false);
    expectAccessibleKatex(wrapper);
  });

  it("preserves Markdown link destinations while rendering math in link labels", () => {
    const { container } = render(
      <MarkdownContent text={String.raw`[value \(x\)](https://example.com/path?literal=\(y\))`} />,
    );

    const link = container.querySelector<HTMLAnchorElement>('a[href^="https://example.com/path"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toContain("literal=(y)");
    expect(link?.querySelectorAll(".takode-math")).toHaveLength(1);
  });

  it("leaves angle and GFM autolink source outside math compatibility", () => {
    const source = String.raw`<https://example.com/\(angle\)> https://example.com/\(bare\) and formula \(x\).`;
    const { container } = render(<MarkdownContent text={source} />);

    expect(container.querySelectorAll("a")).toHaveLength(2);
    expect(mathWrappers(container)).toHaveLength(1);
    expect(mathWrappers(container)[0].getAttribute("data-math-source")).toBe(String.raw`\(x\)`);
    expect(container.innerHTML).not.toMatch(/[\uE000-\uF8FF\uFDD0-\uFDEF]/);
  });

  it("preserves Takode links and normal Markdown next to formulas", () => {
    const { container } = render(
      <MarkdownContent text={"**Score** $s$; see [q-42](quest:q-42) and [#5](session:5)."} />,
    );

    expect(container.querySelector("strong")?.textContent).toBe("Score");
    expect(mathWrappers(container)).toHaveLength(1);
    expect(container.querySelector(".cc-quest-link")?.textContent).toBe("q-42");
    expect(container.textContent).toContain("#5");
  });

  it("keeps source search highlighting visible for rendered formulas", () => {
    // Message search still indexes source Markdown; when the match only exists in
    // TeX source, the rendered formula wrapper must retain a visible highlight.
    const { container } = render(
      <MarkdownContent
        text={String.raw`Formula: \(\frac{s}{7}\)`}
        searchHighlight={{ query: "frac", mode: "strict", isCurrent: true }}
      />,
    );

    const wrapper = mathWrappers(container)[0];
    expect(wrapper.getAttribute("data-math-highlighted")).toBe("true");
    expect(wrapper.className).toContain("bg-amber-400/70");
  });

  it("rerenders an incomplete streaming delimiter into one completed formula", () => {
    // Streaming updates may temporarily end with an unmatched delimiter. The
    // next render must replace literal text rather than duplicate/remount math.
    const { container, rerender } = render(<MarkdownContent text={"Working: \\(x +"} />);
    expect(mathWrappers(container)).toHaveLength(0);
    expect(container.textContent).toContain("\\(x +");

    rerender(<MarkdownContent text={"Working: \\(x + 1\\)"} />);
    expect(mathWrappers(container)).toHaveLength(1);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.textContent).not.toContain("\\(x +");
  });
});
