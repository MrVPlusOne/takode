import { tokenizeSearchText } from "../../shared/search-utils.js";

export type HighlightPart = {
  text: string;
  matched: boolean;
};

/**
 * Split text into highlighted/unhighlighted parts for a search query.
 * Highlights exact word and word-prefix matches so Questmaster search does not
 * mark arbitrary mid-word substrings like `ui` inside `guidance`.
 */
export function getHighlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const ranges = getHighlightRanges(text, query);
  if (ranges.length === 0) return [{ text, matched: false }];
  return splitHighlightParts(text, ranges);
}

function getHighlightRanges(text: string, query: string): Array<{ start: number; end: number }> {
  const words = tokenizeSearchText(query);
  if (words.length === 0) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const token of tokenizeSearchText(text)) {
    const match = words.find((word) => token.value === word.value || token.value.startsWith(word.value));
    if (!match) continue;
    ranges.push({ start: token.start, end: Math.min(token.end, token.start + match.value.length) });
  }
  return mergeHighlightRanges(ranges);
}

function mergeHighlightRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = ranges
    .filter((range) => range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const previous = merged.at(-1);
    if (!previous || range.start >= previous.end) {
      merged.push({ ...range });
      continue;
    }
    previous.end = Math.max(previous.end, range.end);
  }
  return merged;
}

function splitHighlightParts(text: string, ranges: Array<{ start: number; end: number }>): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of ranges) {
    if (cursor < range.start) parts.push({ text: text.slice(cursor, range.start), matched: false });
    parts.push({ text: text.slice(range.start, range.end), matched: true });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), matched: false });
  return parts;
}
