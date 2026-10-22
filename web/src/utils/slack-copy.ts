import { htmlFragmentToPlainText, htmlFragmentToRichText } from "./html-to-markdown.js";
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

/** A rendered message, as Slack keeps its formatting on paste. Only the rendered Markdown is copied. */
export function messageCopyForSlack(content: HTMLElement): ClipboardPayload {
  const bodies = Array.from(content.querySelectorAll<HTMLElement>(MARKDOWN_BODY_SELECTOR));
  const source = content.ownerDocument.createElement("div");
  for (const body of bodies.length > 0 ? bodies : [content]) source.appendChild(body.cloneNode(true));
  return slackCopyOf(source);
}

/** The selected part of a message, as Slack keeps its formatting on paste. */
export function selectionCopyForSlack(range: Range): ClipboardPayload {
  // The rich-text copy re-wraps selected list items and table cells in their list or table, and turns
  // rendered math back into its source.
  const source = range.startContainer.ownerDocument!.createElement("div");
  source.innerHTML = htmlFragmentToRichText(range).html;
  return slackCopyOf(source);
}

/**
 * Rewrite rendered HTML into the small set of formats Slack keeps on paste: bold, italic, strikethrough,
 * inline code, links, bulleted and numbered lists (nested), quotes and code blocks. Slack has no headings,
 * so a heading becomes a bold line; it flattens HTML tables into running text but keeps a `<pre>` as one
 * code block, so a table becomes a code block with its columns lined up. Classes, styles, controls and the
 * whitespace between tags are dropped, so nothing of Takode's layout reaches Slack.
 */
function slackCopyOf(source: HTMLElement): ClipboardPayload {
  // A source line break is a <br> plus the newline after it; the newline is not a space.
  const html = blockChildren(source).replace(/\s*<br>\s*/g, "<br>");
  const container = source.ownerDocument.createElement("div");
  container.innerHTML = html;
  const range = source.ownerDocument.createRange();
  range.selectNodeContents(container);
  const codeBlocks = Array.from(container.querySelectorAll("pre"), (pre) => pre.textContent ?? "");
  const plain = fenceCodeBlocks(htmlFragmentToPlainText(range), codeBlocks).replace(/\n{3,}/g, "\n\n");
  return payload(plain, html);
}

const INLINE_TAGS: Record<string, string> = {
  STRONG: "b",
  B: "b",
  EM: "i",
  I: "i",
  DEL: "s",
  S: "s",
  STRIKE: "s",
};

const BLOCK_TAGS = new Set([
  "P",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "HR",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "DIV",
]);

/**
 * Children of a block container. Whitespace between blocks is layout, not content, and no empty paragraph
 * goes between blocks: Slack sets pasted paragraphs on consecutive lines, as Jiayi writes her messages, and
 * gives code blocks, lists and quotes their own spacing.
 */
function blockChildren(parent: Node): string {
  let html = "";
  let inline = "";
  const flush = () => {
    // Loose text and inline elements between blocks become their own paragraph.
    if (inline.trim()) html += `<p>${inline.trim()}</p>`;
    inline = "";
  };
  for (const child of Array.from(parent.childNodes)) {
    if (child instanceof Element && isBlock(child)) {
      flush();
      // A frame (the table or code block wrapper, a nested div) adds its blocks at this level.
      html += isFrame(child) ? blockChildren(child) : convertBlock(child);
    } else {
      inline += convertInline(child);
    }
  }
  flush();
  return html;
}

function isFrame(element: Element): boolean {
  return element.tagName === "DIV" && !element.matches(COPY_EXCLUDE_SELECTOR);
}

