import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GUIDED_REVIEW_TIERS,
  guidedReviewSummaryFiles,
  type GuidedReviewCodeRef,
  type GuidedReviewMap,
  type GuidedReviewMeta,
  type GuidedReviewStop,
  type GuidedReviewSummary,
  type GuidedReviewTier,
} from "../../shared/guided-review.js";
import {
  GUIDED_REVIEW_REACTIONS,
  closeGuidedReview,
  setGuidedReviewAnswer,
  setGuidedReviewMessage,
  useGuidedReviewState,
  type GuidedReviewTarget,
} from "../guided-review-state.js";
import { sendGuidedReviewAnswers } from "../guided-review-send.js";
import { DiffViewer } from "./DiffViewer.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { VoiceAnswerField } from "./NeedsInputAnswerField.js";

/** The pieces a guided review is drawn from, shared by the feed card and the viewer's layouts. */

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
/** Text and code use the chat feed's sizes, so a review reads like the conversation around it. */
export const NOTE_CLASS = "max-w-3xl leading-relaxed text-cc-fg";
const ANSWER_TEXTAREA_CLASS =
  "min-h-[36px] min-w-0 flex-1 resize-none overflow-y-hidden rounded-lg border border-cc-border bg-cc-bg/70 px-2.5 py-1.5 text-[14px] sm:text-[15px] text-cc-fg outline-none transition-colors placeholder:text-cc-muted/60 focus:border-cc-primary";

/** The parts of a review: its stop tiers, then the summaries. */
export type ReviewPart = GuidedReviewTier | "summaries";

export interface IndexedStop {
  stop: GuidedReviewStop;
  /** Position in the map's stops, which answers are keyed by. */
  index: number;
}

/** The stops the user walks through: the decisions first, then the careful looks. */
export function tourStops(map: GuidedReviewMap): IndexedStop[] {
  return [...indexedStops(map.stops, "decide"), ...indexedStops(map.stops, "check")];
}

export function indexedStops(stops: GuidedReviewStop[], tier: GuidedReviewTier): IndexedStop[] {
  return stops.flatMap((stop, index) => (stop.tier === tier ? [{ stop, index }] : []));
}

const PART_LABELS: Record<ReviewPart, [one: string, many: string]> = {
  decide: ["decision for you", "decisions for you"],
  check: ["to look at", "to look at"],
  checked: ["checked by the agent", "checked by the agent"],
  summaries: ["summarized", "summarized"],
};
const SUMMARY_DOT_CLASS = "bg-cc-muted/40";

/**
 * What the review asks of the reader, stated so someone new to Takode gets it from a screenshot:
 * the agent read every changed line, then four equal tiles count the decisions, the careful looks,
 * what it checked and what it summarized, each with its share of the lines. In the review a tile
 * jumps to its part.
 */
