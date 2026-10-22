import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  GuidedReviewCodeRef,
  GuidedReviewMeta,
  GuidedReviewStop,
  GuidedReviewTier,
} from "../../shared/guided-review.js";
import { api, type QuestCommitLookup } from "../api.js";
import {
  GUIDED_REVIEW_REACTIONS,
  closeGuidedReview,
  setGuidedReviewAnswer,
  useGuidedReviewState,
  type GuidedReviewTarget,
} from "../guided-review-state.js";
import { sendGuidedReviewAnswers } from "../guided-review-send.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { DiffViewer } from "./DiffViewer.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { VoiceAnswerField } from "./NeedsInputAnswerField.js";
import { QuestCommitDiffView, buildCodeCommitEntries, useQuestCommitDiffState } from "./QuestCommitDiffView.js";
import { usePreviewSheetHistoryEntry } from "./quest-preview-sheet-history.js";

export const TIER_LABELS: Record<GuidedReviewTier, string> = {
  decide: "Needs your decision",
  check: "Worth a careful look",
  checked: "Checked by the agent",
};
export const TIER_DOT_CLASSES: Record<GuidedReviewTier, string> = {
  decide: "bg-cc-warning",
  check: "bg-cc-info",
  checked: "bg-cc-success",
};
const TIER_EDGE_CLASSES: Record<GuidedReviewTier, string> = {
  decide: "border-l-cc-warning",
  check: "border-l-cc-info",
  checked: "border-l-cc-success",
};
/** Text and code use the chat feed's sizes, so a review reads like the conversation around it. */
const NOTE_CLASS = "max-w-3xl leading-relaxed text-cc-fg";
const ANSWER_TEXTAREA_CLASS =
  "min-h-[36px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-lg border border-cc-border bg-cc-bg/70 px-2.5 py-1.5 text-[14px] sm:text-[15px] text-cc-fg outline-none transition-colors placeholder:text-cc-muted/60 focus:border-cc-primary";

/** Renders the open guided review; mount once at the app root. */
export function GuidedReviewViewerHost() {
  const open = useGuidedReviewState((state) => state.open);
  return open ? <GuidedReviewViewer key={open.meta.reviewId} target={open} /> : null;
}

/**
 * A guided review as one tour: the overview, then each stop with its code and, for questions and
 * careful looks, an answer field; then what the agent checked and what it summarized. The full
 * change opens from git. Wide screens show it in the secondary view; phones cover the conversation.
 */
