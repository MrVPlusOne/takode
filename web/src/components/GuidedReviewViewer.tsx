import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  countLinesOutsideStops,
  guidedReviewSnippet,
  type DiffFile,
  type GuidedReviewCodeRef,
  type GuidedReviewMeta,
  type GuidedReviewStop,
  type GuidedReviewTier,
} from "../../shared/guided-review.js";
import {
  GUIDED_REVIEW_REACTIONS,
  closeGuidedReview,
  loadGuidedReviewDiff,
  sendGuidedReviewAnswers,
  setGuidedReviewAnswer,
  setGuidedReviewMode,
  useGuidedReviewState,
  type GuidedReviewMode,
  type GuidedReviewTarget,
} from "../guided-review-state.js";
import { SECONDARY_VIEWER_LAYER_CLASS, useSecondaryViewTarget } from "../utils/secondary-view.js";
import { DiffViewer } from "./DiffViewer.js";
import { MarkdownContent } from "./MarkdownContent.js";
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

type DiffState = { status: "loading" } | { status: "loaded"; files: DiffFile[] } | { status: "error"; message: string };

/** Renders the open guided review; mount once at the app root. */
export function GuidedReviewViewerHost() {
  const open = useGuidedReviewState((state) => state.open);
  return open ? <GuidedReviewViewer key={open.meta.reviewId} target={open} /> : null;
}

/**
 * A guided review: the questions first, then the full tour, with the raw diff one tap away.
 * Wide screens show it in the secondary view; phones cover the conversation with it.
 */