export function ReviewCounts({
  meta,
  onJump,
  compact = false,
}: {
  meta: GuidedReviewMeta;
  onJump?: (part: ReviewPart) => void;
  compact?: boolean;
}) {
  const { stats, map } = meta;
  const changed = stats.additions + stats.deletions;
  const parts = [
    ...GUIDED_REVIEW_TIERS.map((tier) => ({
      part: tier as ReviewPart,
      count: map.stops.filter((stop) => stop.tier === tier).length,
      lines: stats.linesByTier[tier],
      dot: TIER_DOT_CLASSES[tier],
    })),
    {
      part: "summaries" as const,
      count: map.summaries.length,
      lines: changed - stats.linesInStops,
      dot: SUMMARY_DOT_CLASS,
    },
  ];
  return (
    <div>
      <div className="text-[13px] text-cc-muted">
        An agent read all <span className="font-semibold text-cc-fg">{changed.toLocaleString()}</span> changed line
        {changed === 1 ? "" : "s"} and sorted them by what they need from you
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {parts.map(({ part, count, lines, dot }) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span
                  className={`${compact ? "text-[20px]" : "text-[24px]"} font-semibold leading-none tabular-nums text-cc-fg`}
                >
                  {count}
                </span>
              </span>
              <span className="mt-1 block text-[13px] leading-snug text-cc-fg">
                {PART_LABELS[part][count === 1 ? 0 : 1]}
              </span>
              <span className="block text-[12px] tabular-nums text-cc-muted">
                {lines.toLocaleString()} line{lines === 1 ? "" : "s"}
              </span>
            </>
          );
          const tileClass = "rounded-lg border border-cc-border bg-cc-bg/40 px-2.5 py-2 text-left";
          return onJump && count > 0 ? (
            <button
              key={part}
              type="button"
              className={`${tileClass} hover:bg-cc-hover`}
              onClick={() => onJump(part)}
              data-testid="guided-review-count"
            >
              {body}
            </button>
          ) : (
            <div key={part} className={tileClass} data-testid="guided-review-count">
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Review text (the overview, notes, summaries and sent answers), rendered as chat renders it so
 * Takode links work. A link to a session or message closes the review, which would otherwise
 * cover the conversation the link opened.
 */
export function ReviewMarkdown({ text, sessionId }: { text: string; sessionId: string }) {
  return <MarkdownContent text={text} sessionId={sessionId} onSessionNavigate={closeGuidedReview} />;
}

/** A stop's kind, its question or title, and the agent's note on why it matters. */
export function StopHeading({ stop, sessionId }: { stop: GuidedReviewStop; sessionId: string }) {
  return (
    <>
      <div className="flex items-center gap-1.5 text-[12px] text-cc-muted">
        <span className={`h-2 w-2 rounded-full ${TIER_DOT_CLASSES[stop.tier]}`} />
        {TIER_LABELS[stop.tier]}
      </div>
      <div className="mt-1 text-[16px] font-semibold leading-snug text-cc-fg">{stop.question ?? stop.title}</div>
      {stop.question && <div className="mt-0.5 text-[14px] text-cc-muted">{stop.title}</div>}
      <div className={`mt-2 ${NOTE_CLASS}`}>
        <ReviewMarkdown text={stop.note} sessionId={sessionId} />
      </div>
    </>
  );
}

/**
 * The user's answer to a stop: suggestion buttons that fill one field, which also takes typing and
 * voice. Once the review is sent it shows the answer instead.
 */
export function StopAnswer({
  target,
  stop,
  index,
  stacked = false,
  placeholder,
}: {
  target: GuidedReviewTarget;
  stop: GuidedReviewStop;
  index: number;
  /** Suggestions one per row at every width, for narrow columns. */
  stacked?: boolean;
  placeholder?: string;
}) {
  const { sessionId, meta } = target;
  const draft = useGuidedReviewState((state) => state.drafts[meta.reviewId]);
  const answer = draft?.answers[index] ?? "";
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
  if (draft?.sentAt !== undefined) {
    return (
      <div className="text-[14px] text-cc-fg">
        <div className="text-cc-muted">Your answer</div>
        {answer ? <ReviewMarkdown text={answer} sessionId={sessionId} /> : "Not answered"}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className={`grid gap-1.5 ${stacked ? "" : "sm:grid-flow-col sm:auto-cols-fr"}`}>
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            aria-pressed={answer === suggestion}
            onClick={() => setAnswer(answer === suggestion ? "" : suggestion)}
            className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-left text-[14px] leading-snug ${stacked ? "" : "sm:text-center"} ${
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
        placeholder={
          placeholder ??
          (stop.question ? "Your answer, or pick one above" : "Optional: a question or a change you want")
        }
        ariaLabel={`Answer for ${stop.question ?? stop.title}`}
        focusedContext={focusedContext}
        voiceTarget={{ kind: "guided-review", reviewId: meta.reviewId, stopKey: String(index) }}
        resetKey={`${meta.reviewId}:${index}`}
        threadKey={target.threadKey}
        textareaClassName={ANSWER_TEXTAREA_CLASS}
        onClickStopsPropagation={false}
      />
    </div>
  );
}

/** A message usually runs longer than an answer, so its field starts taller. */
const MESSAGE_TEXTAREA_CLASS = ANSWER_TEXTAREA_CLASS.replace("min-h-[36px]", "min-h-[72px]");

/**
 * The user's message about the review as a whole, sent with the answers: anything the stops did
 * not cover, including what should happen next. Once sent it shows the message instead.
 */
export function ReviewMessage({ target }: { target: GuidedReviewTarget }) {
  const { sessionId, meta } = target;
  const draft = useGuidedReviewState((state) => state.drafts[meta.reviewId]);
  const message = draft?.message ?? "";
  const focusedContext = useMemo(
    () =>
      [
        `Guided code review: ${meta.map.title}`,
        "The user's message about the whole review, such as what should happen next.",
      ].join("\n"),
    [meta.map.title],
  );
  return (
    <div className="space-y-2" data-testid="guided-review-message">
      <div>
        <div className="text-[13px] font-medium uppercase tracking-wide text-cc-muted">Your message</div>
        <div className="text-[13px] text-cc-muted">
          Anything about the review as a whole, including what should happen next. Optional.
        </div>
      </div>
      {draft?.sentAt !== undefined ? (
        <div className="whitespace-pre-wrap text-[14px] text-cc-fg">{message || "No message"}</div>
      ) : (
        <VoiceAnswerField
          sessionId={sessionId}
          value={message}
          onChange={(text) => setGuidedReviewMessage(sessionId, meta.reviewId, text)}
          placeholder="Your message to the agent"
          ariaLabel="Message about the whole review"
          focusedContext={focusedContext}
          voiceTarget={{ kind: "guided-review", reviewId: meta.reviewId, stopKey: "message" }}
          resetKey={`${meta.reviewId}:message`}
          threadKey={target.threadKey}
          textareaClassName={MESSAGE_TEXTAREA_CLASS}
          onClickStopsPropagation={false}
        />
      )}
    </div>
  );
}

/** Answers so far and sending them: one message to the publishing session, once. */
export function useReviewSend(target: GuidedReviewTarget) {
  const { reviewId, map } = target.meta;
  const draft = useGuidedReviewState((state) => state.drafts[reviewId]);
  const [failed, setFailed] = useState(false);
  const questions = map.stops.filter((stop) => stop.tier === "decide").length;
  const answered = map.stops.filter((stop, index) => stop.tier === "decide" && draft?.answers[index]?.trim()).length;
  const status =
    draft?.sentAt !== undefined
      ? "Answers sent"
      : failed
        ? "Not sent: the connection is down."
        : questions
          ? `${answered} of ${questions} answered`
          : "Answers are optional";
  return {
    status,
    failed,
    sent: draft?.sentAt !== undefined,
    canSend: Boolean(draft?.message?.trim()) || Object.values(draft?.answers ?? {}).some((answer) => answer.trim()),
    isAnswered: (index: number) => Boolean(draft?.answers[index]?.trim()),
    send: () => {
      const ok = sendGuidedReviewAnswers(target);
      setFailed(!ok);
      if (ok) closeGuidedReview();
    },
  };
}

export const SEND_BUTTON_CLASS =
  "h-10 shrink-0 rounded-lg bg-cc-primary px-5 text-[14px] text-white disabled:opacity-40";

/** What the agent checked and what it summarized, after the stops. */
export function ReviewEndSections({
  target,
  onOpenFullDiff,
}: {
  target: GuidedReviewTarget;
  onOpenFullDiff: () => void;
}) {
  const { map } = target.meta;
  const checked = indexedStops(map.stops, "checked");
  return (
    <>
      {checked.length > 0 && (
        <Section
          part="checked"
          title={`${TIER_LABELS.checked} (${checked.length})`}
          intro="Things that looked risky and were verified. Open one for the evidence and the code it is about."
        >
          <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {checked.map(({ stop, index }) => (
              <CheckedRow key={index} stop={stop} sessionId={target.sessionId} />
            ))}
          </div>
        </Section>
      )}
      {map.summaries.length > 0 && (
        <Section
          part="summaries"
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
                <ReviewMarkdown text={summary.text} sessionId={target.sessionId} />
              </div>
              <SummaryFiles summary={summary} />
            </div>
          ))}
          <button type="button" onClick={onOpenFullDiff} className="text-[14px] text-cc-primary hover:underline">
            Open the full diff
          </button>
        </Section>
      )}
    </>
  );
}

/**
 * The files a summary covers, each with the lines it summarizes, counted from the diff when the
 * review was published. Reviews published before that list only the paths.
 */
function SummaryFiles({ summary }: { summary: GuidedReviewSummary }) {
  return (
    <ul
      className="mt-2 max-w-3xl border-t border-cc-border/60 pt-1.5 text-[13px]"
      aria-label={`Files in ${summary.title}`}
    >
      {guidedReviewSummaryFiles(summary).map((file) => {
        const slash = file.path.lastIndexOf("/");
        return (
          <li key={file.path} className="flex items-baseline gap-2 py-0.5">
            <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <span className="text-cc-fg">{file.path.slice(slash + 1)}</span>
              {slash > 0 && <span className="ml-1.5 text-cc-muted">{file.path.slice(0, slash)}</span>}
            </span>
            {file.alsoInStops && <span className="shrink-0 text-[12px] text-cc-muted">also in stops</span>}
            {file.additions !== undefined && (
              <span className="shrink-0 tabular-nums">
                <span className="text-cc-success">+{file.additions}</span>{" "}
                <span className="text-cc-error">−{file.deletions}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
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
            <ReviewMarkdown text={stop.note} sessionId={sessionId} />
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

function Section({
  part,
  title,
  intro,
  children,
}: {
  part: ReviewPart;
  title: string;
  intro: string;
  children: ReactNode;
}) {
  return (
    <div className="scroll-mt-4 space-y-2 pt-2" data-review-part={part}>
      <div>
        <div className="text-[13px] font-medium uppercase tracking-wide text-cc-muted">{title}</div>
        <div className="text-[13px] text-cc-muted">{intro}</div>
      </div>
      {children}
    </div>
  );
}

/** The code a stop points at, as saved with the review. */
export function ReviewCode({ refs, full = false }: { refs: GuidedReviewCodeRef[]; full?: boolean }) {
  if (refs.some((ref) => ref.snippet === undefined)) {
    return (
      <div className="mt-2 text-[13px] text-cc-muted">
        This review was published before reviews kept their code; use Full diff to see it.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {refs.map((ref, index) => (
        <ReviewSnippet key={`${ref.path}:${ref.lines?.join("-") ?? "all"}:${index}`} diff={ref.snippet!} full={full} />
      ))}
    </div>
  );
}

/**
 * One snippet, shown like the chat feed's code blocks: long lines scroll sideways instead of
 * wrapping, and a tall snippet shows a scrollable window with a bar below that expands it to full
 * height. `full` shows all of it from the start.
 */
function ReviewSnippet({ diff, full }: { diff: string; full: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const open = full || expanded;
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || open) return;
    const measure = () => setOverflows(frame.scrollHeight > frame.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    return () => observer?.disconnect();
  }, [open]);
  const changed = changedLineCount(diff);
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
        className={open ? "" : "max-h-[22rem] overflow-y-auto overscroll-y-contain"}
        data-testid="guided-review-snippet"
      >
        <DiffViewer unifiedDiff={diff} mode="full" showLineNumbers stickyFileHeaders />
      </div>
      {!full && (overflows || expanded) && (
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

function changedLineCount(diff: string): number {
  return diff.split("\n").filter((line) => /^[+-](?![+-]{2} )/.test(line)).length;
}