export function GuidedReviewViewer({ target }: { target: GuidedReviewTarget }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [fullDiffOpen, setFullDiffOpen] = useState(false);
  usePreviewSheetHistoryEntry(true, sheetRef, closeGuidedReview);
  const dockTarget = useSecondaryViewTarget(true, closeGuidedReview, "wide");
  const docked = dockTarget !== null;
  const { meta, sessionId } = target;
  const { map } = meta;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Escape while typing an answer leaves the field, not the review.
      const element = event.target as HTMLElement | null;
      if (element?.closest("textarea, input, [contenteditable='true']")) return;
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

  const tour = [...indexedStops(map.stops, "decide"), ...indexedStops(map.stops, "check")];
  const checked = indexedStops(map.stops, "checked");
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
              <div className="text-[12px] text-cc-muted">Guided review</div>
              <div className="text-[16px] font-semibold leading-snug text-cc-fg">{map.title}</div>
              <RangeLine meta={meta} />
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
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1180px] space-y-4 px-4 py-4">
            <CoverageBar meta={meta} />
            <div className={NOTE_CLASS}>
              <MarkdownContent text={map.overview} sessionId={sessionId} />
            </div>
            {tour.map(({ stop, index }, n) => (
              <StopCard key={index} target={target} stop={stop} index={index} label={`Stop ${n + 1}`} />
            ))}
            {checked.length > 0 && (
              <Section
                title={`${TIER_LABELS.checked} (${checked.length})`}
                intro="Things that looked risky and were verified. Open one for the evidence and the code it is about."
              >
                <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
                  {checked.map(({ stop, index }) => (
                    <CheckedRow key={index} stop={stop} sessionId={sessionId} />
                  ))}
                </div>
              </Section>
            )}
            {map.summaries.length > 0 && (
              <Section
                title={`Summarized (${map.summaries.length})`}
                intro="Routine changes, described instead of shown. Their code is in the full diff."
              >
                {map.summaries.map((summary, index) => (
                  <div key={index} className="rounded-xl border border-cc-border bg-cc-card/40 px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[15px] font-medium text-cc-fg">{summary.title}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-cc-muted">
                        {summary.paths.length} file{summary.paths.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className={`mt-1 ${NOTE_CLASS}`}>
                      <MarkdownContent text={summary.text} sessionId={sessionId} />
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setFullDiffOpen(true)}
                  className="text-[14px] text-cc-primary hover:underline"
                >
                  Open the full diff
                </button>
              </Section>
            )}
          </div>
        </div>
        <SendBar target={target} />
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

/** How much of the change shows as code, by tier, and that every line is accounted for. */
export function CoverageBar({ meta }: { meta: GuidedReviewMeta }) {
  const { stats } = meta;
  const total = Math.max(1, stats.additions + stats.deletions);
  const width = (lines: number) => `${(100 * lines) / total}%`;
  return (
    <div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-cc-hover">
        {(["decide", "check", "checked"] as const).map((tier) => (
          <div key={tier} className={TIER_DOT_CLASSES[tier]} style={{ width: width(stats.linesByTier[tier]) }} />
        ))}
      </div>
      <div className="mt-1 text-[12px] text-cc-muted">
        All {(stats.additions + stats.deletions).toLocaleString()} changed lines accounted for:{" "}
        {stats.linesInStops.toLocaleString()} shown as code, {(total - stats.linesInStops).toLocaleString()} summarized
      </div>
    </div>
  );
}

/** A stop of the tour: why it matters, its code, and the user's answer. */
function StopCard({
  target,
  stop,
  index,
  label,
}: {
  target: GuidedReviewTarget;
  stop: GuidedReviewStop;
  index: number;
  label: string;
}) {
  const { sessionId, meta } = target;
  const draft = useGuidedReviewState((state) => state.drafts[meta.reviewId]);
  const answer = draft?.answers[index] ?? "";
  const sent = draft?.sentAt !== undefined;
  const suggestions = stop.answers ?? [...GUIDED_REVIEW_REACTIONS];
  const setAnswer = (text: string) => setGuidedReviewAnswer(sessionId, meta.reviewId, index, text);
  const focusedContext = useMemo(
    () =>
      [
        `Guided code review: ${meta.map.title}`,
        `${stop.question ? `Question: ${stop.question}` : `Stop: ${stop.title}`}`,
        `Why it matters: ${stop.note}`,
        `Suggested answers: ${suggestions.join(", ")}`,
      ].join("\n"),
    [meta.map.title, stop, suggestions],
  );
  return (
    <div
      className={`rounded-xl border border-cc-border border-l-[3px] p-3 sm:p-4 ${TIER_EDGE_CLASSES[stop.tier]}`}
      data-testid="guided-review-stop"
    >
      <div className="flex items-center justify-between gap-2 text-[12px] text-cc-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${TIER_DOT_CLASSES[stop.tier]}`} />
          {TIER_LABELS[stop.tier]}
        </span>
        <span className="tabular-nums">{label}</span>
      </div>
      <div className="mt-1 text-[16px] font-semibold leading-snug text-cc-fg">{stop.question ?? stop.title}</div>
      {stop.question && <div className="mt-0.5 text-[14px] text-cc-muted">{stop.title}</div>}
      <div className={`mt-2 ${NOTE_CLASS}`}>
        <MarkdownContent text={stop.note} sessionId={sessionId} />
      </div>
      <ReviewCode refs={stop.code} />
      <div className="mt-3 space-y-2">
        {sent ? (
          <div className="text-[14px] text-cc-fg">
            <span className="text-cc-muted">Your answer: </span>
            {answer || "not answered"}
          </div>
        ) : (
          <>
            <div className="grid gap-1.5 sm:grid-flow-col sm:auto-cols-fr">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  aria-pressed={answer === suggestion}
                  onClick={() => setAnswer(answer === suggestion ? "" : suggestion)}
                  className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-left text-[14px] leading-snug sm:text-center ${
                    answer === suggestion
                      ? "border-cc-primary bg-cc-primary/15 text-cc-fg"
                      : "border-cc-primary/20 bg-cc-primary/5 text-cc-fg hover:border-cc-primary/40 hover:bg-cc-primary/10"
                  }`}
                >
                  {suggestion}
                </button>
              ))}
            </div>
            <VoiceAnswerField
              sessionId={sessionId}
              value={answer}
              onChange={setAnswer}
              placeholder={stop.question ? "Your answer, or pick one above" : "Optional: a reaction or question"}
              ariaLabel={`Answer for ${stop.question ?? stop.title}`}
              focusedContext={focusedContext}
              voiceTarget={{ kind: "guided-review", reviewId: meta.reviewId, stopKey: String(index) }}
              resetKey={`${meta.reviewId}:${index}`}
              threadKey={target.threadKey}
              textareaClassName={ANSWER_TEXTAREA_CLASS}
              onClickStopsPropagation={false}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** A checked stop: one line that opens, like any disclosure, to its evidence and code. */
function CheckedRow({ stop, sessionId }: { stop: GuidedReviewStop; sessionId: string }) {
  const [open, setOpen] = useState(false);
  const files = [...new Set(stop.code.map((ref) => ref.path.split("/").pop()))].join(", ");
  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Chevron open={open} />
        <span className="min-w-0">
          <span className="block text-[15px] text-cc-fg">{stop.title}</span>
          <span className="block truncate text-[12px] text-cc-muted">{files}</span>
        </span>
      </button>
      {open && (
        <div className="pl-6">
          <div className={`mt-1 ${NOTE_CLASS}`}>
            <MarkdownContent text={stop.note} sessionId={sessionId} />
          </div>
          <ReviewCode refs={stop.code} />
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      className={`mt-1 h-4 w-4 shrink-0 text-cc-muted transition-transform ${open ? "rotate-90" : ""}`}
    >
      <path d="M6 3.5 10.5 8 6 12.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The code a stop points at, as saved with the review. */
function ReviewCode({ refs }: { refs: GuidedReviewCodeRef[] }) {
  if (refs.some((ref) => ref.snippet === undefined)) {
    return (
      <div className="mt-2 text-[13px] text-cc-muted">
        This review was published before reviews kept their code; use Full diff to see it.
      </div>
    );
  }
  return (
    <div className="mt-3 space-y-2">
      {refs.map((ref, index) => (
        <ReviewSnippet key={`${ref.path}:${ref.lines?.join("-") ?? "all"}:${index}`} diff={ref.snippet!} />
      ))}
    </div>
  );
}

/**
 * One snippet, shown like the chat feed's code blocks: long lines scroll sideways instead of
 * wrapping, and a tall snippet shows a scrollable window with a bar below that expands it to full height.
 */
function ReviewSnippet({ diff }: { diff: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || expanded) return;
    const measure = () => setOverflows(frame.scrollHeight > frame.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, [expanded]);
  const changed = diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length;
  const long = overflows || expanded;
  const collapse = () => {
    setExpanded(false);
    requestAnimationFrame(() => {
      const frame = frameRef.current;
      if (frame && frame.getBoundingClientRect().top < 0) frame.scrollIntoView({ block: "start" });
    });
  };
  return (
    <div className="overflow-hidden rounded-[10px] text-[12px] sm:[&_.diff-viewer]:text-[13px]">
      <div
        ref={frameRef}
        className={expanded ? "" : "max-h-[22rem] overflow-y-auto overscroll-y-contain"}
        data-testid="guided-review-snippet"
      >
        <DiffViewer unifiedDiff={diff} mode="full" showLineNumbers stickyFileHeaders />
      </div>
      {long && (
        <button
          type="button"
          onClick={() => (expanded ? collapse() : setExpanded(true))}
          aria-expanded={expanded}
          className="flex w-full items-center justify-center gap-1.5 rounded-b-[10px] border border-t-0 border-cc-border bg-cc-code-bg/80 py-1.5 text-xs text-cc-muted hover:text-cc-fg"
        >
          {expanded ? "Collapse" : `Show all ${changed} changed lines`}
        </button>
      )}
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

function SendBar({ target }: { target: GuidedReviewTarget }) {
  const { reviewId, map } = target.meta;
  const draft = useGuidedReviewState((state) => state.drafts[reviewId]);
  const [failed, setFailed] = useState(false);
  const questions = map.stops.filter((stop) => stop.tier === "decide").length;
  const answered = map.stops.filter((stop, index) => stop.tier === "decide" && draft?.answers[index]?.trim()).length;
  const anything = Object.values(draft?.answers ?? {}).some((answer) => answer.trim());
  const sent = draft?.sentAt !== undefined;
  return (
    <div className="border-t border-cc-border bg-cc-bg pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-4 py-2.5">
        <span className="min-w-0 flex-1 text-[14px] text-cc-muted" role={failed ? "alert" : undefined}>
          {sent
            ? "Answers sent"
            : failed
              ? "Not sent: the connection is down."
              : questions
                ? `${answered} of ${questions} answered`
                : "Answers are optional"}
        </span>
        {!sent && (
          <button
            type="button"
            disabled={!anything}
            onClick={() => {
              const ok = sendGuidedReviewAnswers(target);
              setFailed(!ok);
              if (ok) closeGuidedReview();
            }}
            className="h-10 shrink-0 rounded-lg bg-cc-primary px-5 text-[14px] text-white disabled:opacity-40"
          >
            Send answers
          </button>
        )}
      </div>
    </div>
  );
}

function Section({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-2">
      <div>
        <div className="text-[13px] font-medium uppercase tracking-wide text-cc-muted">{title}</div>
        <div className="text-[13px] text-cc-muted">{intro}</div>
      </div>
      {children}
    </div>
  );
}

function indexedStops(stops: GuidedReviewStop[], tier: GuidedReviewTier) {
  return stops.flatMap((stop, index) => (stop.tier === tier ? [{ stop, index }] : []));
}
