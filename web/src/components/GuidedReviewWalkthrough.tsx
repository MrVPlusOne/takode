import { useEffect, useRef, useState, type CSSProperties, type TouchEvent } from "react";
import { useGuidedReviewState, type GuidedReviewTarget } from "../guided-review-state.js";
import {
  NOTE_CLASS,
  ReviewCode,
  ReviewCounts,
  ReviewEndSections,
  ReviewMarkdown,
  ReviewMessage,
  SEND_BUTTON_CLASS,
  StopAnswer,
  StopHeading,
  TIER_DOT_CLASSES,
  tourStops,
  useReviewSend,
  type IndexedStop,
  type ReviewPart,
} from "./GuidedReviewParts.js";

/**
 * A guided review as a walkthrough, one stop at a time: an overview first, then each stop with the
 * agent's explanation and the user's answer beside its code (stacked on phones), then what was checked
 * and summarized and the answers to send. Moves with Back and Next, the arrow keys, a swipe, or the
 * progress rail.
 */
export function Walkthrough({
  target,
  paused,
  onOpenFullDiff,
}: {
  target: GuidedReviewTarget;
  /** True while something covers the walkthrough (the full diff), so the arrow keys leave it alone. */
  paused: boolean;
  onOpenFullDiff: () => void;
}) {
  const { meta, sessionId } = target;
  const tour = tourStops(meta.map);
  const last = tour.length + 1;
  const review = useReviewSend(target);
  // A sent review opens on its wrap-up, where the answers that were sent are listed.
  const [step, setStep] = useState(() => (review.sent ? last : 0));
  const [direction, setDirection] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const go = (next: number) => {
    const clamped = Math.max(0, Math.min(last, next));
    if (clamped === step) return;
    setDirection(clamped > step ? 1 : -1);
    setStep(clamped);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [step]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (paused || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const element = event.target;
      if (element instanceof Element && element.closest("textarea, input, [contenteditable='true']")) return;
      if (event.key === "ArrowRight") go(step + 1);
      else if (event.key === "ArrowLeft") go(step - 1);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    // Code scrolls sideways, so a swipe that starts on it is not a page turn.
    const onCode = (event.target as HTMLElement).closest("[data-testid='guided-review-snippet'], textarea");
    swipeStart.current = touch && !onCode ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const start = swipeStart.current;
    const touch = event.changedTouches[0];
    swipeStart.current = null;
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(step + (dx < 0 ? 1 : -1));
  };

  const jumpToPart = (part: ReviewPart) => {
    const first = tour.findIndex(({ stop }) => stop.tier === part);
    go(first >= 0 ? first + 1 : last);
  };
  const current = step >= 1 && step <= tour.length ? tour[step - 1] : null;
  const animation: CSSProperties = { ["--guided-step-from" as string]: `${direction * 28}px` };

  return (
    <>
      <div className="border-b border-cc-border bg-cc-card">
        <div className="mx-auto w-full max-w-[1920px] px-4 pb-2">
          <ProgressRail
            tour={tour}
            isAnswered={review.isAnswered}
            current={current ? step - 1 : undefined}
            onSelect={(n) => go(n + 1)}
          />
          <div className="flex justify-between gap-2 text-[12px] text-cc-muted">
            <span>{current ? `Stop ${step} of ${tour.length}` : step === 0 ? "Overview" : "Wrap-up"}</span>
            <span className="max-sm:hidden">← → to move</span>
          </div>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="@container min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden"
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        data-testid="guided-review-walkthrough"
      >
        <div
          key={step}
          style={animation}
          className="mx-auto w-full max-w-[1920px] px-4 py-4 motion-safe:animate-[guidedStepIn_0.22s_ease-out]"
        >
          {step === 0 && (
            <div className="space-y-4">
              <ReviewCounts meta={meta} onJump={jumpToPart} />
              <div className={NOTE_CLASS}>
                <ReviewMarkdown text={meta.map.overview} sessionId={sessionId} />
              </div>
            </div>
          )}
          {current && <WalkthroughStop target={target} entry={current} />}
          {step === last && (
            <div className="space-y-4">
              <YourAnswers target={target} tour={tour} onSelect={(n) => go(n + 1)} />
              <ReviewMessage target={target} />
              <ReviewEndSections target={target} onOpenFullDiff={onOpenFullDiff} />
            </div>
          )}
        </div>
      </div>
      <div className="border-t border-cc-border bg-cc-bg pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex w-full max-w-[1920px] items-center gap-3 px-4 py-2.5">
          <span className="min-w-0 flex-1 text-[14px] text-cc-muted" role={review.failed ? "alert" : undefined}>
            {review.status}
          </span>
          {/* Back sits right beside Next, so clicking through takes no travel across a wide window. */}
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className="h-10 shrink-0 rounded-lg border border-cc-border px-4 text-[14px] text-cc-fg hover:bg-cc-hover"
            >
              Back
            </button>
          )}
          {step < last ? (
            <button type="button" onClick={() => go(step + 1)} className={SEND_BUTTON_CLASS}>
              {step === 0 ? "Start the walkthrough" : step === tour.length ? "Wrap up" : "Next"}
            </button>
          ) : (
            !review.sent && (
              <button type="button" disabled={!review.canSend} onClick={review.send} className={SEND_BUTTON_CLASS}>
                Send answers
              </button>
            )
          )}
        </div>
      </div>
    </>
  );
}

