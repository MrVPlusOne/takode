import type { ConversationAnnotation } from "../shared/conversation-annotations.js";
import { tokenizeSearchText, type PreparedSearchQuery, type SearchTextToken } from "../shared/search-utils.js";

/**
 * How well a message matches a query, best first. Message search orders matches by this
 * strength, then newest first, so recency decides within each group instead of where in
 * the message the words happen to appear.
 *
 * - 0: every word as a whole word, together in query order (a phrase, allowing one word
 *   between neighbours so "restart server" finds "restart the server")
 * - 1: every word as a whole word, but apart
 * - 2: together, but some word only as the start of a longer word (mostly while typing)
 * - 3: apart, and some word only as the start of a longer word
 */
export type MessageMatchStrength = 0 | 1 | 2 | 3;

export interface MessageTextMatch {
  strength: MessageMatchStrength;
  /** Character range of the matched words in the searched text, for centering a snippet. */
  start: number;
  end: number;
}

export interface MessageSnippet {
  snippet: string;
  matchRanges: Array<{ start: number; end: number }>;
  matchedText?: string;
}

/** The words a user wrote in a message: its text plus their comments, not the text they quoted. */
export function userWrittenText(content: string, annotations: readonly ConversationAnnotation[] | undefined): string {
  return [content, ...(annotations ?? []).map((annotation) => annotation.comment)]
    .filter((part) => part.trim())
    .join("\n\n");
}

/** Match a prepared query against message text; null when some query word is absent. */
export function matchMessageText(text: string, words: PreparedSearchQuery): MessageTextMatch | null {
  return matchTokens(tokenizeSearchText(text), words);
}

/** A short excerpt around the best match, with every matching word in it highlighted. */
export function buildMessageSnippet(text: string, words: PreparedSearchQuery | null): MessageSnippet {
  const collapsed = text.replace(/\s+/g, " ").trim();
  const tokens = words ? tokenizeSearchText(collapsed) : [];
  const match = words ? matchTokens(tokens, words) : null;
  if (!words || !match) return { snippet: truncateSnippet(collapsed), matchRanges: [] };

  const desiredContext = 70;
  const start = Math.max(0, match.start - desiredContext);
  const end = Math.min(collapsed.length, match.end + desiredContext);
  const snippetStart = start > 0 ? nextWordBoundary(collapsed, start) : 0;
  const snippetEnd = end < collapsed.length ? previousWordBoundary(collapsed, end) : collapsed.length;
  const prefix = snippetStart > 0 ? "..." : "";
  const suffix = snippetEnd < collapsed.length ? "..." : "";
  const body = collapsed.slice(snippetStart, snippetEnd).trim();
  const bodyOffset = prefix.length - snippetStart;
  const matchRanges = tokens
    .filter((token) => token.start >= snippetStart && token.end <= snippetEnd && matchesAnyWord(token, words))
    .map((token) => ({
      start: token.start + bodyOffset,
      end: token.end + bodyOffset,
    }));
  return {
    snippet: `${prefix}${body}${suffix}`,
    matchRanges,
    matchedText: collapsed.slice(match.start, match.end),
  };
}

/** Neighbouring query words may have at most this many other words between them and still count as together. */
const MAX_WORDS_BETWEEN = 1;

type WordTest = (token: SearchTextToken, word: string) => boolean;
const isWholeWord: WordTest = (token, word) => token.value === word;
const isWordOrPrefix: WordTest = (token, word) => token.value.startsWith(word);

function matchTokens(tokens: readonly SearchTextToken[], words: PreparedSearchQuery): MessageTextMatch | null {
  if (words.length === 0 || !words.every((word) => tokens.some((token) => isWordOrPrefix(token, word)))) return null;
  const whole = words.every((word) => tokens.some((token) => isWholeWord(token, word)));
  const test = whole ? isWholeWord : isWordOrPrefix;
  const together = findTogether(tokens, words, test);
  if (together) return { strength: whole ? 0 : 2, ...together };
  const first = tokens.find((token) => words.some((word) => test(token, word)))!;
  return { strength: whole ? 1 : 3, start: first.start, end: first.end };
}

/**
 * The earliest run of tokens matching the query words in order, each within
 * MAX_WORDS_BETWEEN of the previous one. Tracks every reachable position per word,
 * so a closer later occurrence is not lost to a greedy earlier choice.
 */
function findTogether(
  tokens: readonly SearchTextToken[],
  words: PreparedSearchQuery,
  test: WordTest,
): { start: number; end: number } | null {
  // Maps a token index matching the current word to the earliest index where a run reaching it began.
  let reachable = new Map<number, number>();
  tokens.forEach((token, index) => {
    if (test(token, words[0]!)) reachable.set(index, index);
  });
  for (const word of words.slice(1)) {
    const next = new Map<number, number>();
    for (const [index, runStart] of reachable) {
      for (let candidate = index + 1; candidate <= index + 1 + MAX_WORDS_BETWEEN; candidate++) {
        const token = tokens[candidate];
        if (!token || !test(token, word)) continue;
        const known = next.get(candidate);
        if (known === undefined || runStart < known) next.set(candidate, runStart);
      }
    }
    reachable = next;
    if (reachable.size === 0) return null;
  }
  let best: { start: number; end: number } | null = null;
  for (const [index, runStart] of reachable) {
    if (!best || tokens[runStart]!.start < best.start)
      best = { start: tokens[runStart]!.start, end: tokens[index]!.end };
  }
  return best;
}

function matchesAnyWord(token: SearchTextToken, words: PreparedSearchQuery): boolean {
  return words.some((word) => isWordOrPrefix(token, word));
}

function truncateSnippet(text: string, limit = 180): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}...`;
}

function nextWordBoundary(text: string, index: number): number {
  const nextSpace = text.indexOf(" ", index);
  return nextSpace === -1 ? index : nextSpace + 1;
}

function previousWordBoundary(text: string, index: number): number {
  const previousSpace = text.lastIndexOf(" ", index);
  return previousSpace === -1 ? index : previousSpace;
}
