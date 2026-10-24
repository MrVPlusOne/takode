import type { BrowserIncomingMessage } from "./session-types.js";
import { leaderMessageThreadKey } from "../shared/leader-thread-response-routing.js";
import { parseDraftHeader } from "../shared/artifact-library.js";

/**
 * Finds the artifacts in one conversation message: draft blocks (posts), titled or untitled visual
 * blocks, images shown in an answer (figures), tables in an answer's prose, and published reports
 * and guided reviews. Pure and
 * deterministic, so the same message always yields the same captures in the same order: the
 * library records which capture of a message became which artifact version by its `label`, and
 * the browser projection finds them again by label to collapse superseded ones.
 */

/** A span of a text block in an assistant message: `[start, end)` character offsets. */
export interface TextSpan {
  block: number;
  start: number;
  end: number;
}

export type MessageCapture =
  | {
      kind: "post";
      label: string;
      /** From a `title:` line; absent means the title is derived from the text. */
      title?: string;
      autoTitle: string;
      parts: string[];
      spans: TextSpan[];
      /** Labels of the figure captures shown in the same answer. */
      figureLabels: string[];
    }
  | {
      kind: "visual";
      label: string;
      title?: string;
      source: string;
      spans: TextSpan[];
    }
  | {
      kind: "figure";
      label: string;
      path: string;
      alt: string;
      spans: TextSpan[];
    }
  | {
      kind: "table";
      label: string;
      title: string;
      markdown: string;
      spans: TextSpan[];
    }
  | {
      kind: "report" | "review";
      label: string;
      title: string;
      markdown: string;
      sourcePath: string;
      reviewId?: string;
    };

export interface ExtractedMessage {
  messageId: string;
  threadKey: string;
  at: number;
  captures: MessageCapture[];
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|svg)$/i;

/** The captures of a root conversation message, or null when it holds none. */
export function extractMessageArtifacts(message: BrowserIncomingMessage): ExtractedMessage | null {
  if (message.type === "markdown_report") return extractReport(message);
  if (message.type !== "assistant" || message.parent_tool_use_id || message.codexSubagent != null) return null;
  const messageId = assistantMessageId(message);
  if (!messageId) return null;
  const content = message.message?.content;
  if (!Array.isArray(content)) return null;
  const captures = extractFromTextBlocks(
    content.map((block) => (block && block.type === "text" && typeof block.text === "string" ? block.text : null)),
  );
  if (captures.length === 0) return null;
  return {
    messageId,
    threadKey: leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]),
    at: typeof message.timestamp === "number" ? message.timestamp : 0,
    captures,
  };
}

export function assistantMessageId(message: BrowserIncomingMessage): string | undefined {
  if (message.type !== "assistant") return undefined;
  const id = message.message?.id;
  if (typeof id === "string" && id) return id;
  return typeof message.uuid === "string" && message.uuid ? message.uuid : undefined;
}

function extractReport(message: Extract<BrowserIncomingMessage, { type: "markdown_report" }>): ExtractedMessage {
  const review = message.guidedReview;
  return {
    messageId: message.id,
    threadKey: message.threadKey || "main",
    at: message.timestamp,
    captures: [
      {
        kind: review ? "review" : "report",
        label: "report",
        title: review ? review.map.title : reportTitle(message.content, message.source.sourcePath),
        markdown: message.content,
        sourcePath: message.source.sourcePath,
        ...(review ? { reviewId: review.sharedFrom?.reviewId ?? review.reviewId } : {}),
      },
    ],
  };
}

/** A report's title: its top-level heading, else its file name in words. */
export function reportTitle(markdown: string, sourcePath: string): string {
  const heading = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  if (heading) return clipTitle(stripInlineMarkdown(heading[1]));
  const name = (sourcePath.split("/").pop() || sourcePath)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  return clipTitle(name ? name[0].toUpperCase() + name.slice(1) : sourcePath);
}

interface Fence {
  block: number;
  start: number;
  end: number;
  language: string;
  body: string;
}

