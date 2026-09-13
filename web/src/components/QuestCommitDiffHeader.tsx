import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { commitComparisonLabel } from "../../shared/quest-delivery.js";
import type { QuestCommitLookup } from "../api.js";
import { commitLookupKey, commitTitle, shortCommitSha } from "./QuestCommitEvidence.js";
import type { QuestCommitDiffState } from "./QuestCommitDiffView.js";
import { DiffStatsSummary, DiffTotalStats } from "./DiffStatsSummary.js";

/** Shared commit context stays compact without changing the selected evidence. */
export function QuestCommitDiffHeader({
  state,
  commitLabel,
  context,
  fileNavigationRef,
  onClose,
}: {
  state: QuestCommitDiffState;
  commitLabel?: string;
  context?: ReactNode;
  fileNavigationRef: Ref<HTMLSpanElement>;
  onClose?: () => void;
}) {
  const { activeCommitEntry: entry, activeCommitDetails: details, activeCommitIndex, commitEntries } = state;
  const title = entry ? commitTitle(entry, details) : "Commit diff";
  const hasStats =
    entry && details?.available && typeof details.additions === "number" && typeof details.deletions === "number";
  return (
    <header className="quest-commit-header">
      <div className="quest-commit-header-main">
        <span className="quest-commit-label">
          {commitLabel ?? (entry?.kind === "memory" ? "Memory Commit" : "Code Commit")}
        </span>
        <strong className="quest-commit-title" title={title}>
          {title}
        </strong>
        {hasStats && (
          <DiffTotalStats
            stats={{ additions: details.additions!, deletions: details.deletions! }}
            className="gap-2"
            testId="quest-commit-diff-stats-overall"
          />
        )}
        <div className="quest-commit-navigation">
          <button
            type="button"
            aria-label="Previous"
            title="Previous commit"
            disabled={activeCommitIndex <= 0}
            onClick={() => state.openCommit(commitEntries[activeCommitIndex - 1]!)}
          >
            <span aria-hidden="true">‹</span>
          </button>
          <span className="text-[10px] text-cc-muted" aria-label="Commit position">
            {entry ? activeCommitIndex + 1 : 0}/{commitEntries.length}
          </span>
          <button
            type="button"
            aria-label="Next"
            title="Next commit"
            disabled={!entry || activeCommitIndex >= commitEntries.length - 1}
            onClick={() => state.openCommit(commitEntries[activeCommitIndex + 1]!)}
          >
            <span aria-hidden="true">›</span>
          </button>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close commit modal" title="Close">
              <svg
                viewBox="0 0 16 16"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="quest-commit-header-context">
        {entry &&
          (commitEntries.length > 1 ? (
            <select
              aria-label="Select commit"
              title={entry.sha}
              className="quest-commit-select"
              value={state.activeCommitKey ?? ""}
              onChange={(event) => {
                const selected = commitEntries.find(
                  (candidate) => commitLookupKey(candidate.kind, candidate.sha) === event.target.value,
                );
                if (selected) state.openCommit(selected);
              }}
            >
              {commitEntries.map((candidate) => {
                const key = commitLookupKey(candidate.kind, candidate.sha);
                return (
                  <option key={key} value={key}>
                    {candidate.kind === "memory" ? "Memory" : "Code"} {shortCommitSha(candidate.sha)} ·{" "}
                    {commitTitle(candidate, state.commitLookupByKey[key])}
                  </option>
                );
              })}
            </select>
          ) : (
            <code className="text-[10px] text-cc-muted" title={entry.sha}>
              {details?.shortSha || shortCommitSha(entry.sha)}
            </code>
          ))}
        {entry && details?.timestamp ? (
          <span className="text-[10px] text-cc-muted">{timeAgo(details.timestamp)}</span>
        ) : null}
        {hasStats && <DiffStatsSummary splitStats={details.splitStats} testId="quest-commit-diff-stats" />}
        <span className="quest-commit-header-spacer" />
        <span ref={fileNavigationRef} />
        {context}
        {entry && <CommitDetails key={state.activeCommitKey} title={title} sha={entry.sha} details={details} />}
      </div>
    </header>
  );
}

function CommitDetails({ title, sha, details }: { title: string; sha: string; details?: QuestCommitLookup }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Dismiss the disclosure before the enclosing native dialog handles Escape.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);
  return (
    <div ref={root} className="quest-commit-details">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        {details?.recordedStats ? "Details · saved counts differ" : "Details"}
      </button>
      {open && (
        <div id={panelId} role="region" aria-label="Commit details" className="quest-commit-details-panel">
          <h3 className="font-semibold text-sm">{title}</h3>
          <code className="block break-all text-[10px] text-cc-muted mt-2">{sha}</code>
          {details?.timestamp ? (
            <p className="mt-2 text-xs text-cc-muted">{new Date(details.timestamp).toLocaleString()}</p>
          ) : null}
          {details?.available && details.comparison && (
            <p className="mt-3 text-xs text-cc-muted" data-testid="quest-commit-comparison">
              {commitComparisonLabel(details.comparison)}
              {details.comparison.baseSha && (
                <code className="ml-1 break-all" title={details.comparison.baseSha}>
                  {shortCommitSha(details.comparison.baseSha)}
                </code>
              )}
              {details.comparison.parentCount > 1 &&
                ". This compares the whole merge with its first parent and may include existing layer code."}
            </p>
          )}
          {details?.available && details.recordedStats && (
            <p className="mt-3 text-xs text-cc-muted" data-testid="quest-commit-recorded-stats">
              Saved chip counts: +{details.recordedStats.additions} −{details.recordedStats.deletions}
              {details.recordedStats.binaryFiles > 0 && `; ${details.recordedStats.binaryFiles} binary files`}
              {` (${commitComparisonLabel(details.recordedStats.comparison)}). The header totals describe the comparison shown here.`}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Math.max(0, Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}
