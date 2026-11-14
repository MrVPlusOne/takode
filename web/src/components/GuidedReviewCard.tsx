import { useEffect, useState } from "react";
import { resolveGuidedReview } from "../guided-review-home.js";
import { openGuidedReview, useGuidedReviewState, type GuidedReviewTarget } from "../guided-review-state.js";
import { ReviewCounts, useSessionLabel } from "./GuidedReviewParts.js";

/**
 * A guided review, in the feed or the Library: what it covers and what it asks of the reader, with
 * a button that opens its walkthrough.
 */
export function GuidedReviewCard({ target, actions }: { target: GuidedReviewTarget; actions?: React.ReactNode }) {
  const { meta } = target;
  // Where the review's answers are kept and sent, which a share elsewhere may have moved.
  const [resolved, setResolved] = useState<GuidedReviewTarget | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    resolveGuidedReview(target).then(
      (next) => current && setResolved(next),
      (error: unknown) => console.warn("[takode] Could not look up where the review's answers go:", error),
    );
    return () => {
      current = false;
    };
  }, [target.sessionId, meta.reviewId]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = useGuidedReviewState((state) => state.drafts[meta.reviewId]?.sentAt !== undefined);
  const elsewhere = resolved && resolved.sessionId !== target.sessionId ? resolved.sessionId : null;
  const elsewhereLabel = useSessionLabel(elsewhere);
  const open = () => {
    // Opens at once where the card looked earlier, and again if the review was shared since.
    if (resolved) openGuidedReview(resolved);
    resolveGuidedReview(target).then(
      (next) => {
        setFailed(false);
        setResolved(next);
        if (!resolved || next.sessionId !== resolved.sessionId || next.threadKey !== resolved.threadKey) {
          openGuidedReview(next);
        }
      },
      (error: unknown) => {
        console.warn("[takode] Could not look up where the review's answers go:", error);
        if (!resolved) setFailed(true);
      },
    );
  };
  return (
    <div className="min-w-0 rounded-lg border border-cc-border bg-cc-card px-3 py-2.5" data-testid="guided-review-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] text-cc-muted">Guided review by an agent</div>
          <div className="text-[15px] font-semibold leading-snug text-cc-fg">{meta.map.title}</div>
          <div className="mt-0.5 text-[13px] text-cc-muted">
            {meta.range.repo} · {meta.stats.files} files ·{" "}
            <span className="text-cc-success">+{meta.stats.additions}</span>{" "}
            <span className="text-cc-error">−{meta.stats.deletions}</span>
          </div>
        </div>
        {actions}
      </div>
      <div className="mt-2.5">
        <ReviewCounts meta={meta} compact />
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-3">
        {failed ? (
          <span className="min-w-0 text-[13px] text-cc-muted" role="alert">
            Couldn't open the review; try again.
          </span>
        ) : (
          (sent || elsewhereLabel) && (
            <span className="min-w-0 truncate text-[13px] text-cc-muted">
              {sent ? "Answers sent" : "Answers go"}
              {elsewhereLabel ? ` to ${elsewhereLabel}` : ""}
            </span>
          )
        )}
        <button
          type="button"
          onClick={open}
          className={`h-9 rounded-lg px-4 text-[14px] ${
            sent
              ? "border border-cc-border text-cc-fg hover:bg-cc-hover"
              : "bg-cc-primary text-white hover:bg-cc-primary-hover"
          }`}
        >
          {sent ? "Open review" : "Start the review"}
        </button>
      </div>
    </div>
  );
}
