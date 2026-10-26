import { formatAnnotatedMessage } from "../../shared/conversation-annotations.js";
import { markdownToPlainText } from "../../shared/markdown-plain-text.js";
import type { ChatMessage } from "../types.js";
import { htmlFragmentToRichText } from "./html-to-markdown.js";
import { rangeTouchesNonPortableLink, toPortableHtml } from "./portable-links.js";
import { selectedTableRows, tableToTsv } from "./table-copy.js";

export { markdownToPlainText };

/**
 * Extract the raw markdown text from an assistant message.
 * Joins all text content blocks, falling back to message.content.
 */
export function getMessageMarkdown(message: ChatMessage): string {
  const blocks = message.contentBlocks;
  if (blocks && blocks.length > 0) {
    const textParts = blocks.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text);
    if (textParts.length > 0) return textParts.join("\n\n");
  }
  return message.role === "user"
    ? formatAnnotatedMessage(message.content, message.metadata?.annotations)
    : message.content;
}

/**
 * Strip markdown syntax to produce plain text.
 */
export function getMessagePlainText(message: ChatMessage): string {
  const md = getMessageMarkdown(message);
  return markdownToPlainText(md);
}

/**
 * Write text to clipboard with fallback for non-secure contexts (HTTP).
 * navigator.clipboard is undefined on iOS Safari over HTTP — falls back
 * to a temporary textarea + execCommand("copy").
 */
export function writeClipboardText(text: string): Promise<void> {
  const clipboard = typeof window !== "undefined" ? window.navigator.clipboard : globalThis.navigator?.clipboard;
  if (clipboard?.writeText) {
    return clipboard.writeText(text);
  }
  // Legacy fallback: create a temporary textarea, select, and copy
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "-9999px";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
  return Promise.resolve();
}

/** Whether this browser can put image data on the clipboard (it needs a secure context and ClipboardItem). */
export function canWriteClipboardImage(): boolean {
  return typeof ClipboardItem !== "undefined" && typeof navigator !== "undefined" && !!navigator.clipboard?.write;
}

/**
 * Put the image at `src` on the clipboard as PNG data, so it pastes into other apps (Slack, Mail, Docs) as
 * an image rather than a link. PNG is the one image type every browser's clipboard accepts, so other types
 * are redrawn as PNG. The clipboard write starts synchronously and receives the image as a promise:
 * Safari only allows a clipboard write that starts inside the tap, however long the image takes to prepare.
 */
export function writeClipboardImage(src: string): Promise<void> {
  return navigator.clipboard.write([new ClipboardItem({ "image/png": imageAsPng(src) })]);
}

async function imageAsPng(src: string): Promise<Blob> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  // An <img> decodes every type the viewer shows, SVG included (createImageBitmap rejects SVG in Chrome),
  // and loading it from the fetched bytes keeps the canvas readable.
  const objectUrl = URL.createObjectURL(blob);
  const canvas = document.createElement("canvas");
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas context");
    context.drawImage(image, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("PNG encoding failed"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(objectUrl);
    // Phones cap total canvas memory, so give a large image's canvas back at once.
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * Copy rich text (HTML) to clipboard using the Clipboard API.
 * Falls back to plain text if the ClipboardItem API is unavailable.
 */
export async function copyRichText(html: string, plainText: string): Promise<void> {
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    const item = new ClipboardItem({
      "text/html": new Blob([toPortableHtml(html)], { type: "text/html" }),
      "text/plain": new Blob([plainText], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  } else {
    await writeClipboardText(plainText);
  }
}

/**
 * Keep the browser's own copy (Cmd+C, the phone's Copy) from carrying Takode-internal links, such as a
 * `#123` session reference, into other apps as links back to this server, and give a selection within one
 * table tab-separated plain text. Only those selections are rewritten; every other selection copies as usual.
 */
export function installPortableSelectionCopy(): () => void {
  const onCopy = (event: ClipboardEvent) => {
    const selection = document.getSelection();
    if (event.defaultPrevented || !event.clipboardData || !selection || selection.isCollapsed) return;
    if (event.target instanceof Element && event.target.closest(EDITABLE_SELECTOR)) return;
    const ranges = Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index));
    const tableRows = ranges.length === 1 ? selectedTableRows(ranges[0]!) : null;
    if (tableRows) {
      // Cells as tab-separated text, the way desktop browsers copy them: Slack pastes that as its own
      // table and spreadsheets as cells. A phone's copy otherwise loses the columns.
      event.clipboardData.setData("text/html", toPortableHtml(htmlFragmentToRichText(ranges[0]!).html));
      event.clipboardData.setData("text/plain", tableToTsv(tableRows));
      event.preventDefault();
      return;
    }
    if (!ranges.some(rangeTouchesNonPortableLink)) return;
    const copies = ranges.map(htmlFragmentToRichText);
    event.clipboardData.setData("text/html", toPortableHtml(copies.map((copy) => copy.html).join("")));
    event.clipboardData.setData("text/plain", copies.map((copy) => copy.plainText).join("\n"));
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  return () => document.removeEventListener("copy", onCopy);
}

const EDITABLE_SELECTOR = 'input, textarea, [contenteditable]:not([contenteditable="false"])';
