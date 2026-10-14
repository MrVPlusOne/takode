import { markdownSourceParser } from "./markdown-syntax.js";

interface SourceNode {
  type: string;
  children?: SourceNode[];
  position?: { start?: { offset?: number }; end?: { offset?: number } };
}

interface Destination {
  /** Offset of the destination's first character, just after `(`. */
  start: number;
  /** Offset of the `)` that closes it. */
  end: number;
}

/**
 * Wrap `file:` link destinations that contain spaces in angle brackets so they
 * render as links.
 *
 * CommonMark ends a bare link destination at the first space, so a link such as
 * `[a.md](file:/Users/me/Library/Mobile Documents/com~apple~CloudDocs/a.md)`
 * (iCloud Drive) shows as raw text. The angle-bracket form
 * `[a.md](<file:...>)` is the standard way to write it. Only links in prose
 * change: code, HTML and links that already parse stay exactly as written.
 * Renderer-only: stored message text is never rewritten.
 */
export function wrapSpacedFileLinkDestinations(text: string): string {
  const destinations = findSpacedFileLinkDestinations(text);
  if (destinations.length === 0) return text;

  const proseRanges = collectProseTextRanges(markdownSourceParser.parse(text) as SourceNode);
  const inProse = (offset: number) => proseRanges.some(([start, end]) => offset >= start && offset < end);

  let result = "";
  let cursor = 0;
  for (const { start, end } of destinations) {
    // The `](` before the destination must be plain prose, or this is code or an already-parsed link.
    if (start < cursor || !inProse(start - 2)) continue;
    result += `${text.slice(cursor, start)}<${text.slice(start, end)}>`;
    cursor = end;
  }
  return result + text.slice(cursor);
}

function findSpacedFileLinkDestinations(text: string): Destination[] {
  const destinations: Destination[] = [];
  for (const match of text.matchAll(/\]\(file:/gi)) {
    const bracketAt = match.index ?? 0;
    // Link text opens on the same line.
    if (text.lastIndexOf("[", bracketAt) <= text.lastIndexOf("\n", bracketAt)) continue;
    const start = bracketAt + 2;
    const end = findDestinationEnd(text, start);
    if (end !== null && /\s/.test(text.slice(start, end))) destinations.push({ start, end });
  }
  return destinations;
}

/** The `)` closing a destination that starts at `start`; parentheses inside it must balance (`Doc (1).md`). */
function findDestinationEnd(text: string, start: number): number | null {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    // Angle-bracket destinations cannot hold these; leave such text alone.
    if (char === "\n" || char === "<" || char === ">") return null;
    if (char === "(") depth += 1;
    if (char !== ")") continue;
    if (depth === 0) return index;
    depth -= 1;
  }
  return null;
}

/** Source ranges of text nodes outside links. Code and HTML have no text nodes, so they are excluded too. */
function collectProseTextRanges(node: SourceNode, ranges: Array<[number, number]> = []): Array<[number, number]> {
  if (node.type === "link" || node.type === "linkReference") return ranges;
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (node.type === "text" && typeof start === "number" && typeof end === "number") ranges.push([start, end]);
  for (const child of node.children ?? []) collectProseTextRanges(child, ranges);
  return ranges;
}
