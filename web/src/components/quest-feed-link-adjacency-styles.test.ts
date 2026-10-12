import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

function ruleBody(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  expect(match, `missing ${selector} rule`).not.toBeNull();
  return match?.[1] ?? "";
}

describe("chat-feed quest link adjacency styles", () => {
  it("keeps the pair atomic to surrounding layouts without blockifying the wrapped anchor", async () => {
    // The wrapper must be one non-shrinking host item, while the direct anchor
    // stays inline so getClientRects() can retain one fragment per wrapped line.
    const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
    const pair = ruleBody(css, ".cc-feed-quest-link-pair");
    const anchor = ruleBody(css, ".cc-feed-quest-link-pair > .cc-quest-link");
    const eye = ruleBody(css, ".cc-feed-quest-preview-trigger");

    expect(pair).toContain("display: inline-block");
    expect(pair).toContain("max-width: 100%");
    expect(pair).toContain("flex-shrink: 0");
    expect(pair).toContain("white-space: nowrap");
    expect(pair).not.toContain("display: inline-flex");
    expect(anchor).toContain("white-space: normal");
    // A hair of space after the link, about a sixth of a space; it used to be 2 px plus a
    // 26 px (44 px on touch) box that left wide gaps around the icon.
    expect(eye).toContain("margin-inline-start: 0.12em");
  });

  it("keeps the eye from making its line taller and hides it on touch-first devices", async () => {
    // A box taller than the text pushed lines with quest links apart; negative block margins
    // keep the eye out of the line height, and touch hit area comes from an ::after overlay
    // rather than the layout box. Phones drop the eye because tapping the link previews.
    const css = await readFile(new URL("../index.css", import.meta.url), "utf8");
    const eye = ruleBody(css, ".cc-feed-quest-preview-trigger");
    expect(eye).toContain("height: 1.2em");
    expect(eye).toContain("margin-block: -0.3em");
    expect(css).toMatch(
      /@media \(hover: none\) and \(pointer: coarse\) \{\s*\.cc-feed-quest-preview-trigger \{\s*display: none;/,
    );
    expect(ruleBody(css, ".cc-feed-quest-preview-trigger-force-coarse::after")).toContain("width: 44px");
  });
});
