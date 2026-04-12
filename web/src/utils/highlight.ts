export type HighlightPart = {
  text: string;
  matched: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Split text into highlighted/unhighlighted parts for a search query.
 * Tries exact substring first, then falls back to per-word matching
 * (handles CamelCase queries like "plan mode" matching "ExitPlanMode").
 */
export function getHighlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const trimmed = query.trim();
  if (!trimmed) return [{ text, matched: false }];

  // Try exact substring match first
  const exactPattern = new RegExp(`(${escapeRegExp(trimmed)})`, "ig");
  const exactPieces = text.split(exactPattern).filter((p) => p.length > 0);
  if (exactPieces.some((p) => p.toLowerCase() === trimmed.toLowerCase())) {
    return exactPieces.map((piece) => ({
      text: piece,
      matched: piece.toLowerCase() === trimmed.toLowerCase(),
    }));
  }

  // Fallback: match each word independently (handles CamelCase matches)
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [{ text, matched: false }];

  const wordPattern = new RegExp(`(${words.map(escapeRegExp).join("|")})`, "ig");
  const pieces = text.split(wordPattern).filter((p) => p.length > 0);
  const wordSet = new Set(words.map((w) => w.toLowerCase()));
  return pieces.map((piece) => ({
    text: piece,
    matched: wordSet.has(piece.toLowerCase()),
  }));
}