function convertBlock(element: Element): string {
  if (element.matches(COPY_EXCLUDE_SELECTOR)) return "";
  switch (element.tagName) {
    case "P":
      return paragraph(inlineChildren(element));
    case "H1":
    case "H2":
    case "H3":
    case "H4":
    case "H5":
    case "H6":
      return paragraph(`<b>${inlineChildren(element)}</b>`);
    case "UL":
    case "OL": {
      const tag = element.tagName.toLowerCase();
      const items = Array.from(element.children)
        .filter((child) => child.tagName === "LI")
        .map(listItem)
        .join("");
      return items ? `<${tag}>${items}</${tag}>` : "";
    }
    case "LI":
      return `<ul>${listItem(element)}</ul>`;
    case "BLOCKQUOTE": {
      const inner = blockChildren(element);
      return inner ? `<blockquote>${inner}</blockquote>` : "";
    }
    case "PRE":
      return codeBlock(element.textContent ?? "");
    case "TABLE":
      return codeBlock(tableToAlignedText(readTableRows(element as HTMLTableElement)));
    case "HR":
      return DIVIDER_HTML;
    default:
      return blockChildren(element);
  }
}

/** Slack has no divider; a line of box-drawing characters reads as one. */
const DIVIDER_HTML = "<p>──────────</p>";

function listItem(item: Element): string {
  // A list item holds its own text plus any nested lists, which Slack keeps as deeper levels.
  let text = "";
  let nested = "";
  for (const child of Array.from(item.childNodes)) {
    if (child instanceof Element && (child.tagName === "UL" || child.tagName === "OL")) nested += convertBlock(child);
    else if (child instanceof Element && child.tagName === "P") text += (text ? "<br>" : "") + inlineChildren(child);
    else if (child instanceof Element && isBlock(child)) nested += convertBlock(child);
    else text += convertInline(child);
  }
  return `<li>${text.trim()}${nested}</li>`;
}

function inlineChildren(parent: Node): string {
  return Array.from(parent.childNodes).map(convertInline).join("").trim();
}

function convertInline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml((node.textContent ?? "").replace(/\s+/g, " "));
  if (!(node instanceof Element)) return "";
  if (node.matches(COPY_EXCLUDE_SELECTOR) || node.tagName === "SVG" || node.tagName === "svg") return "";
  if (isBlock(node)) return convertBlock(node);
  const inner = inlineChildren(node);
  if (node.tagName === "BR") return "<br>";
  if (node.tagName === "CODE") return `<code>${escapeHtml(node.textContent ?? "")}</code>`;
  if (node.tagName === "A") {
    const href = node.getAttribute("href");
    return href && /^(https?:|mailto:)/i.test(href) ? `<a href="${escapeAttribute(href)}">${inner}</a>` : inner;
  }
  if (node.tagName === "IMG") return "";
  const tag = INLINE_TAGS[node.tagName];
  if (!inner) return "";
  // Unformatted wrappers (spans, chips, link buttons) keep only their text. Spaces at a formatted
  // word's edges move outside its tags, so "**bold **word" still reads "bold word".
  return spaced(node, tag ? `<${tag}>${inner}</${tag}>` : inner);
}

function spaced(node: Element, inner: string): string {
  const text = node.textContent ?? "";
  return `${/^\s/.test(text) ? " " : ""}${inner}${/\s$/.test(text) ? " " : ""}`;
}

function paragraph(inner: string): string {
  return inner ? `<p>${inner}</p>` : "";
}

function codeBlock(text: string): string {
  const trimmed = text.replace(/^\n+|\n+$/g, "");
  return trimmed ? `<pre>${escapeHtml(trimmed)}</pre>` : "";
}

function isBlock(element: Element): boolean {
  if (BLOCK_TAGS.has(element.tagName)) return true;
  // Rendered wrappers such as the table and code block frames are divs or carry block display.
  return element.hasAttribute("data-markdown-table") || element.getAttribute("data-testid") === "code-block";
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** In the plain-text copy, put each code block (tables included) inside a Markdown code fence. */
function fenceCodeBlocks(plain: string, blocks: string[]): string {
  let result = plain;
  let from = 0;
  for (const block of blocks) {
    if (!block) continue;
    const at = result.indexOf(block, from);
    if (at < 0) continue;
    const fenced = "```\n" + block + "\n```";
    result = result.slice(0, at) + fenced + result.slice(at + block.length);
    from = at + fenced.length;
  }
  return result;
}

function payload(plain: string, html?: string): ClipboardPayload {
  return {
    plain,
    ...(html !== undefined ? { html } : {}),
    write: () => copyRichText(html ?? escapeHtml(plain), plain),
  };
}