interface TableRef {
  block: number;
  start: number;
  end: number;
  markdown: string;
  title: string;
}

interface ImageRef {
  block: number;
  start: number;
  end: number;
  path: string;
  alt: string;
}

/** Text blocks (null for non-text blocks) to captures, in order of appearance. */
export function extractFromTextBlocks(blocks: Array<string | null>): MessageCapture[] {
  const fences: Fence[] = [];
  const images: ImageRef[] = [];
  const tables: TableRef[] = [];
  blocks.forEach((text, block) => {
    if (text) scanText(text, block, fences, images, tables);
  });

  const captures: MessageCapture[] = [];
  const figureLabels: string[] = [];
  const seenPaths = new Set<string>();
  for (const image of images) {
    if (seenPaths.has(image.path)) continue;
    seenPaths.add(image.path);
    const label = `figure:${image.path}`;
    figureLabels.push(label);
    captures.push({
      kind: "figure",
      label,
      path: image.path,
      alt: image.alt,
      spans: [spanOf(image)],
    });
  }
  // A path shown twice in one answer is one figure; both spans collapse together.
  for (const image of images) {
    const figure = captures.find((capture) => capture.kind === "figure" && capture.path === image.path);
    if (figure && figure.kind === "figure" && !figure.spans.some((span) => sameSpan(span, image))) {
      figure.spans.push(spanOf(image));
    }
  }

  let post: Extract<MessageCapture, { kind: "post" }> | null = null;
  let postCount = 0;
  let visualCount = 0;
  for (const fence of fences) {
    if (fence.language === "visual") {
      const title = /^title:[ \t]*(.+?)[ \t]*$/im.exec(fence.body.split(/\n---[ \t]*\n/)[0] ?? "")?.[1];
      captures.push({
        kind: "visual",
        label: `visual#${visualCount++}`,
        ...(title ? { title } : {}),
        source: fence.body,
        spans: [spanOf(fence)],
      });
      continue;
    }
    const { title, body } = parseDraftHeader(fence.body);
    if (!post || (title && title !== post.title)) {
      post = {
        kind: "post",
        label: `post#${postCount++}`,
        ...(title ? { title } : {}),
        autoTitle: autoTitle(body),
        parts: [],
        spans: [],
        // Figures shown in an answer go with its first post.
        figureLabels: postCount === 1 ? figureLabels : [],
      };
      captures.push(post);
    }
    post.parts.push(body);
    post.spans.push(spanOf(fence));
  }
  tables.forEach((table, index) => {
    captures.push({
      kind: "table",
      label: `table#${index}`,
      title: table.title,
      markdown: table.markdown,
      spans: [spanOf(table)],
    });
  });
  return captures;
}

function spanOf(item: { block: number; start: number; end: number }): TextSpan {
  return { block: item.block, start: item.start, end: item.end };
}

function sameSpan(span: TextSpan, item: { block: number; start: number }): boolean {
  return span.block === item.block && span.start === item.start;
}

const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)[^\n]*$/;

/** Collects draft and visual fences, and images and tables outside any code fence, from one text block. */
function scanText(text: string, block: number, fences: Fence[], images: ImageRef[], tables: TableRef[]): void {
  const scanProse = (prose: string, base: number) => {
    scanImages(prose, base, block, images);
    scanTables(prose, base, block, tables);
  };
  let offset = 0;
  let open: {
    marker: string;
    language: string;
    start: number;
    bodyStart: number;
  } | null = null;
  let proseStart = 0;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    const lineEnd = offset + line.length;
    offset = lineEnd + 1;
    if (open) {
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
      if (close && close[1][0] === open.marker[0] && close[1].length >= open.marker.length) {
        if (open.language === "draft" || open.language === "visual") {
          fences.push({
            block,
            start: open.start,
            end: lineEnd,
            language: open.language,
            body: text.slice(open.bodyStart, Math.max(open.bodyStart, lineStart - 1)),
          });
        }
        open = null;
        proseStart = offset;
      }
      continue;
    }
    const opening = FENCE_OPEN.exec(line);
    if (opening && !(opening[2][0] === "`" && opening[3].includes("`"))) {
      scanProse(text.slice(proseStart, lineStart), proseStart);
      open = {
        marker: opening[2],
        language: opening[3].toLowerCase(),
        start: lineStart,
        bodyStart: offset,
      };
    }
  }
  if (!open) scanProse(text.slice(proseStart), proseStart);
}

