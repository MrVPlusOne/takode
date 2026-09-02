import type { DiffFileGroupStats, DiffLineStats } from "../../shared/diff-file-groups.js";

function hasChanges(stats: DiffLineStats): boolean {
  return stats.additions !== 0 || stats.deletions !== 0;
}

function StatsPair({ label, stats, testId }: { label: string; stats: DiffLineStats; testId?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-label={`${label} changes: ${stats.additions} additions, ${stats.deletions} deletions`}
      data-testid={testId}
    >
      <span className="text-cc-muted">{label}</span>
      <span className="text-green-500">+{stats.additions}</span>
      <span className="text-red-400">-{stats.deletions}</span>
    </span>
  );
}

export function DiffTotalStats({
  stats,
  verbose = false,
  className = "",
  testId,
}: {
  stats: DiffLineStats;
  verbose?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap text-[11px] ${className}`}
      aria-label={`Overall changes: ${stats.additions} additions, ${stats.deletions} deletions`}
      data-testid={testId}
    >
      <span className="text-green-500">
        +{stats.additions}
        {verbose ? " additions" : ""}
      </span>
      <span className="text-red-400">
        -{stats.deletions}
        {verbose ? " deletions" : ""}
      </span>
    </span>
  );
}

export function DiffStatsSummary({
  splitStats,
  className = "",
  testId = "diff-stats-summary",
}: {
  splitStats?: DiffFileGroupStats | null;
  className?: string;
  testId?: string;
}) {
  const showCode = splitStats ? hasChanges(splitStats.code) : false;
  const showTests = splitStats ? hasChanges(splitStats.tests) : false;
  if (!splitStats || (!showCode && !showTests)) return null;

  return (
    <span
      className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-code ${className}`}
      data-testid={testId}
    >
      {showCode && <StatsPair label="Code" stats={splitStats.code} testId={`${testId}-code`} />}
      {showTests && <StatsPair label="Tests" stats={splitStats.tests} testId={`${testId}-tests`} />}
    </span>
  );
}
