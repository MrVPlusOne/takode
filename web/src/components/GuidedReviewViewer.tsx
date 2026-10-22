import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, type QuestCommitLookup } from "../api.js";
import { closeGuidedReview, useGuidedReviewState, type GuidedReviewTarget } from "../guided-review-state.js";
import type { GuidedReviewMeta } from "../../shared/guided-review.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { QuestCommitDiffView, buildCodeCommitEntries, useQuestCommitDiffState } from "./QuestCommitDiffView.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";
import { Walkthrough } from "./GuidedReviewWalkthrough.js";

/** Renders the open guided review; mount once at the app root. */
export function GuidedReviewViewerHost() {
  const open = useGuidedReviewState((state) => state.open);
  return open ? <GuidedReviewViewer key={open.meta.reviewId} target={open} /> : null;
}

/**
 * A guided review: its header, the walkthrough of its stops and, on request, the full change read
 * from git. Wide screens show it in the secondary view; phones cover the conversation.
 */
export function GuidedReviewViewer({ target }: { target: GuidedReviewTarget }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [fullDiffOpen, setFullDiffOpen] = useState(false);
  usePreviewSheetHistoryEntry(true, sheetRef, closeGuidedReview);
  const dockTarget = useSecondaryViewTarget(true, closeGuidedReview, "wide");
  const docked = dockTarget !== null;
  const { map } = target.meta;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape while typing an answer leaves the field, not the review.
      const element = event.target;
      if (element instanceof Element && element.closest("textarea, input, [contenteditable='true']")) return;
      if (fullDiffOpen) setFullDiffOpen(false);
      else closeGuidedReview();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullDiffOpen]);

  useEffect(() => {
    if (docked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [docked]);

  return createPortal(
    <div
      className={docked ? SECONDARY_VIEWER_LAYER_CLASS : "fixed inset-0 z-50 flex flex-col bg-cc-bg"}
      onClick={(event) => event.stopPropagation()}
      data-testid="guided-review-viewer"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={`Guided review: ${map.title}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b border-cc-border bg-cc-card">
          <div className="mx-auto flex w-full max-w-[1180px] items-start gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-cc-muted">Guided review by an agent</div>
              <div className="text-[16px] font-semibold leading-snug text-cc-fg">{map.title}</div>
              <RangeLine meta={target.meta} />
            </div>
            <button
              type="button"
              onClick={() => setFullDiffOpen(true)}
              className="h-9 shrink-0 rounded-lg border border-cc-border px-3 text-[13px] text-cc-fg hover:bg-cc-hover"
            >
              Full diff
            </button>
            <button
              type="button"
              onClick={closeGuidedReview}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
              aria-label="Close review"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-4 w-4">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <Walkthrough target={target} paused={fullDiffOpen} onOpenFullDiff={() => setFullDiffOpen(true)} />
      </div>
      {fullDiffOpen && <GuidedReviewFullDiff target={target} onClose={() => setFullDiffOpen(false)} />}
    </div>,
    dockTarget ?? document.body,
  );
}

function RangeLine({ meta }: { meta: GuidedReviewMeta }) {
  const { range, stats } = meta;
  const commits = range.commits.length;
  return (
    <div className="mt-0.5 text-[13px] text-cc-muted">
      {range.repo} · {commits} commit{commits === 1 ? "" : "s"} · {stats.files} files ·{" "}
      <span className="text-cc-success">+{stats.additions}</span>{" "}
      <span className="text-cc-error">−{stats.deletions}</span>
    </div>
  );
}

/** The review's whole range, commit by commit, read from git like a quest's commits. */
function GuidedReviewFullDiff({ target, onClose }: { target: GuidedReviewTarget; onClose: () => void }) {
  const { meta, sessionId } = target;
  const dockTarget = useSecondaryViewTarget(true, onClose, "wide");
  const storedEntries = useMemo(
    () => buildCodeCommitEntries(meta.range.commits.map((commit) => commit.sha)),
    [meta.range.commits],
  );
  const lookup = useMemo(
    () =>
      (entry: { sha: string }, includeDiff: boolean): Promise<QuestCommitLookup> =>
        api.getGuidedReviewCommit(sessionId, meta.reviewId, entry.sha, { includeDiff }),
    [sessionId, meta.reviewId],
  );
  const state = useQuestCommitDiffState({
    questId: meta.reviewId,
    storedEntries,
    autoOpenFirst: true,
    lookup,
    preserveOrder: true,
  });
  return createPortal(
    <div
      className={dockTarget ? `${SECONDARY_VIEWER_LAYER_CLASS} z-20` : "fixed inset-0 z-[60] flex flex-col bg-cc-bg"}
      data-testid="guided-review-full-diff"
    >
      <QuestCommitDiffView
        state={state}
        onClose={onClose}
        commitLabel="Full diff"
        emptyTitle="No commits"
        emptyMessage="This review names no commits to show."
      />
    </div>,
    dockTarget ?? document.body,
  );
}
