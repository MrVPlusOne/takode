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
    expect(eye).toContain("margin-inline-start: 2px");
  });
});
