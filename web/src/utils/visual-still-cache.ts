/**
 * Still pictures of visuals this tab has already drawn, kept so a visual that scrolls back into
 * view, remounts with its message, or reloads its live frame shows instantly instead of blank.
 *
 * A still is the visual's settled HTML with every script and handler removed: it comes from the
 * live frame itself once it drew, or from the server's check draw. Kept by source and theme, since
 * colours are baked in; the kit reflows it to the current width.
 */
import { VISUAL_MAX_ELEMENTS, VISUAL_MAX_SNAPSHOT_BYTES, type VisualTheme } from "../../shared/visual-block.js";

/** Total size of kept stills; the least recently used go first beyond it. */
const CACHE_BUDGET_CHARS = 24 * 1024 * 1024;

const stills = new Map<string, string>();
let totalChars = 0;

function key(hash: string, theme: VisualTheme): string {
  return `${hash}:${theme}`;
}

/** The kept still of a visual, if any. */
export function visualStill(hash: string, theme: VisualTheme): string | null {
  const id = key(hash, theme);
  const still = stills.get(id);
  if (still === undefined) return null;
  // Most recently used last, so trimming drops the oldest first.
  stills.delete(id);
  stills.set(id, still);
  return still;
}

/**
 * Keep a still. `html` may come from the visual's own frame, so scripts, embedded frames and
 * inline handlers are removed again here; one too large to show is not kept.
 */
export function keepVisualStill(hash: string, theme: VisualTheme, html: string): string | null {
  if (html.length > VISUAL_MAX_SNAPSHOT_BYTES) return null;
  const cleaned = stripVisualScripts(html);
  if (cleaned.elementCount > VISUAL_MAX_ELEMENTS) return null;
  const id = key(hash, theme);
  const previous = stills.get(id);
  if (previous !== undefined) {
    totalChars -= previous.length;
    stills.delete(id);
  }
  stills.set(id, cleaned.html);
  totalChars += cleaned.html.length;
  for (const [oldest, value] of stills) {
    if (totalChars <= CACHE_BUDGET_CHARS || oldest === id) break;
    stills.delete(oldest);
    totalChars -= value.length;
  }
  return cleaned.html;
}

/** Remove scripts, embedded frames and inline handlers; count what is left. */
export function stripVisualScripts(html: string): { html: string; elementCount: number } {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  const all = parsed.body.getElementsByTagName("*");
  for (const element of Array.from(all)) {
    for (const name of element.getAttributeNames()) if (/^on/i.test(name)) element.removeAttribute(name);
  }
  return { html: parsed.body.innerHTML, elementCount: all.length };
}

/** For tests: forget every still. */
export function clearVisualStillsForTest(): void {
  stills.clear();
  totalChars = 0;
}
