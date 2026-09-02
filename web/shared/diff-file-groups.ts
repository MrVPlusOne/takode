export interface DiffLineStats {
  additions: number;
  deletions: number;
}

export interface DiffFileLineStats extends DiffLineStats {
  path: string;
}

export interface DiffFileGroupStats {
  code: DiffLineStats;
  tests: DiffLineStats;
}

const TEST_DIRECTORY_PATTERN = /^(?:__tests?__|tests?|specs?)$/i;
const TEST_FILE_TOKEN_PATTERN = /(?:^|[._-])(?:test|spec)(?=[._-]|$)/i;

/**
 * Classifies conventional test paths without matching broad substrings such as
 * `contest.ts`, `specification.ts`, or a `testing/` production directory.
 */
export function isLikelyTestFile(filePath: string): boolean {
  const segments = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length === 0) return false;

  if (segments.slice(0, -1).some((segment) => TEST_DIRECTORY_PATTERN.test(segment))) {
    return true;
  }

  return TEST_FILE_TOKEN_PATTERN.test(segments[segments.length - 1]);
}

/** Stable-partitions files so code appears before tests without re-sorting either group. */
export function orderDiffFilesCodeFirst<T>(files: readonly T[], getPath: (file: T) => string): T[] {
  const code: T[] = [];
  const tests: T[] = [];

  for (const file of files) {
    (isLikelyTestFile(getPath(file)) ? tests : code).push(file);
  }

  return [...code, ...tests];
}

export function summarizeDiffFileStats(fileStats: readonly DiffFileLineStats[]): DiffFileGroupStats {
  const summary: DiffFileGroupStats = {
    code: { additions: 0, deletions: 0 },
    tests: { additions: 0, deletions: 0 },
  };

  for (const file of fileStats) {
    const bucket = isLikelyTestFile(file.path) ? summary.tests : summary.code;
    bucket.additions += file.additions;
    bucket.deletions += file.deletions;
  }

  return summary;
}
