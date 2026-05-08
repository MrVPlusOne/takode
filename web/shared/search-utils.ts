/**
 * Search normalization utilities shared between server and client.
 * Provides CamelCase expansion so searches like "plan mode" match "ExitPlanMode".
 */

// Lower values sort first: exact-vs-prefix quality, then conservative field and position tie-breakers.
export type SearchRank = readonly [number, number, number, number, number, number];

export type SearchRankField = {
  rank: number;
  text: string | undefined;
};

export type SearchTextToken = {
  value: string;
  start: number;
  end: number;
};

/**
 * Insert spaces at CamelCase boundaries.
 *
 * - "ExitPlanMode"    -> "Exit Plan Mode"
 * - "HTMLParser"      -> "HTML Parser"
 * - "getHTTPResponse" -> "get HTTP Response"
 * - "already spaced"  -> "already spaced"
 */
export function expandCamelCase(text: string): string {
  return text
    .replace(/([a-z\d])([A-Z])/g, "$1 $2") // lowerUpper boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"); // acronym boundary (e.g. HTMLParser -> HTML Parser)
}

/**
 * Normalize text for search: split CamelCase/divided words, lowercase, and
 * collapse dividers to spaces. Apply to both query and haystack for consistent
 * matching.
 */
export function normalizeForSearch(text: string): string {
  return tokenizeSearchText(text)
    .map((token) => token.value)
    .join(" ");
}

export function tokenizeForSearch(text: string): string[] {
  return tokenizeSearchText(text).map((token) => token.value);
}

export function tokenizeSearchText(text: string): SearchTextToken[] {
  const tokens: SearchTextToken[] = [];
  for (const match of text.matchAll(/[A-Za-z0-9]+/g)) {
    const word = match[0];
    const wordStart = match.index ?? 0;
    let tokenStart = 0;
    for (let index = 1; index < word.length; index += 1) {
      if (!isCamelCaseBoundary(word, index)) continue;
      pushToken(tokens, word, wordStart, tokenStart, index);
      tokenStart = index;
    }
    pushToken(tokens, word, wordStart, tokenStart, word.length);
  }
  return tokens;
}

/**
 * Returns true if every query token matches an exact word or word prefix in
 * `text`. Arbitrary mid-word substrings do not count as matches.
 */
export function multiWordMatch(text: string, query: string): boolean {
  const words = tokenizeForSearch(query);
  if (words.length === 0) return false;
  const tokens = tokenizeForSearch(text);
  return words.every((word) => tokens.some((token) => token === word || token.startsWith(word)));
}

export function rankSearchFields(fields: SearchRankField[], query: string): SearchRank | null {
  const words = tokenizeForSearch(query);
  if (words.length === 0) return null;

  const bestMatches = words.map((word) => bestSearchFieldMatch(fields, word));
  if (bestMatches.some((match) => match === null)) return null;

  const matches = bestMatches.filter((match): match is FieldTokenMatch => match !== null);
  const prefixCount = matches.filter((match) => match.quality > 0).length;
  const worstQuality = Math.max(...matches.map((match) => match.quality));
  const fieldRankTotal = matches.reduce((sum, match) => sum + match.fieldRank, 0);
  const bestFieldRank = Math.min(...matches.map((match) => match.fieldRank));
  const firstIndexTotal = matches.reduce((sum, match) => sum + match.token.start, 0);
  const textLengthTotal = matches.reduce((sum, match) => sum + match.textLength, 0);
  return [worstQuality, prefixCount, fieldRankTotal, bestFieldRank, firstIndexTotal, textLengthTotal];
}

export function compareSearchRanks(left: SearchRank, right: SearchRank): number {
  for (let index = 0; index < left.length; index += 1) {
    const diff = left[index]! - right[index]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

type FieldTokenMatch = {
  quality: 0 | 1;
  fieldRank: number;
  token: SearchTextToken;
  textLength: number;
};

function bestSearchFieldMatch(fields: SearchRankField[], word: string): FieldTokenMatch | null {
  let best: FieldTokenMatch | null = null;
  for (const field of fields) {
    if (!field.text) continue;
    for (const token of tokenizeSearchText(field.text)) {
      const quality = token.value === word ? 0 : token.value.startsWith(word) ? 1 : null;
      if (quality === null) continue;
      const match: FieldTokenMatch = { quality, fieldRank: field.rank, token, textLength: field.text.length };
      if (!best || compareFieldTokenMatch(match, best) < 0) best = match;
    }
  }
  return best;
}

function compareFieldTokenMatch(left: FieldTokenMatch, right: FieldTokenMatch): number {
  return (
    left.quality - right.quality ||
    left.fieldRank - right.fieldRank ||
    left.token.start - right.token.start ||
    left.textLength - right.textLength
  );
}

function pushToken(tokens: SearchTextToken[], word: string, wordStart: number, tokenStart: number, tokenEnd: number) {
  const value = word.slice(tokenStart, tokenEnd).toLowerCase();
  if (!value) return;
  tokens.push({ value, start: wordStart + tokenStart, end: wordStart + tokenEnd });
}

function isCamelCaseBoundary(word: string, index: number): boolean {
  const previous = word[index - 1]!;
  const current = word[index]!;
  const next = word[index + 1];
  if (isLowercaseOrDigit(previous) && isUppercase(current)) return true;
  return isUppercase(previous) && isUppercase(current) && next !== undefined && isLowercase(next);
}

function isLowercaseOrDigit(char: string): boolean {
  return /[a-z0-9]/.test(char);
}

function isUppercase(char: string): boolean {
  return /[A-Z]/.test(char);
}

function isLowercase(char: string): boolean {
  return /[a-z]/.test(char);
}
