import { markdownWithVisualFallbacks } from "./visual-block.js";

/**
 * Strip Markdown syntax to readable plain text, keeping math source such as
 * `$x_1$` and code (fenced blocks and inline spans) intact. Shared by browser
 * copy actions and server-written previews.
 */
export function markdownToPlainText(markdown: string): string {
  // A visual block reads as its plain-text version, never as its HTML.
  // Math is replaced by `\0M<n>;` tokens and every literal NUL doubled; code uses the same scheme.
  const protectedMath = protectMathSource(markdownWithVisualFallbacks(markdown));
  // A fenced block keeps its content verbatim, without its fences.
  const blocks: string[] = [];
  let text = protectedMath.text.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return `\0B${blocks.push(inner) - 1};`;
  });
  text = stripEscapedInlineMarkdown(text);
  // Remove heading markers
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Remove blockquote markers
  text = text.replace(/^>\s?/gm, "");
  // Remove horizontal rules
  text = text.replace(/^[-*_]{3,}\s*$/gm, "");
  // Remove list markers (unordered)
  text = text.replace(/^[\t ]*[-*+]\s+/gm, "");
  // Remove list markers (ordered)
  text = text.replace(/^[\t ]*\d+\.\s+/gm, "");
  return protectedMath.restore(restoreTokens(text, "B", blocks).trim());
}

/**
 * Inline Markdown as plain text: link and image labels kept, code spans unwrapped with their
 * content untouched, and emphasis and strikethrough marks dropped. As in CommonMark, underscores
 * mark emphasis only at the edges of a word, so `snake_case` words and identifiers such as
 * QA_DATASETS_1031 keep theirs. For one-line titles and labels as much as for whole messages.
 */
export function stripInlineMarkdown(markdown: string): string {
  return stripEscapedInlineMarkdown(markdown.replaceAll("\0", "\0\0")).replace(/\0\0/g, "\0");
}

/**
 * `_emphasis_`, `__strong__` or `___both___` opening after a non-word character and closing
 * before one, with no space just inside the marks.
 */
const UNDERSCORE_EMPHASIS = /(^|[^\p{L}\p{N}_])(_{1,3})(?!\s)((?:(?!\2).)*?[^\s_])\2(?![\p{L}\p{N}_])/gu;

/** stripInlineMarkdown on text whose literal NULs are doubled, so `\0C<n>;` can stand in for code spans. */
function stripEscapedInlineMarkdown(text: string): string {
  const spans: string[] = [];
  const stripped = text
    .replace(/`([^`]+)`/g, (_match, inner: string) => `\0C${spans.push(inner) - 1};`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(UNDERSCORE_EMPHASIS, "$1$3")
    .replace(/~~([^~]+)~~/g, "$1");
  return restoreTokens(stripped, "C", spans);
}

/** Put back `\0<kind><n>;` tokens, leaving doubled NULs and other tokens as they are. */
function restoreTokens(text: string, kind: string, values: string[]): string {
  return text.replace(/\0(\0|([A-Z])(\d+);)/g, (match, _rest, tokenKind?: string, index?: string) =>
    tokenKind === kind && values[Number(index)] != null ? values[Number(index)]! : match,
  );
}

function protectMathSource(markdown: string): { text: string; restore: (value: string) => string } {
  const spans = findMathSourceSpans(markdown);
  const tokens: string[] = [];
  const chunks: string[] = [];
  let cursor = 0;

  for (const span of spans) {
    chunks.push(escapeMathPlaceholderNulls(markdown.slice(cursor, span.start)));
    const tokenIndex = tokens.push(markdown.slice(span.start, span.end)) - 1;
    chunks.push(`\0M${tokenIndex};`);
    cursor = span.end;
  }
  chunks.push(escapeMathPlaceholderNulls(markdown.slice(cursor)));

  return {
    text: chunks.join(""),
    restore: (value) => restoreMathPlaceholders(value, tokens),
  };
}

interface MathSourceSpan {
  start: number;
  end: number;
}

type OpenMathSource =
  | { kind: "backslash"; start: number; close: ")" | "]" }
  | { kind: "dollar"; start: number; size: number };

/** Find non-overlapping complete math tokens in one forward pass. */
function findMathSourceSpans(source: string): MathSourceSpan[] {
  const spans: MathSourceSpan[] = [];
  let open: OpenMathSource | null = null;
  let slashRun = 0;
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    const precedingSlashRun = slashRun;

    if (character === "\\") {
      const escaped = precedingSlashRun % 2 === 1;
      const next = source[index + 1];
      if (open?.kind === "backslash" && !escaped && next === open.close) {
        spans.push({ start: open.start, end: index + 2 });
        open = null;
        slashRun = 0;
        index += 2;
        continue;
      }
      if (!open && !escaped && (next === "(" || next === "[")) {
        open = { kind: "backslash", start: index, close: next === "(" ? ")" : "]" };
        slashRun = 0;
        index += 2;
        continue;
      }

      slashRun += 1;
      index += 1;
      continue;
    }

    slashRun = 0;
    if (character !== "$" || precedingSlashRun % 2 === 1 || open?.kind === "backslash") {
      index += 1;
      continue;
    }

    let runSize = 1;
    while (source[index + runSize] === "$") runSize += 1;

    if (open?.kind === "dollar") {
      if (runSize === open.size) {
        const body = source.slice(open.start + open.size, index);
        const validSingle =
          open.size !== 1 ||
          (Boolean(body) && !/^\s/.test(body) && !/\s$/.test(body) && !/\d/.test(source[index + runSize] ?? ""));
        if (validSingle) spans.push({ start: open.start, end: index + runSize });
        open = null;
      }
      index += runSize;
      continue;
    }

    const next = source[index + runSize];
    if (runSize > 1 || (next && !/\s/.test(next))) open = { kind: "dollar", start: index, size: runSize };
    index += runSize;
  }

  return spans;
}

function escapeMathPlaceholderNulls(value: string): string {
  return value.replaceAll("\0", "\0\0");
}

function restoreMathPlaceholders(value: string, tokens: string[]): string {
  let result = "";
  let index = 0;

  while (index < value.length) {
    if (value[index] !== "\0") {
      result += value[index];
      index += 1;
      continue;
    }
    if (value[index + 1] === "\0") {
      result += "\0";
      index += 2;
      continue;
    }
    if (value[index + 1] === "M") {
      let cursor = index + 2;
      while (/\d/.test(value[cursor] ?? "")) cursor += 1;
      if (cursor > index + 2 && value[cursor] === ";") {
        const token = tokens[Number(value.slice(index + 2, cursor))];
        if (token != null) {
          result += token;
          index = cursor + 1;
          continue;
        }
      }
    }

    result += "\0";
    index += 1;
  }

  return result;
}
