import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { diffTargetSessionId, resolveDiffTarget, type DiffTargetResolution } from "../utils/diff-target.js";
import {
  formatDiffLineCount,
  hasSessionDiff,
  resolveSessionDiffSummary,
  type SessionDiffSummary,
} from "../utils/session-diff-summary.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { commitCountLabel } from "./QuestCommitEvidence.js";
import { useQuestCodeCommitShas } from "./QuestCommitDiffView.js";

/** Everything a diff chip shows, from the same resolver the diff view uses. */
export function useDiffChipState(
  sessionId: string | null | undefined,
  threadKey: string,
  fallbackCommitShas?: readonly string[],
): {
  target: DiffTargetResolution | null;
  commitCount: number | null;
  changes: SessionDiffSummary;
} {
  const target = useStore(useShallow((state) => resolveDiffTarget(state, sessionId, threadKey)));
  const changesSessionId = diffTargetSessionId(target);
  const changes = useStore(useShallow((state) => resolveSessionDiffSummary(state, changesSessionId)));
  const questId = target?.kind === "quest" ? target.questId : null;
  const { commitShas } = useQuestCodeCommitShas(questId, fallbackCommitShas);
  return { target, commitCount: questId ? commitShas.length : null, changes };
}

function changesLabel(changes: SessionDiffSummary): string | null {
  if (changes.linesAdded > 0 || changes.linesRemoved > 0) {
    return `+${changes.linesAdded} -${changes.linesRemoved}`;
  }
  if (changes.changedFiles > 0) return `${changes.changedFiles} ${changes.changedFiles === 1 ? "file" : "files"}`;
  return null;
}

/** Plain-language description of the chip, used for its accessible name. */
export function diffChipDescription(commitCount: number | null, changes: SessionDiffSummary): string {
  const parts: string[] = [];
  if (commitCount !== null && (commitCount > 0 || !hasSessionDiff(changes))) {
    parts.push(commitCount > 0 ? commitCountLabel(commitCount) : "no commits");
  }
  const changeText = changesLabel(changes);
  if (changeText) {
    parts.push(
      changes.linesAdded > 0 || changes.linesRemoved > 0
        ? `${changes.linesAdded} lines added and ${changes.linesRemoved} removed`
        : `${changeText} changed`,
    );
  }
  return parts.join(", ") || "no changes";
}

/**
 * The one place to open a diff: a quest's recorded commits plus its worker's changes, or a session's own
 * changes. Counts are plain text inside the chip, never an unread-style corner badge. The label stays short
 * for phones: "2 commits", "+120 -8", "2 commits · +120 -8", "No commits", or "3 files".
 */
export function DiffChipButton({
  commitCount,
  changes,
  onOpen,
  title,
  testId = "diff-chip",
}: {
  /** null when the target has no commits to show (a session's own diff). */
  commitCount: number | null;
  changes: SessionDiffSummary;
  onOpen: () => void;
  title: string;
  testId?: string;
}) {
  const hasChanges = hasSessionDiff(changes);
  const showCommits = commitCount !== null && (commitCount > 0 || !hasChanges);
  const empty = !hasChanges && (commitCount === null || commitCount === 0);
  const hasLines = changes.linesAdded > 0 || changes.linesRemoved > 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`inline-flex h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1 text-[11px] leading-none transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline focus-visible:outline-cc-primary ${
        empty ? "text-cc-muted" : "text-cc-fg"
      }`}
      data-testid={testId}
      data-has-changes={hasChanges}
      aria-label={`${title}: ${diffChipDescription(commitCount, changes)}`}
      title={title}
    >
      <DiffChipIcon className={`h-3.5 w-3.5 ${empty ? "" : "text-cc-muted"}`} />
      {showCommits && (
        <span className="tabular-nums" data-testid={`${testId}-commits`}>
          {commitCount ? commitCountLabel(commitCount) : "No commits"}
        </span>
      )}
      {showCommits && hasChanges && (
        <span className="text-cc-muted" aria-hidden="true">
          ·
        </span>
      )}
      {hasChanges && (
        <span className="inline-flex items-center gap-1 font-mono-code tabular-nums" data-testid={`${testId}-changes`}>
          {hasLines ? (
            <>
              <span className="text-green-500">+{formatDiffLineCount(changes.linesAdded)}</span>
              <span className="text-red-400">-{formatDiffLineCount(changes.linesRemoved)}</span>
            </>
          ) : (
            changesLabel(changes)
          )}
        </span>
      )}
    </button>
  );
}

