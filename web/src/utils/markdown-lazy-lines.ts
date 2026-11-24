import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { prepareMarkdownMathSource } from "./markdown-math.js";
import { REMARK_GFM_OPTIONS } from "./markdown-syntax.js";

interface SourceNode {
  type: string;
  children?: SourceNode[];
  position?: { start: { line: number; column: number }; end: { line: number } };
}

type Container = SourceNode & { type: "blockquote" | "listItem" };

/** The renderer's block syntax, math included, so `$$` blocks stay math here as they do when rendered. */
const messageSourceParser =
  typeof remarkGfm === "function"
    ? unified().use(remarkParse).use(remarkGfm, REMARK_GFM_OPTIONS).use(remarkMath).freeze()
    : unified().use(remarkParse).use(remarkMath).freeze();

/**
 * Message source in which a line belongs only to the quotes and list items it is typed in.
 *
 * Markdown lets a line typed without its quote's `>` (or its list item's indentation) continue the
 * paragraph above it ("lazy continuation"), so `> abc` then `abc` renders both lines in the quote.
 * The message box draws each line with its own marks, showing the second line outside the quote, and
 * Slack sends it that way too. So for messages, where each newline is already a line break, a blank
 * separator line goes before each such line, keeping the marks the line does carry (`>` for a quote
 * it is still in), and the line starts after the quote or item it was typed outside of.
 */
export function separateLazyLines(source: string): string {
  if (!mayHaveLazyLine(source)) return source;
  const lines = source.split("\n");
  const separators = new Map<number, string>();
  // Parse what the renderer parses: `\[ ... \]` becomes `$$ ... $$` there, in place, so a formula's
  // lines (`+ x`, `- y`) are never read as list items.
  const renderText = prepareMarkdownMathSource(source).renderText;
  collectSeparators(messageSourceParser.parse(renderText) as SourceNode, [], lines, separators);
  if (separators.size === 0) return source;
  return lines.flatMap((line, index) => (separators.has(index) ? [separators.get(index)!, line] : [line])).join("\n");
}

/**
 * Cheap check before parsing: some line has fewer `>` than the line above it, or less indentation than
 * the content of the list item (or indented line) above it, without starting a quote or item itself.
 */
function mayHaveLazyLine(source: string): boolean {
  let previous: { quotes: number; contentIndent: number } | null = null;
  for (const line of source.split("\n")) {
    if (!line.trim()) {
      previous = null;
      continue;
    }
    const quotePrefix = /^(?:[ \t]*>)*/.exec(line)![0];
    const quotes = quotePrefix.split(">").length - 1;
    const rest = line.slice(quotePrefix.length).replace(/^ /, "");
    const indent = /^ */.exec(rest)![0].length;
    const item = /^ *(?:[-*+]|\d{1,9}[.)])(?: +|$)/.exec(rest);
    if (
      previous &&
      (quotes < previous.quotes || (quotes === previous.quotes && !item && indent < previous.contentIndent))
    ) {
      return true;
    }
    previous = { quotes, contentIndent: item ? item[0].length : indent };
  }
  return false;
}

function collectSeparators(
  node: SourceNode,
  containers: Container[],
  lines: string[],
  separators: Map<number, string>,
) {
  if (node.type === "paragraph") {
    if (containers.length > 0) collectParagraphSeparators(node, containers, lines, separators);
    return;
  }
  const inner =
    node.type === "blockquote" || node.type === "listItem" ? [...containers, node as Container] : containers;
  for (const child of node.children ?? []) collectSeparators(child, inner, lines, separators);
}

/** A paragraph's later line that drops out of some of its containers gets a separator before it. */
function collectParagraphSeparators(
  paragraph: SourceNode,
  containers: Container[],
  lines: string[],
  separators: Map<number, string>,
) {
  const start = paragraph.position?.start.line;
  const end = paragraph.position?.end.line;
  if (start == null || end == null) return;
  let previousDepth = containers.length;
  for (let lineNumber = start + 1; lineNumber <= end; lineNumber += 1) {
    const { depth, prefix } = matchContainers(lines[lineNumber - 1] ?? "", containers, lines);
    // Following lazy lines at the same depth continue the line that now starts the new block.
    if (depth < previousDepth) separators.set(lineNumber - 1, prefix.trimEnd());
    previousDepth = depth;
  }
}

/** How many of the containers, outermost first, the line is typed in, and the marks it carries for them. */
function matchContainers(line: string, containers: Container[], lines: string[]): { depth: number; prefix: string } {
  let index = 0;
  for (let depth = 0; depth < containers.length; depth += 1) {
    const container = containers[depth]!;
    if (container.type === "blockquote") {
      const marker = /^ {0,3}> ?/.exec(line.slice(index));
      if (!marker) return { depth, prefix: line.slice(0, index) };
      index += marker[0].length;
      continue;
    }
    const contentIndex = listItemContentIndex(container, lines);
    const spaces = /^ */.exec(line.slice(index))![0].length;
    if (index + spaces < contentIndex) return { depth, prefix: line.slice(0, index) };
    index = contentIndex;
  }
  return { depth: containers.length, prefix: line.slice(0, index) };
}

/** Where a list item's text starts in its line, which its later lines must be indented to to stay in it. */
function listItemContentIndex(item: Container, lines: string[]): number {
  const start = item.position!.start;
  const first = item.children?.[0]?.position?.start;
  if (first && first.line === start.line) return first.column - 1;
  // An item whose text starts on a later line continues past its marker and one space.
  const marker = /^(?:[-*+]|\d{1,9}[.)])/.exec(lines[start.line - 1]?.slice(start.column - 1) ?? "")?.[0] ?? "-";
  return start.column - 1 + marker.length + 1;
}
