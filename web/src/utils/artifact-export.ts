/**
 * Exports of a card's content as files: the Markdown as written, and a standalone web page built
 * from what the card shows (Takode's own styles, images inlined, light theme, no controls), which
 * the server's headless Chrome prints as a PDF or captures as one long PNG.
 */

export type ExportFormat = "markdown" | "html" | "pdf" | "png";

/** How the Export submenu names each format. */
export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  markdown: "Markdown (.md)",
  pdf: "PDF (.pdf)",
  png: "Image (.png)",
  html: "Web page (.html)",
};

/**
 * Saves a card's content in `format`. `content` is the element showing it (its Markdown body is
 * exported); `markdown` is the text as written. Rejects with a message the card can show.
 */
export async function exportContent(
  format: ExportFormat,
  { markdown, content, title }: { markdown: string; content: HTMLElement | null; title: string },
): Promise<void> {
  const name = exportFileName(title);
  if (format === "markdown") {
    saveFile(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
    return;
  }
  if (!content) throw new Error("Nothing to export yet.");
  const html = await standaloneHtml(content, title);
  if (format === "html") {
    saveFile(new Blob([html], { type: "text/html;charset=utf-8" }), `${name}.html`);
    return;
  }
  saveFile(await renderDocument(html, format), `${name}.${format}`);
}

/**
 * A standalone web page printed as a PDF or captured as a PNG by the server's headless Chrome,
 * laid out `width` CSS pixels wide (its default when absent).
 */
export async function renderDocument(html: string, format: "pdf" | "png", width?: number): Promise<Blob> {
  const response = await fetch("/api/exports/document", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, format, ...(width ? { width } : {}) }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Export failed (${response.status}).`);
  }
  return response.blob();
}

/** A visual as a PNG, drawn by the server in the light theme at desktop width. */
export async function exportVisualImage(source: string, title: string): Promise<void> {
  const response = await fetch("/api/visuals/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, theme: "light" }),
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(error?.error ?? `Export failed (${response.status}).`);
  }
  saveFile(await response.blob(), `${exportFileName(title)}.png`);
}

/** A file name from a title: lowercase words joined by dashes. */
export function exportFileName(title: string): string {
  const name = title
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  return name || "export";
}

/**
 * A web page holding the Markdown body inside `content` as the card shows it, in the light theme:
 * controls and comment overlays left out, images inlined so the file stands alone, visuals kept as
 * their still pictures.
 */
export async function standaloneHtml(content: HTMLElement, title: string): Promise<string> {
  const body = content.matches(".markdown-body") ? content : content.querySelector<HTMLElement>(".markdown-body");
  if (!body) throw new Error("Nothing to export yet.");
  return standalonePage(body, title, EXPORT_STYLES);
}

/**
 * A web page holding a copy of `content` in the light theme, with Takode's style rules and `styles`
 * after them: controls and comment overlays left out, images inlined, visuals kept as still pictures.
 */
export async function standalonePage(content: HTMLElement, title: string, styles: string): Promise<string> {
  const copy = content.cloneNode(true) as HTMLElement;
  for (const element of copy.querySelectorAll(
    "[data-copy-exclude], [data-read-aloud-player], [data-annotation-overlay], button, iframe[data-live]",
  )) {
    element.remove();
  }
  for (const frame of copy.querySelectorAll<HTMLIFrameElement>("iframe[srcdoc]")) {
    // Still pictures are drawn for the theme on screen; the export is light.
    frame.srcdoc = frame.srcdoc.replace(/^<!doctype html><html class="dark"/i, '<!doctype html><html class=""');
    frame.removeAttribute("sandbox");
  }
  await inlineImages(content, copy);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    // Fonts and other assets the styles name load from this Takode while it is reachable.
    `<base href="${escapeHtml(window.location.origin)}/">`,
    `<style>${appStyles()}\n${styles}</style>`,
    "</head>",
    `<body><main class="takode-export">${copy.outerHTML}</main></body>`,
    "</html>",
  ].join("\n");
}

/** Hands a file to the browser's downloads. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

const EXPORT_STYLES = `
@page { margin: 16mm; }
html, body { background: #fff; color-scheme: light; }
body { margin: 0; }
.takode-export { max-width: 760px; margin: 0 auto; padding: 32px 24px; }
.takode-export .markdown-body { overflow: visible; }
/* A page has no sideways scrolling: long code lines wrap and scrolling boxes show everything. */
.takode-export pre, .takode-export pre code { white-space: pre-wrap !important; overflow-wrap: anywhere; }
.takode-export pre, .takode-export .overflow-x-auto, .takode-export .overflow-auto { overflow: visible !important; }
@media print { .takode-export { padding: 0; max-width: none; } }
`;

/** The page's own style rules, so the export looks like the card. */
function appStyles(): string {
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) rules.push(rule.cssText);
    } catch {
      // A stylesheet from another origin can't be read; the export does without it.
    }
  }
  return rules.join("\n").replace(/<\/style/gi, "<\\/style");
}

/** Replaces each image's source in `copy` with its bytes, read from the original in `source`. */
async function inlineImages(source: HTMLElement, copy: HTMLElement): Promise<void> {
  const originals = Array.from(source.querySelectorAll("img"));
  const copies = Array.from(copy.querySelectorAll("img"));
  await Promise.all(
    copies.map(async (image, index) => {
      const original = originals[index];
      const url = original?.currentSrc || original?.src || image.src;
      if (!url || url.startsWith("data:")) return;
      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) return;
        image.src = await dataUrl(await response.blob());
        image.removeAttribute("srcset");
        image.removeAttribute("loading");
      } catch (error) {
        console.warn("[export] Could not inline an image", url, error);
      }
    }),
  );
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
