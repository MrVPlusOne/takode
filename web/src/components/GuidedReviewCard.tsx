import type { ChatMessage } from "../types.js";
import type { GuidedReviewMeta } from "../../shared/guided-review.js";
import { openGuidedReview, useGuidedReviewState, type GuidedReviewTarget } from "../guided-review-state.js";
import { CoverageBar } from "./GuidedReviewViewer.js";

/**
 * A guided review in the feed: what it covers and how many questions wait, with buttons that
 * open the review on its questions or its full tour.
 */
export function GuidedReviewCard({
  message,
  meta,
  actions,
}: {
  message: ChatMessage;
  meta: GuidedReviewMeta;
  actions?: React.ReactNode;
}) {
  const source = message.metadata!.markdownReport!;
  const sent = useGuidedReviewState((state) => !!state.sent[meta.reviewId]);
  const threadKey = message.metadata?.threadKey ?? "main";
  const target: GuidedReviewTarget = {
    messageId: message.id,
    sessionId: source.sessionId,
    threadKey,
    ...(message.metadata?.questId ? { questId: message.metadata.questId } : {}),
    meta,
  };
  const count = (tier: string) => meta.map.stops.filter((stop) => stop.tier === tier).length;
  const questions = count("decide");
  const parts = [
    questions ? `${questions} question${questions === 1 ? "" : "s"} for you` : "no questions for you",
    count("check") ? `${count("check")} to look at` : null,
    count("checked") ? `${count("checked")} checked` : null,
    meta.map.summaries.length ? `${meta.map.summaries.length} summarized` : null,
  ].filter(Boolean);
  return (
    <div className="min-w-0 rounded-lg border border-cc-border bg-cc-card px-3 py-2.5" data-testid="guided-review-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-cc-muted">Guided review</div>
          <div className="text-[15px] font-semibold leading-snug text-cc-fg">{meta.map.title}</div>
          <div className="mt-0.5 text-[12px] text-cc-muted">
            {meta.range.repo} · {meta.stats.files} files ·{" "}
            <span className="text-cc-success">+{meta.stats.additions}</span>{" "}
            <span className="text-cc-error">−{meta.stats.deletions}</span>
          </div>
        </div>
        {actions}
      </div>
      <div className="mt-2.5">
        <CoverageBar meta={meta} />
      </div>
      <div className="mt-2 text-[13px] text-cc-fg">{parts.join(" · ")}</div>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => openGuidedReview(target, "tour")}
          className="h-9 rounded-lg border border-cc-border text-[13px] text-cc-fg hover:bg-cc-hover"
        >
          Full tour
        </button>
        <button
          type="button"
          onClick={() => openGuidedReview(target)}
          className={`h-9 rounded-lg text-[13px] ${
            sent
              ? "border border-cc-border text-cc-muted hover:bg-cc-hover"
              : "bg-cc-primary text-white hover:bg-cc-primary-hover"
          }`}
        >
          {sent ? "Answers sent" : questions ? `Answer ${questions}` : "Open review"}
        </button>
      </div>
    </div>
  );
}
