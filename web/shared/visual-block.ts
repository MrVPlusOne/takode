/**
 * Visual blocks: rich visuals agents write as a ```visual fence in any Markdown
 * (chat answers, reports, guided reviews). The fence body is HTML, CSS and SVG,
 * optionally with scripts and Takode's diagram helpers, under a short header:
 *
 *     ```visual
 *     title: How the landing queue works
 *     alt: Plain-text version, used by read aloud, Copy for Slack and search.
 *     ---
 *     <div class="tk-flow">...</div>
 *     ```
 *
 * The visual always runs in a sandboxed frame (see VisualBlock.tsx); this module
 * holds what the browser, the server renderer and the CLI share: parsing, the
 * plain-text fallback and the frame document.
 */
import { VISUAL_KIT_BOOTSTRAP, VISUAL_KIT_CSS } from "./visual-kit.js";

export interface VisualBlock {
  title?: string;
  /** Plain-text version written by the agent; the fallback wherever HTML can't go. */
  alt?: string;
  html: string;
}

export type VisualTheme = "dark" | "light";

/**
 * How the frame runs: `live` runs the agent's scripts and helpers; `static` shows a
 * snapshot whose scripts were already run elsewhere (or a script-free visual), so
 * only Takode's own frame script runs.
 */
export type VisualFrameMode = "live" | "static";

/** Largest visual source Takode renders; bigger ones show their fallback text. */
export const VISUAL_MAX_SOURCE_BYTES = 256 * 1024;

/** Visuals with more elements than this are not drawn; their text is shown instead. */
export const VISUAL_MAX_ELEMENTS = 6000;

/** Largest script-free snapshot the server hands to a browser. */
export const VISUAL_MAX_SNAPSHOT_BYTES = 1024 * 1024;

/** Fence language that marks a visual block. */
export const VISUAL_FENCE_LANG = "visual";

const HEADER_KEYS = new Set(["title", "alt"]);

/** Split a fence body into its optional `key: value` header and the HTML below `---`. */
export function parseVisualBlock(source: string): VisualBlock {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const separator = lines.findIndex((line) => line.trim() === "---");
  if (separator > 0) {
    const header = lines.slice(0, separator);
    const fields = new Map<string, string>();
    const isHeader = header.every((line) => {
      if (!line.trim()) return true;
      const match = /^\s*([a-z]+)\s*:\s*(.*)$/i.exec(line);
      if (!match || !HEADER_KEYS.has(match[1]!.toLowerCase())) return false;
      fields.set(match[1]!.toLowerCase(), match[2]!.trim());
      return true;
    });
    if (isHeader) {
      return {
        title: fields.get("title") || undefined,
        alt: fields.get("alt") || undefined,
        html: lines.slice(separator + 1).join("\n"),
      };
    }
  }
  return { html: source };
}

/**
 * True when the visual runs code: its own scripts, inline event handlers, `javascript:`
 * links, or a Takode helper. A visual without any shows the same with or without scripts.
 */
export function visualUsesScripts(html: string): boolean {
  return (
    /<script\b/i.test(html) ||
    /<[^>]+\son[a-z]+\s*=/i.test(html) ||
    /javascript:/i.test(html) ||
    usesMermaid(html) ||
    usesChart(html)
  );
}

/**
 * True when running the visual does something its still picture can't: scripts (including
 * charts, which respond to hover and inputs), inline handlers or `javascript:` links. A diagram
 * drawn by the Mermaid helper looks and behaves the same as its still picture.
 */
export function visualIsInteractive(html: string): boolean {
  return /<script\b/i.test(html) || /<[^>]+\son[a-z]+\s*=/i.test(html) || /javascript:/i.test(html);
}

/** Readable text for a visual where HTML can't go: its alt, else its title, else its visible text. */
export function visualFallbackText(block: VisualBlock): string {
  if (block.alt) return block.title ? `${block.title}: ${block.alt}` : block.alt;
  const text = block.html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return [block.title, text].filter(Boolean).join(": ");
}

const VISUAL_FENCE_PATTERN = /^([ \t]*)(`{3,}|~{3,})[ \t]*visual[ \t]*\n([\s\S]*?)\n\1\2[ \t]*$/gm;

/** Replace every visual fence in Markdown with `render(block)`; used for plain-text surfaces. */
export function replaceVisualFences(markdown: string, render: (block: VisualBlock) => string): string {
  if (!markdown.includes("visual")) return markdown;
  return markdown.replace(VISUAL_FENCE_PATTERN, (_match, indent: string, _fence, body: string) => {
    return `${indent}${render(parseVisualBlock(body))}`;
  });
}

/** Markdown with each visual replaced by its plain-text fallback, as an italic-free paragraph. */
export function markdownWithVisualFallbacks(markdown: string): string {
  return replaceVisualFences(markdown, (block) => `[Visual] ${visualFallbackText(block)}`);
}

export interface VisualDocumentOptions {
  html: string;
  theme: VisualTheme;
  mode: VisualFrameMode;
  /** Origin the frame loads helper libraries from, such as `https://takode.example`. */
  assetBase: string;
  /** Identifies the frame in its messages to the page. */
  frameId: string;
}

/**
 * The complete frame document: Takode's kit stylesheet and theme, the visual, and
 * Takode's frame script (size reports, heartbeats, helpers). In `static` mode no
 * helper libraries load and the frame script renders nothing itself.
 */
export function buildVisualDocument(options: VisualDocumentOptions): string {
  const { html, theme, mode, assetBase, frameId } = options;
  const helpers: string[] = [];
  if (mode === "live" && usesMermaid(html)) helpers.push("mermaid.min.js");
  if (mode === "live" && usesChart(html)) helpers.push("vega.min.js", "vega-lite.min.js", "vega-embed.min.js");
  const helperScripts = helpers
    .map((file) => `<script src="${escapeAttribute(`${assetBase}/visual-kit/lib/${file}`)}"></script>`)
    .join("");
  const config = JSON.stringify({ id: frameId, theme, mode }).replace(/</g, "\\u003c");
  return [
    "<!doctype html>",
    `<html class="${theme}" data-tk-mode="${mode}">`,
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style id="tk-kit">${VISUAL_KIT_CSS}</style>`,
    `<script id="tk-frame">window.__tkVisualConfig=${config};${VISUAL_KIT_BOOTSTRAP}</script>`,
    helperScripts,
    "</head>",
    `<body>${html}</body>`,
    "</html>",
  ].join("");
}

/** Stable short hash of a visual's source, for caches and remembered failures. */
export function visualSourceHash(source: string): string {
  // FNV-1a, 52 bits: cheap, synchronous and the same in the browser and on the server.
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < source.length; i++) {
    hash ^= BigInt(source.charCodeAt(i));
    hash = (hash * 0x100000001b3n) & 0xfffffffffffffn;
  }
  return hash.toString(36);
}

function usesMermaid(html: string): boolean {
  return /class\s*=\s*["'][^"']*\btk-mermaid\b/i.test(html);
}

function usesChart(html: string): boolean {
  return /class\s*=\s*["'][^"']*\btk-chart\b/i.test(html);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
