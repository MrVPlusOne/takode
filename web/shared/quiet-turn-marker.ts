/**
 * A herded worker ends a turn with a standalone `{[(Quiet: <summary>)]}` line when
 * the turn holds nothing its leader needs to act on or pass to the user. Takode
 * then holds the turn's herd event instead of waking the leader.
 */
const QUIET_MARKER_RE = /^\{\[\(Quiet: ([^\r\n]{1,200})\)\]\}$/;

/** The summary of a standalone quiet marker line, or null when the line is not one. */
export function parseQuietMarkerLine(line: string): string | null {
  const match = QUIET_MARKER_RE.exec(line.trim());
  const summary = match?.[1]?.trim();
  return summary ? summary : null;
}

/** Remove quiet marker lines from text; the last marker's summary wins. */
export function extractQuietMarkerFromText(text: string): { text: string; summary: string | null } {
  let summary: string | null = null;
  const keptLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const lineSummary = parseQuietMarkerLine(line);
    if (lineSummary === null) {
      keptLines.push(line);
      continue;
    }
    summary = lineSummary;
  }
  if (summary === null) return { text, summary };
  return {
    text: keptLines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd(),
    summary,
  };
}
