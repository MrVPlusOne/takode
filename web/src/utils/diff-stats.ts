type FileStats = { additions: number; deletions: number };

/** Sum additions or deletions from a per-file diff stats Map. */
function sumFileStats(
  stats: Map<string, FileStats> | undefined,
  key: "additions" | "deletions",
): number {
  if (!stats || stats.size === 0) return 0;
  let total = 0;
  for (const v of stats.values()) total += v[key] ?? 0;
  return total;
}

/**
 * Resolve line-change stats from the best available source.
 *
 * Priority: server bridge state > REST-enriched SDK info > browser-computed per-file stats.
 * Server values auto-refresh via polling; browser values are only updated when
 * the DiffPanel is open.
 */
export function resolveLineStats(
  bridgeLinesAdded: number | undefined,
  bridgeLinesRemoved: number | undefined,
  sdkLinesAdded: number | undefined,
  sdkLinesRemoved: number | undefined,
  perFileStats?: Map<string, FileStats>,
): { linesAdded: number; linesRemoved: number } {
  return {
    linesAdded: bridgeLinesAdded || sdkLinesAdded || sumFileStats(perFileStats, "additions") || 0,
    linesRemoved: bridgeLinesRemoved || sdkLinesRemoved || sumFileStats(perFileStats, "deletions") || 0,
  };
}