/**
 * One stop: when the review is at least 70rem wide, the explanation and answer stay in a narrow
 * left column while the code takes the rest; narrower, where side by side would cramp the code
 * (below roughly 80 characters), they stack as explanation, code, answer.
 */
function WalkthroughStop({ target, entry: { stop, index } }: { target: GuidedReviewTarget; entry: IndexedStop }) {
  return (
    <div
      className="flex flex-col gap-4 @min-[70rem]:grid @min-[70rem]:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] @min-[70rem]:items-start @min-[70rem]:gap-6"
      data-testid="guided-review-stop"
    >
      <div className="contents @min-[70rem]:sticky @min-[70rem]:top-0 @min-[70rem]:block @min-[70rem]:space-y-4">
        <div className="order-1">
          <StopHeading stop={stop} sessionId={target.sessionId} />
        </div>
        <div className="order-3">
          <StopAnswer target={target} stop={stop} index={index} stacked />
        </div>
      </div>
      <div className="order-2 min-w-0">
        <ReviewCode refs={stop.code} full />
      </div>
    </div>
  );
}

/** Every stop with the answer given so far; a tap goes back to it. */
function YourAnswers({
  target,
  tour,
  onSelect,
}: {
  target: GuidedReviewTarget;
  tour: IndexedStop[];
  onSelect: (n: number) => void;
}) {
  const answers = useGuidedReviewState((state) => state.drafts[target.meta.reviewId]?.answers);
  return (
    <div className="space-y-2">
      <div className="text-[13px] font-medium uppercase tracking-wide text-cc-muted">Your answers</div>
      <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
        {tour.map(({ stop, index }, n) => {
          const answer = answers?.[index]?.trim();
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSelect(n)}
              className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-cc-hover"
            >
              <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${TIER_DOT_CLASSES[stop.tier]}`} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-snug text-cc-fg">{stop.question ?? stop.title}</span>
                {answer ? (
                  <span className="block truncate text-[13px] text-cc-primary">{answer}</span>
                ) : (
                  <span className="block text-[13px] text-cc-muted">
                    {stop.question ? "Not answered yet" : "No comment"}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Where the reader is: one segment per stop in its tier's colour, faint until answered, taller for
 * the current stop. A tap moves to that stop.
 */
function ProgressRail({
  tour,
  isAnswered,
  current,
  onSelect,
}: {
  tour: IndexedStop[];
  isAnswered: (index: number) => boolean;
  current?: number;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-1" data-testid="guided-review-rail">
      {tour.map(({ stop, index }, n) => (
        <button
          key={index}
          type="button"
          aria-label={`Stop ${n + 1}: ${stop.question ?? stop.title}`}
          aria-current={current === n ? "step" : undefined}
          onClick={() => onSelect(n)}
          className="flex h-6 flex-1 items-center"
        >
          <span
            className={`block w-full rounded-full transition-all ${TIER_DOT_CLASSES[stop.tier]} ${
              current === n ? "h-2.5" : "h-1.5"
            } ${isAnswered(index) || current === n ? "" : "opacity-30"}`}
          />
        </button>
      ))}
    </div>
  );
}
