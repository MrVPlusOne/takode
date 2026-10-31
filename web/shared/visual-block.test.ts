import { describe, expect, it } from "vitest";
import {
  buildVisualDocument,
  markdownWithVisualFallbacks,
  parseVisualBlock,
  visualFallbackText,
  visualIsInteractive,
  visualPlainText,
  visualUsesScripts,
} from "./visual-block.js";
import { markdownToPlainText } from "./markdown-plain-text.js";

describe("parseVisualBlock", () => {
  it("reads the title and alt header above the --- line", () => {
    const block = parseVisualBlock('title: Pipeline\nalt: Three stages.\n---\n<div class="tk-flow"></div>');
    expect(block).toEqual({ title: "Pipeline", alt: "Three stages.", html: '<div class="tk-flow"></div>' });
  });

  it("reads an optional caption, the line shown under the visual", () => {
    const block = parseVisualBlock("title: T\nalt: A\ncaption: Figure 1. Each stage narrows.\n---\n<div></div>");
    expect(block.caption).toBe("Figure 1. Each stage narrows.");
  });

  it("treats a body without a header as plain HTML, even when it contains ---", () => {
    // A horizontal rule or a Mermaid edge in the HTML must not be mistaken for the header separator.
    const source = "<p>a</p>\n---\n<p>b</p>";
    expect(parseVisualBlock(source)).toEqual({ html: source });
  });
});

describe("visual fallbacks", () => {
  it("prefers the agent's alt text, prefixed by the title", () => {
    expect(visualFallbackText({ title: "T", alt: "A", html: "<b>x</b>" })).toBe("T: A");
  });

  it("falls back to the visible text when there is no alt", () => {
    expect(visualFallbackText({ html: "<style>.x{}</style><div>Bake &amp; publish</div><script>1</script>" })).toBe(
      "Bake & publish",
    );
  });

  it("adds the caption to plain-text surfaces, since readers see it under the visual", () => {
    // Read aloud, Copy for Slack and search use this text; a takeaway caption must not be lost there.
    expect(visualPlainText({ title: "T", alt: "A", caption: "C.", html: "" })).toBe("T: A C.");
    expect(visualPlainText({ title: "T", alt: "A", html: "" })).toBe("T: A");
    expect(markdownWithVisualFallbacks("```visual\nalt: A\ncaption: C.\n---\n<div></div>\n```")).toBe("[Visual] A C.");
  });

  it("replaces each visual fence in Markdown and leaves other fences alone", () => {
    const markdown = "Lead.\n\n```visual\nalt: Two boxes.\n---\n<div></div>\n```\n\n```ts\nconst a = 1;\n```";
    const result = markdownWithVisualFallbacks(markdown);
    expect(result).toContain("[Visual] Two boxes.");
    expect(result).toContain("```ts\nconst a = 1;\n```");
    // Plain-text surfaces (copy, previews) read the alt, never the HTML.
    expect(markdownToPlainText(markdown)).not.toContain("<div>");
  });
});

describe("buildVisualDocument", () => {
  it("loads the diagram helper only in live mode and only when the visual uses it", () => {
    const html = '<pre class="tk-mermaid">flowchart TB\na-->b</pre>';
    const live = buildVisualDocument({
      html,
      theme: "dark",
      mode: "live",
      assetBase: "https://t.example",
      frameId: "v1",
    });
    const snapshot = buildVisualDocument({
      html,
      theme: "dark",
      mode: "static",
      assetBase: "https://t.example",
      frameId: "v1",
    });
    expect(live).toContain("https://t.example/visual-kit/lib/mermaid.min.js");
    expect(snapshot).not.toContain("mermaid.min.js");
    expect(live).toContain('<html class="dark" data-tk-mode="live">');
  });

  it("gives every frame the kit's arrowhead, so SVG arrows need no definitions of their own", () => {
    // `.tk-edge` lines end in `url(#tk-arrow)`, which must exist in live and still frames alike.
    for (const mode of ["live", "static"] as const) {
      const doc = buildVisualDocument({ html: "<svg></svg>", theme: "light", mode, assetBase: "", frameId: "v" });
      expect(doc).toContain('<marker id="tk-arrow"');
    }
  });

  it("tells diagrams, which look the same as their still picture, from interactive visuals", () => {
    expect(visualIsInteractive('<pre class="tk-mermaid">flowchart TB\na-->b</pre>')).toBe(false);
    expect(visualIsInteractive('<script type="application/json" class="tk-chart">{}</script>')).toBe(true);
    expect(visualIsInteractive('<button onclick="go()">x</button>')).toBe(true);
  });

  it("knows which visuals need scripts", () => {
    expect(visualUsesScripts('<div class="tk-stats"></div>')).toBe(false);
    expect(visualUsesScripts('<script type="application/json" class="tk-chart">{}</script>')).toBe(true);
    expect(visualUsesScripts("<script>1</script>")).toBe(true);
  });
});
