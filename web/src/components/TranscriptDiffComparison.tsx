import { useMemo } from "react";
import * as Diff from "diff";

const CHARACTER_DIFF_OPTIONS = { timeout: 30, maxEditLength: 2_000 } as const;
const WORD_DIFF_OPTIONS = { timeout: 30, maxEditLength: 500 } as const;

export interface TranscriptDiffSpan {
  value: string;
  changed: boolean;
}

export interface TranscriptDiffResult {
  original: TranscriptDiffSpan[];
  replay: TranscriptDiffSpan[];
  mode: "identical" | "character" | "word" | "unavailable" | "plain";
}

function spansForSide(changes: Diff.Change[], side: "original" | "replay"): TranscriptDiffSpan[] {
  return changes
    .filter((part) => (side === "original" ? !part.added : !part.removed))
    .map((part) => ({
      value: part.value,
      changed: side === "original" ? part.removed === true : part.added === true,
    }));
}

export function buildTranscriptDiff(originalText: string, replayText: string, highlight = true): TranscriptDiffResult {
  if (!highlight) {
    return {
      original: [{ value: originalText, changed: false }],
      replay: [{ value: replayText, changed: false }],
      mode: "plain",
    };
  }
  if (originalText === replayText) {
    return {
      original: [{ value: originalText, changed: false }],
      replay: [{ value: replayText, changed: false }],
      mode: "identical",
    };
  }

  const characterChanges = Diff.diffChars(originalText, replayText, CHARACTER_DIFF_OPTIONS);
  if (characterChanges) {
    return {
      original: spansForSide(characterChanges, "original"),
      replay: spansForSide(characterChanges, "replay"),
      mode: "character",
    };
  }

  const wordChanges = Diff.diffWordsWithSpace(originalText, replayText, WORD_DIFF_OPTIONS);
  if (wordChanges) {
    return {
      original: spansForSide(wordChanges, "original"),
      replay: spansForSide(wordChanges, "replay"),
      mode: "word",
    };
  }

  return {
    original: [{ value: originalText, changed: false }],
    replay: [{ value: replayText, changed: false }],
    mode: "unavailable",
  };
}

function TranscriptSide({
  label,
  side,
  spans,
}: {
  label: string;
  side: "original" | "replay";
  spans: TranscriptDiffSpan[];
}) {
  const hasText = spans.some((span) => span.value.length > 0);
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-cc-muted mb-1">{label}</div>
      <pre
        className="p-2 text-xs font-mono bg-cc-input-bg border border-cc-border rounded text-cc-fg whitespace-pre-wrap break-words max-h-[260px] overflow-y-auto"
        data-transcript-diff-side={side}
      >
        {!hasText
          ? "(empty)"
          : spans.map((span, index) =>
              span.changed ? (
                <mark
                  key={`${side}-${index}`}
                  className={`${side === "original" ? "bg-cc-error/25" : "bg-cc-success/25"} text-inherit rounded-sm box-decoration-clone`}
                  data-transcript-diff-kind={side === "original" ? "removed" : "added"}
                  aria-label={`${side === "original" ? "Changed original text" : "Changed replay text"}: ${span.value}`}
                >
                  {span.value}
                </mark>
              ) : (
                <span key={`${side}-${index}`}>{span.value}</span>
              ),
            )}
      </pre>
    </div>
  );
}

export function TranscriptDiffComparison({
  originalLabel,
  replayLabel,
  originalText,
  replayText,
  highlight = true,
}: {
  originalLabel: string;
  replayLabel: string;
  originalText: string;
  replayText: string;
  highlight?: boolean;
}) {
  const result = useMemo(
    () => buildTranscriptDiff(originalText, replayText, highlight),
    [highlight, originalText, replayText],
  );

  return (
    <div className="space-y-1">
      {result.mode === "identical" && <p className="text-[11px] text-cc-muted">Identical output</p>}
      {result.mode === "character" && <p className="sr-only">Character differences are highlighted.</p>}
      {result.mode === "word" && (
        <p className="text-[11px] text-cc-muted">Large comparison uses word-level highlights.</p>
      )}
      {result.mode === "unavailable" && (
        <p className="text-[11px] text-cc-warning">Difference is too large to highlight safely.</p>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <TranscriptSide label={originalLabel} side="original" spans={result.original} />
        <TranscriptSide label={replayLabel} side="replay" spans={result.replay} />
      </div>
    </div>
  );
}