export function GuidedReviewViewer({ target }: { target: GuidedReviewTarget }) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const mode = useGuidedReviewState((state) => state.mode);
  const [diff, setDiff] = useState<DiffState>({ status: "loading" });
  usePreviewSheetHistoryEntry(true, sheetRef, closeGuidedReview);
  const dockTarget = useSecondaryViewTarget(true, closeGuidedReview, "reading");
  const docked = dockTarget !== null;
  const { meta } = target;

  useEffect(() => {
    let cancelled = false;
    loadGuidedReviewDiff(meta.reviewId).then(
      (files) => !cancelled && setDiff({ status: "loaded", files }),
      (error: unknown) =>
        !cancelled && setDiff({ status: "error", message: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [meta.reviewId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeGuidedReview();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (docked) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [docked]);

  // The body scrolls back to the top when switching views, so each starts at its beginning.
  // (Braces matter: newer browsers return a promise from scrollTo, which React would call as cleanup.)
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [mode]);

  const questions = meta.map.stops.filter((stop) => stop.tier === "decide").length;
  return createPortal(
    <div
      className={docked ? SECONDARY_VIEWER_LAYER_CLASS : "fixed inset-0 z-50 flex flex-col bg-cc-bg"}
      onClick={(event) => event.stopPropagation()}
      data-testid="guided-review-viewer"
    >
      <div
        ref={sheetRef}
        role="dialog"
        aria-label={`Guided review: ${meta.map.title}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-b border-cc-border bg-cc-card px-4 pt-3 pb-2.5">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-cc-muted">Guided review</div>
              <div className="text-[15px] font-semibold leading-snug text-cc-fg">{meta.map.title}</div>
              <RangeLine meta={meta} />
            </div>
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
          <div
            className="mt-2.5 grid grid-cols-3 overflow-hidden rounded-lg border border-cc-border text-[13px]"
            role="tablist"
          >
            <ModeButton mode="questions" current={mode} label={`Questions · ${questions}`} />
            <ModeButton mode="tour" current={mode} label={`Tour · ${meta.map.stops.length}`} />
            <ModeButton mode="diff" current={mode} label={`Diff · ${meta.stats.files}`} />
          </div>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto">
          {diff.status === "error" && (
            <div className="px-4 pt-3 text-sm text-cc-error" role="alert">
              Cannot show the code: {diff.message}
            </div>
          )}
          {mode === "questions" && <QuestionsView target={target} diff={diff} />}
          {mode === "tour" && <TourView target={target} diff={diff} />}
          {mode === "diff" && <RawDiffView diff={diff} />}
        </div>
        {mode !== "diff" && <SendBar target={target} />}
      </div>
    </div>,
    dockTarget ?? document.body,
  );
}

function RangeLine({ meta }: { meta: GuidedReviewMeta }) {
  const { range, stats } = meta;
  const commits = range.commits.length;
  return (
    <div className="mt-0.5 text-[12px] text-cc-muted">
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
      <div className="mt-1 text-[11px] text-cc-muted">
        All {(stats.additions + stats.deletions).toLocaleString()} changed lines accounted for:{" "}
        {stats.linesInStops.toLocaleString()} shown as code, {(total - stats.linesInStops).toLocaleString()} summarized
      </div>
    </div>
  );
}

function ModeButton({ mode, current, label }: { mode: GuidedReviewMode; current: GuidedReviewMode; label: string }) {
  const selected = mode === current;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={() => setGuidedReviewMode(mode)}
      className={`py-1.5 ${selected ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:text-cc-fg"}`}
    >
      {label}
    </button>
  );
}

function QuestionsView({ target, diff }: { target: GuidedReviewTarget; diff: DiffState }) {
  const { map } = target.meta;
  const decide = indexedStops(map.stops, "decide");
  const others = [...indexedStops(map.stops, "check"), ...indexedStops(map.stops, "checked")];
  return (
    <div className="mx-auto max-w-[760px] space-y-3 px-4 py-3">
      <CoverageBar meta={target.meta} />
      <p className="text-[14px] text-cc-fg">
        {decide.length
          ? `${decide.length} question${decide.length === 1 ? "" : "s"} only you can decide. Everything else is below and in the tour.`
          : "No questions need your decision. The tour has what was looked at."}
      </p>
      {decide.map(({ stop, index }, n) => (
        <StopCard
          key={index}
          target={target}
          stop={stop}
          index={index}
          label={`Question ${n + 1}`}
          diff={diff}
          codeOpen={false}
        />
      ))}
      {others.length > 0 && (
        <Section title="What was looked at">
          <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {others.map(({ stop, index }) => (
              <StopRow key={index} stop={stop} diff={diff} />
            ))}
          </div>
        </Section>
      )}
      <Summaries meta={target.meta} diff={diff} />
    </div>
  );
}

function TourView({ target, diff }: { target: GuidedReviewTarget; diff: DiffState }) {
  const { map } = target.meta;
  const tour = [...indexedStops(map.stops, "decide"), ...indexedStops(map.stops, "check")];
  const checked = indexedStops(map.stops, "checked");
  return (
    <div className="mx-auto max-w-[860px] space-y-3 px-4 py-3">
      <CoverageBar meta={target.meta} />
      <div className="text-[14px] leading-relaxed">
        <MarkdownContent text={map.overview} size="sm" sessionId={target.sessionId} />
      </div>
      {tour.map(({ stop, index }, n) => (
        <StopCard key={index} target={target} stop={stop} index={index} label={`Stop ${n + 1}`} diff={diff} codeOpen />
      ))}
      {checked.length > 0 && (
        <Section title={TIER_LABELS.checked}>
          <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {checked.map(({ stop, index }) => (
              <StopRow key={index} stop={stop} diff={diff} />
            ))}
          </div>
        </Section>
      )}
      <Summaries meta={target.meta} diff={diff} />
    </div>
  );
}

/** A question or a tour stop: why it matters, its code, and the user's answer or reaction. */
function StopCard({
  target,
  stop,
  index,
  label,
  diff,
  codeOpen,
}: {
  target: GuidedReviewTarget;
  stop: GuidedReviewStop;
  index: number;
  label: string;
  diff: DiffState;
  codeOpen: boolean;
}) {
  const reviewId = target.meta.reviewId;
  const answer = useGuidedReviewState((state) => state.answers[reviewId]?.[index]);
  const [showCode, setShowCode] = useState(codeOpen);
  const [noteOpen, setNoteOpen] = useState(!!answer?.note);
  const choices = stop.answers ?? [...GUIDED_REVIEW_REACTIONS];
  const files = [...new Set(stop.code.map((ref) => ref.path.split("/").pop()))].join(", ");
  return (
    <div className={`rounded-xl border border-cc-border border-l-[3px] p-3 ${TIER_EDGE_CLASSES[stop.tier]}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-cc-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${TIER_DOT_CLASSES[stop.tier]}`} />
          {TIER_LABELS[stop.tier]}
        </span>
        <span className="tabular-nums">{label}</span>
      </div>
      <div className="mt-1 text-[15px] font-semibold leading-snug text-cc-fg">{stop.question ?? stop.title}</div>
      {stop.question && <div className="mt-0.5 text-[13px] text-cc-muted">{stop.title}</div>}
      <div className="mt-1.5 text-[13.5px] leading-relaxed text-cc-muted-readable">
        <MarkdownContent text={stop.note} size="sm" sessionId={target.sessionId} />
      </div>
      <button
        type="button"
        className="mt-1.5 block text-left text-[12.5px] text-cc-primary"
        onClick={() => setShowCode(!showCode)}
      >
        {showCode ? "Hide the code" : `See the code (${files})`}
      </button>
      {showCode && <StopCode refs={stop.code} diff={diff} />}
      <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${choices.length}, minmax(0, 1fr))` }}>
        {choices.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={answer?.choice === choice}
            onClick={() =>
              setGuidedReviewAnswer(reviewId, index, { choice: answer?.choice === choice ? undefined : choice })
            }
            className={`min-h-9 rounded-lg border px-1.5 text-[13px] leading-tight ${
              answer?.choice === choice
                ? "border-cc-primary bg-cc-primary/15 text-cc-fg"
                : "border-cc-border text-cc-fg hover:bg-cc-hover"
            }`}
          >
            {choice}
          </button>
        ))}
      </div>
      {noteOpen ? (
        <textarea
          value={answer?.note ?? ""}
          onChange={(event) => setGuidedReviewAnswer(reviewId, index, { note: event.target.value })}
          placeholder="Add a note for the agent"
          rows={2}
          className="mt-2 w-full resize-y rounded-lg border border-cc-border bg-cc-input-bg px-2.5 py-1.5 text-[13.5px] text-cc-fg placeholder:text-cc-muted focus:outline-none focus:ring-1 focus:ring-cc-primary"
        />
      ) : (
        <button
          type="button"
          className="mt-2 text-[12.5px] text-cc-muted hover:text-cc-fg"
          onClick={() => setNoteOpen(true)}
        >
          Add a note
        </button>
      )}
    </div>
  );
}

/** A one-line stop that opens to its note and code. */
function StopRow({ stop, diff }: { stop: GuidedReviewStop; diff: DiffState }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-3 py-2.5">
      <button
        type="button"
        className="flex w-full items-start gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TIER_DOT_CLASSES[stop.tier]}`} />
        <span className="text-[13.5px] text-cc-fg">{stop.title}</span>
      </button>
      {open && (
        <div className="pl-4">
          <div className="mt-1 text-[13px] leading-relaxed text-cc-muted-readable">
            <MarkdownContent text={stop.note} size="sm" />
          </div>
          <StopCode refs={stop.code} diff={diff} />
        </div>
      )}
    </div>
  );
}

function Summaries({ meta, diff }: { meta: GuidedReviewMeta; diff: DiffState }) {
  if (!meta.map.summaries.length) return null;
  return (
    <Section title="Summarized">
      {meta.map.summaries.map((summary, index) => (
        <SummaryRow
          key={index}
          title={summary.title}
          text={summary.text}
          paths={summary.paths}
          stops={meta.map.stops}
          diff={diff}
        />
      ))}
    </Section>
  );
}

function SummaryRow({
  title,
  text,
  paths,
  stops,
  diff,
}: {
  title: string;
  text: string;
  paths: string[];
  stops: GuidedReviewStop[];
  diff: DiffState;
}) {
  const [open, setOpen] = useState(false);
  // The lines this summary stands for: its files' changed lines that no stop shows.
  const lines =
    diff.status === "loaded"
      ? diff.files
          .filter((file) => paths.includes(file.path))
          .reduce((n, file) => n + countLinesOutsideStops(stops, file), 0)
      : null;
  return (
    <div className="rounded-xl border border-cc-border bg-cc-card/40 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[14px] font-medium text-cc-fg">{title}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-cc-muted">
          {paths.length} file{paths.length === 1 ? "" : "s"}
          {lines !== null ? ` · ${lines} lines summarized` : ""}
        </span>
      </div>
      <div className="mt-1 text-[13px] leading-snug text-cc-muted-readable">
        <MarkdownContent text={text} size="sm" />
      </div>
      <button
        type="button"
        className="mt-1.5 text-[12.5px] text-cc-primary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide the code" : "Show the code"}
      </button>
      {open && <StopCode refs={paths.map((path) => ({ path }))} diff={diff} />}
    </div>
  );
}

/** The exact lines a stop points at, cut from the real diff. */
function StopCode({ refs, diff }: { refs: GuidedReviewCodeRef[]; diff: DiffState }) {
  if (diff.status === "loading") return <div className="mt-2 text-[12.5px] text-cc-muted">Loading the code…</div>;
  if (diff.status === "error") return null;
  return (
    <div className="mt-2 space-y-2">
      {refs.map((ref) => {
        const file = diff.files.find((entry) => entry.path === ref.path || entry.oldPath === ref.path);
        if (!file) return null;
        return (
          <DiffViewer
            key={`${ref.path}:${ref.lines?.join("-") ?? "all"}`}
            unifiedDiff={guidedReviewSnippet(file, ref)}
            mode="compact"
            showLineNumbers
            expandButtonLabel="Expand"
          />
        );
      })}
    </div>
  );
}

function RawDiffView({ diff }: { diff: DiffState }) {
  if (diff.status === "loading") return <div className="px-4 py-3 text-sm text-cc-muted">Loading the diff…</div>;
  if (diff.status === "error") return null;
  return (
    <DiffViewer
      unifiedDiff={diff.files.map((file) => guidedReviewSnippet(file, { path: file.path })).join("")}
      mode="full"
      stickyFileHeaders
      collapsibleFiles
    />
  );
}

function SendBar({ target }: { target: GuidedReviewTarget }) {
  const { reviewId, map } = target.meta;
  const answers = useGuidedReviewState((state) => state.answers[reviewId]);
  const sent = useGuidedReviewState((state) => !!state.sent[reviewId]);
  const [failed, setFailed] = useState(false);
  const questions = map.stops.filter((stop) => stop.tier === "decide").length;
  const answered = map.stops.filter((stop, index) => stop.tier === "decide" && answers?.[index]?.choice).length;
  const reactions = Object.keys(answers ?? {}).length;
  return (
    <div className="flex items-center gap-3 border-t border-cc-border bg-cc-bg px-4 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
      <span className="min-w-0 flex-1 text-[13px] text-cc-muted" role={failed ? "alert" : undefined}>
        {failed
          ? "Not sent: the connection is down."
          : sent
            ? "Answers sent"
            : questions
              ? `${answered} of ${questions} answered`
              : `${reactions} reaction${reactions === 1 ? "" : "s"}`}
      </span>
      <button
        type="button"
        disabled={!reactions}
        onClick={() => {
          const ok = sendGuidedReviewAnswers(target);
          setFailed(!ok);
          if (ok) closeGuidedReview();
        }}
        className="h-10 shrink-0 rounded-lg bg-cc-primary px-5 text-[14px] text-white disabled:opacity-40"
      >
        {sent ? "Send again" : "Send answers"}
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 pt-2">
      <div className="text-[12px] font-medium uppercase tracking-wide text-cc-muted">{title}</div>
      {children}
    </div>
  );
}

function indexedStops(stops: GuidedReviewStop[], tier: GuidedReviewTier) {
  return stops.flatMap((stop, index) => (stop.tier === tier ? [{ stop, index }] : []));
}