/** Tables smaller than this many data rows are part of the answer's wording, not something to find later. */
export const MIN_TABLE_ROWS = 3;
const TABLE_DELIMITER = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;

/** Markdown tables in prose with at least `MIN_TABLE_ROWS` data rows, titled by the line before them. */
function scanTables(prose: string, base: number, block: number, tables: TableRef[]): void {
  const lines = prose.split("\n");
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  for (let index = 0; index + 1 < lines.length; index += 1) {
    if (!lines[index].includes("|") || !TABLE_DELIMITER.test(lines[index + 1])) continue;
    let end = index + 2;
    while (end < lines.length && lines[end].includes("|") && lines[end].trim()) end += 1;
    const rows = end - index - 2;
    const columns = tableCells(lines[index]).length;
    if (rows >= MIN_TABLE_ROWS && columns >= 2) {
      const markdown = lines.slice(index, end).join("\n");
      tables.push({
        block,
        start: base + starts[index],
        end: base + starts[index] + markdown.length,
        markdown,
        title: tableTitle(lines.slice(0, index), tableCells(lines[index])),
      });
    }
    index = end - 1;
  }
}

function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => stripInlineMarkdown(cell))
    .filter(Boolean);
}

/**
 * A table's title: the heading or bold lead line right above it, or that line's text when it
 * introduces the table ("Per training domain, pass@1:"); otherwise its column names.
 */
function tableTitle(before: string[], header: string[]): string {
  const previous = [...before.slice(-3)].reverse().find((line) => line.trim());
  const line = previous?.trim() ?? "";
  const heading = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(line);
  if (heading) return clipTitle(stripInlineMarkdown(heading[1]));
  const bold = /^\*\*(.+?)\*\*/.exec(line);
  if (bold) return clipTitle(stripInlineMarkdown(bold[1]).replace(/[\s:.]+$/, ""));
  if (line.endsWith(":")) return clipTitle(stripInlineMarkdown(line).replace(/[\s:]+$/, ""));
  return clipTitle(header.join(" · ") || "Table");
}

const IMAGE_PATTERN = /!\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;

function scanImages(prose: string, base: number, block: number, images: ImageRef[]): void {
  for (const match of prose.matchAll(IMAGE_PATTERN)) {
    const path = match[2].replace(/^file:/, "");
    if (!path.startsWith("/") || !IMAGE_EXTENSION.test(path)) continue;
    const start = base + (match.index ?? 0);
    images.push({
      block,
      start,
      end: start + match[0].length,
      path,
      alt: match[1],
    });
  }
}

/** A post's title when it has no `title:` line: its first line of text, shortened. */
function autoTitle(body: string): string {
  const line = body
    .split("\n")
    .map((candidate) => stripInlineMarkdown(candidate).trim())
    .find((candidate) => candidate.length > 0);
  return clipTitle((line || "Draft").replace(/[\s:]+$/, ""));
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/^[#>\-*+\s]+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]|~~/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clipTitle(text: string): string {
  return text.length > 80 ? `${text.slice(0, 79).trimEnd()}…` : text;
}

/**
 * Grouping key of an untitled post: its first line with numbers and spacing removed, so redrafts
 * of "Quick T7 update (T7 at step ~163…)" and "(…~165…)" read as the same post.
 */
export function untitledPostKey(autoTitleText: string): string {
  return autoTitleText
    .toLowerCase()
    .replace(/[0-9.,~%+\-]+/g, "#")
    .replace(/[^a-z#]+/g, " ")
    .trim()
    .slice(0, 60);
}
