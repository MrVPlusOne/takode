export type HighlightPart = {
  text: string;
  matched: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getHighlightParts(text: string, query: string): HighlightPart[] {
  if (!text) return [];
  const trimmed = query.trim();
  if (!trimmed) return [{ text, matched: false }];

  const pattern = new RegExp(`(${escapeRegExp(trimmed)})`, "ig");
  const pieces = text.split(pattern).filter((piece) => piece.length > 0);
  return pieces.map((piece) => ({
    text: piece,
    matched: piece.toLowerCase() === trimmed.toLowerCase(),
  }));
}
