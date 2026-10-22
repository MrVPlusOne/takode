import { htmlFragmentToPlainText } from "./html-to-markdown.js";
import { copyRichText } from "./copy-utils.js";
import { escapeHtml, readTableRows, tableToAlignedText } from "./table-copy.js";

/** Rendered parts that are controls, not content: they never belong in a copy. */
export const COPY_EXCLUDE_SELECTOR = "[data-read-aloud-player], [data-copy-exclude]";

const MARKDOWN_BODY_SELECTOR = ".markdown-body";

/** One clipboard payload: plain text, plus HTML for apps that take rich text. */
export interface ClipboardPayload {
  plain: string;
  html?: string;
  write: () => Promise<void>;
}

/**
 * Monospace text as one Slack code block. Slack turns pasted HTML `<pre>` into a code block; apps that only
 * take plain text get the text inside a Markdown code fence.
 */
export function slackCodeBlock(text: string): ClipboardPayload {
  return payload("```\n" + text + "\n```", `<pre>${escapeHtml(text)}</pre>`);
}

/**
 * A rendered message as Slack takes it: prose stays rich text and each table becomes one code block with its
 * columns lined up. Slack flattens an HTML table into running text, and a native Slack table only comes from
 * a paste that is nothing but tab-separated cells, so a message with prose around its tables can't paste them
 * as native tables.
 */
export function messageCopyForSlack(content: HTMLElement): ClipboardPayload {
  // Only the rendered Markdown: the message box also holds its menu button and corner time.
  const bodies = Array.from(content.querySelectorAll<HTMLElement>(MARKDOWN_BODY_SELECTOR));
  const copy = content.ownerDocument.createElement("div");
  for (const body of bodies.length > 0 ? bodies : [content]) copy.appendChild(body.cloneNode(true));
  for (const control of copy.querySelectorAll(COPY_EXCLUDE_SELECTOR)) control.remove();
  for (const table of copy.querySelectorAll("table")) {
    const pre = copy.ownerDocument.createElement("pre");
    pre.textContent = tableToAlignedText(readTableRows(table));
    // The table's scroll and layout wrappers hold nothing else once the controls are gone.
    tableBlock(table).replaceWith(pre);
  }
  const plainParts: string[] = [];
  const range = copy.ownerDocument.createRange();
  range.selectNodeContents(copy);
  const plain = htmlFragmentToPlainText(range);
  for (const pre of copy.querySelectorAll("pre")) plainParts.push(pre.textContent ?? "");
  return payload(fenceCodeBlocks(plain, plainParts).replace(/\n{3,}/g, "\n\n"), copy.innerHTML);
}

/** In the plain-text copy, put each code block (tables included) inside a Markdown code fence. */
function fenceCodeBlocks(plain: string, blocks: string[]): string {
  let result = plain;
  for (const block of blocks) {
    if (!block) continue;
    result = result.replace(block, "```\n" + block + "\n```");
  }
  return result;
}

function tableBlock(table: HTMLTableElement): Element {
  const block = table.closest("[data-markdown-table]");
  return block ?? table;
}

function payload(plain: string, html?: string): ClipboardPayload {
  return {
    plain,
    ...(html !== undefined ? { html } : {}),
    write: () => copyRichText(html ?? escapeHtml(plain), plain),
  };
}