/** A diff chip wired to the store: resolves its target and opens the diff view for it. */
export function DiffChip({
  sessionId,
  threadKey,
  fallbackCommitShas,
  testId,
}: {
  sessionId: string | null | undefined;
  threadKey: string;
  fallbackCommitShas?: readonly string[];
  testId?: string;
}) {
  const { target, commitCount, changes } = useDiffChipState(sessionId, threadKey, fallbackCommitShas);
  const openDiffView = useStore((state) => state.openDiffView);
  if (!sessionId || !target) return null;
  // A session's own diff has nothing to show while it is clean; quest chips keep saying "No commits".
  if (target.kind === "session" && !hasSessionDiff(changes)) return null;
  return (
    <DiffChipButton
      commitCount={commitCount}
      changes={changes}
      title={target.title}
      testId={testId}
      onOpen={() => {
        useStore.getState().closeCodexSubagentInspector();
        openDiffView(sessionId, threadKey);
      }}
    />
  );
}

/**
 * A chip for a session's own changes (the leader's Main banner, a session without a quest). It reads only
 * that session's change summary, with no quest lookups, so board and projection updates don't re-render
 * it; nothing shows while the session is clean. Opening it goes through the same resolver as every chip.
 */
export function SessionChangesChip({
  sessionId,
  threadKey,
  title,
  testId,
}: {
  sessionId: string;
  threadKey: string;
  title: string;
  testId?: string;
}) {
  const changes = useStore(useShallow((state) => resolveSessionDiffSummary(state, sessionId)));
  const openDiffView = useStore((state) => state.openDiffView);
  if (!hasSessionDiff(changes)) return null;
  return (
    <DiffChipButton
      commitCount={null}
      changes={changes}
      title={title}
      testId={testId}
      onOpen={() => {
        useStore.getState().closeCodexSubagentInspector();
        openDiffView(sessionId, threadKey);
      }}
    />
  );
}

/** Two-pane file diff glyph, the same mark the old top-bar Diff button used. */
export function DiffChipIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d="M2.5 1A1.5 1.5 0 001 2.5v11A1.5 1.5 0 002.5 15h3a.5.5 0 000-1h-3a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5h3a.5.5 0 000-1h-3zM10.5 1a.5.5 0 000 1h3a.5.5 0 01.5.5v11a.5.5 0 01-.5.5h-3a.5.5 0 000 1h3A1.5 1.5 0 0015 13.5v-11A1.5 1.5 0 0013.5 1h-3zM8 3.5a.5.5 0 01.5.5v8a.5.5 0 01-1 0V4a.5.5 0 01.5-.5zM5.5 6a.5.5 0 000 1h1a.5.5 0 000-1h-1zm4 0a.5.5 0 000 1h1a.5.5 0 000-1h-1zM5.5 9a.5.5 0 000 1h1a.5.5 0 000-1h-1zm4 0a.5.5 0 000 1h1a.5.5 0 000-1h-1z" />
    </svg>
  );
}

/**
 * A session without a quest has no quest banner, so while it has changes this slim banner holds its diff
 * chip. With no changes there is nothing to show.
 */
export function SessionDiffBanner({ sessionId }: { sessionId: string }) {
  const hasChanges = useStore((state) => hasSessionDiff(resolveSessionDiffSummary(state, sessionId)));
  if (!hasChanges) return null;
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1 text-xs sm:px-3"
      data-testid="session-diff-banner"
    >
      <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] text-cc-muted/65">Changes</span>
      <SessionChangesChip sessionId={sessionId} threadKey={MAIN_THREAD_KEY} title="Show changes" />
    </div>
  );
}
