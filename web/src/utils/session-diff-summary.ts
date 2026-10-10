import type { AppState } from "../store-types.js";

// Partial so store mocks without diff state still resolve to "no changes".
type SessionDiffSummaryState = Partial<Pick<AppState, "sessions" | "sdkSessions" | "changedFiles" | "diffFileStats">>;

/** What a session's working diff holds, as shown on the diff chips. */
export interface SessionDiffSummary {
  linesAdded: number;
  linesRemoved: number;
  /** Files the browser saw the agent edit; only counted when the server's line stats don't cover the session. */
  changedFiles: number;
}

export const EMPTY_SESSION_DIFF_SUMMARY: SessionDiffSummary = { linesAdded: 0, linesRemoved: 0, changedFiles: 0 };

export function hasSessionDiff(summary: SessionDiffSummary | null | undefined): boolean {
  return !!summary && (summary.linesAdded > 0 || summary.linesRemoved > 0 || summary.changedFiles > 0);
}

/**
 * Server line stats are authoritative for worktree sessions. Other sessions on the default branch, or
 * sessions whose stats were skipped, have no server stats, so they fall back to the files the browser
 * saw the agent edit (the count the old top-bar Diff button showed).
 */
export function resolveSessionDiffSummary(
  state: SessionDiffSummaryState,
  sessionId: string | null | undefined,
): SessionDiffSummary {
  if (!sessionId) return EMPTY_SESSION_DIFF_SUMMARY;
  const live = state.sessions?.get(sessionId);
  const sdk = state.sdkSessions?.find((session) => session.sessionId === sessionId);
  if (!live && !sdk) return EMPTY_SESSION_DIFF_SUMMARY;
  const linesAdded = live?.total_lines_added ?? sdk?.totalLinesAdded ?? 0;
  const linesRemoved = live?.total_lines_removed ?? sdk?.totalLinesRemoved ?? 0;
  const isWorktree = live?.is_worktree ?? sdk?.isWorktree ?? false;
  const skipped = !!(live?.diff_stats_skipped_reason ?? sdk?.diffStatsSkippedReason);
  const serverStatsCover = isWorktree && !skipped;
  const changedFiles =
    serverStatsCover || linesAdded > 0 || linesRemoved > 0
      ? 0
      : countScopedChangedFiles(state, sessionId, live?.cwd || sdk?.cwd, live?.repo_root || sdk?.repoRoot);
  return { linesAdded, linesRemoved, changedFiles };
}

function countScopedChangedFiles(
  state: SessionDiffSummaryState,
  sessionId: string,
  cwd: string | undefined,
  repoRoot: string | undefined,
): number {
  const files = state.changedFiles?.get(sessionId);
  if (!files) return 0;
  if (!cwd) return files.size;

  // Use repo_root only when it's an ancestor of cwd (worktrees have a different root).
  const scope = repoRoot && cwd.startsWith(repoRoot + "/") ? repoRoot : cwd;
  const prefix = `${scope}/`;
  const scopedFiles = [...files].filter((fp) => fp === scope || fp.startsWith(prefix));
  const stats = state.diffFileStats?.get(sessionId);
  if (!stats || stats.size === 0) return scopedFiles.length;

  return scopedFiles.filter((fp) => {
    const st = stats.get(fp);
    return !st || st.additions > 0 || st.deletions > 0;
  }).length;
}

/** Compact counts for narrow chips: 1234 -> 1.2k. */
export function formatDiffLineCount(value: number): string {
  if (value < 1000) return String(value);
  const thousands = value / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}
