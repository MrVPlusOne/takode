/**
 * Ink & Paper's paper and silk textures are a static stylesheet, so these tests guard its rules:
 * it must touch nothing outside Ink & Paper, must not trap menus under content, and every texture
 * it names must ship as a versioned file the server can cache for good.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
// Read from disk: Vitest stubs CSS imports (even `?raw`) to an empty string, which would make
// every check below pass vacuously.
const css = readFileSync(join(here, "ink-textures.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The selector lists of every rule, each split at its top-level commas. */
function topLevelSelectors(source: string): string[] {
  const selectors: string[] = [];
  for (const match of source.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    let depth = 0;
    let current = "";
    for (const char of match[1]!) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        selectors.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    selectors.push(current.trim());
  }
  return selectors.filter(Boolean);
}

describe("Ink & Paper textures", () => {
  it("applies only while Ink & Paper is on", () => {
    // Off, Summer Meadow and Seaside must look exactly as before, so every selector needs the
    // `scenic-ink` class that only Ink & Paper puts on <html>.
    const selectors = topLevelSelectors(css);
    expect(selectors.length).toBeGreaterThan(5);
    expect(selectors.filter((selector) => !selector.includes(".scenic-ink"))).toEqual([]);
  });

  it("adds no stacking context, so menus inside textured surfaces stay on top", () => {
    // Textures are backgrounds and `background-blend-mode` only; `mix-blend-mode`, filters, masks
    // or opacity would make each surface a stacking context and trap its menus under later content.
    const stacking =
      /(?:^|[;{\s])(isolation|z-index|transform|filter|backdrop-filter|opacity|will-change|perspective|contain|mix-blend-mode|clip-path|mask(?:-image)?)\s*:/g;
    expect([...css.matchAll(stacking)].map((match) => match[1])).toEqual([]);
  });

  it("names only bundled, versioned texture files", () => {
    // The server caches `scenic/*.vN.webp` as immutable, so a repainted tile needs a new version
    // rather than the same name, and a missing file would silently show a flat surface.
    const publicDir = join(here, "../../public");
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((match) => match[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url).toMatch(/^\/scenic\/ink-tex-[a-z-]+\.v\d+\.webp$/);
      expect(existsSync(join(publicDir, url))).toBe(true);
    }
  });
});
