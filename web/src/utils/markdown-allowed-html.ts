import { scanFences } from "../../shared/draft-posts.js";

interface HtmlAstNode {
  type: string;
  value?: string;
  children?: HtmlAstNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/**
 * The raw HTML Takode renders in Markdown, written as on GitHub so the same text renders there too:
 * - `<u>text</u>` underlines, within one paragraph or span. Drafts use it for Slack's bold-underlined
 *   titles (`**<u>TL;DR</u>**`).
 * - `<details>`, then `<summary>Title</summary>`, then Markdown, then `</details>`, each tag on its own
 *   line, is a section folded under its title (`<details open>` starts unfolded). The title is plain text.
 * Every other tag, and a tag with no partner in the same paragraph or list, shows as typed. Run
 * {@link separateDetailsTags} on the source first.
 */
export function remarkAllowedHtml() {
  return (tree: HtmlAstNode) => {
    allowedHtmlIn(tree);
  };
}

const DETAILS_OPEN = /^<details(\s+open)?\s*>\s*(?:<summary>([\s\S]*?)<\/summary>)?$/i;
const SUMMARY = /^<summary>([\s\S]*?)<\/summary>$/i;
const DETAILS_CLOSE = /^<\/details\s*>$/i;
const UNDERLINE_OPEN = /^<u\s*>$/i;
const UNDERLINE_CLOSE = /^<\/u\s*>$/i;
const DETAILS_TAG_LINE =
  /^\s*(?:<details(?:\s+open)?\s*>\s*(?:<summary>.*<\/summary>)?|<summary>.*<\/summary>|<\/details\s*>)\s*$/i;

/**
 * Markdown source with a blank line after each line of a `<details>` toggle's tags, outside code fences.
 * Markdown reads a line opening with such a tag, and the lines up to the next blank line, as raw HTML, so
 * a section written without blank lines would show its Markdown as typed instead of rendering it.
 */
export function separateDetailsTags(markdown: string): string {
  if (!/<\/?details/i.test(markdown)) return markdown;
  const fences = scanFences(markdown).fences;
  const lines = markdown.split("\n");
  let offset = 0;
  return lines
    .map((line, index) => {
      const start = offset;
      offset += line.length + 1;
      const inFence = fences.some((fence) => start >= fence.start && start <= fence.end);
      const next = lines[index + 1];
      return !inFence && next?.trim() && DETAILS_TAG_LINE.test(line) ? `${line}\n` : line;
    })
    .join("\n");
}

function allowedHtmlIn(node: HtmlAstNode): void {
  const children = node.children;
  if (!children) return;
  for (const child of children) allowedHtmlIn(child);
  wrapPairs(children, UNDERLINE_OPEN, UNDERLINE_CLOSE, (_open, inner) => ({
    type: "underline",
    children: inner,
    data: { hName: "u" },
  }));
  wrapPairs(children, DETAILS_OPEN, DETAILS_CLOSE, (open, inner) => {
    const [, unfolded, inlineSummary] = DETAILS_OPEN.exec(open)!;
    const separateSummary = inlineSummary === undefined ? SUMMARY.exec(htmlValue(inner[0]) ?? "") : null;
    const body = separateSummary ? inner.slice(1) : inner;
    const title: HtmlAstNode = {
      type: "detailsSummary",
      children: [{ type: "text", value: plainText(inlineSummary ?? separateSummary?.[1] ?? "") || "Details" }],
      data: { hName: "summary" },
    };
    return {
      type: "details",
      children: [title, ...body],
      data: { hName: "details", hProperties: { open: !!unfolded } },
    };
  });
}

/** Replaces each opening raw-HTML node, its partner and the siblings between them with one node. */
function wrapPairs(
  children: HtmlAstNode[],
  open: RegExp,
  close: RegExp,
  wrap: (openValue: string, inner: HtmlAstNode[]) => HtmlAstNode,
): void {
  const opens: number[] = [];
  for (let index = 0; index < children.length; index++) {
    const value = htmlValue(children[index]);
    if (value === undefined) continue;
    if (open.test(value)) opens.push(index);
    if (!close.test(value) || opens.length === 0) continue;
    const start = opens.pop()!;
    children.splice(start, index - start + 1, wrap(htmlValue(children[start])!, children.slice(start + 1, index)));
    index = start;
  }
}

function htmlValue(node: HtmlAstNode | undefined): string | undefined {
  return node?.type === "html" ? node.value?.trim() : undefined;
}

/** A summary's text without its tags, with entities such as `&amp;` read. */
function plainText(html: string): string {
  return (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").trim();
}
