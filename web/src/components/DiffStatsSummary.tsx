import type { DiffFileGroupStats, DiffLineStats } from "../../shared/diff-file-groups.js";

function StatsPair({
  label,
  stats,
  verbose,
  testId,
}: {
  label: string;
  stats: DiffLineStats;
  verbose: boolean;
  testId?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      aria-label={`${label} changes: ${stats.additions} additions, ${stats.deletions} deletions`}
      data-testid={testId}
    >
      <span className="text-cc-muted">{label}</span>
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
  overall,
  splitStats,
  verboseOverall = false,
  className = "",
  testId = "diff-stats-summary",
}: {
  overall: DiffLineStats;
  splitStats?: DiffFileGroupStats | null;
  verboseOverall?: boolean;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono-code ${className}`}
      data-testid={testId}
    >
      <StatsPair label="Overall" stats={overall} verbose={verboseOverall} testId={`${testId}-overall`} />
      {splitStats && (
        <>
          <StatsPair label="Code" stats={splitStats.code} verbose={false} testId={`${testId}-code`} />
          <StatsPair label="Tests" stats={splitStats.tests} verbose={false} testId={`${testId}-tests`} />
        </>
      )}
    </span>
  );
}
