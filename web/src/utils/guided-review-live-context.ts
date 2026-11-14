import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GUIDED_REVIEW_CONTEXT_LINES,
  GUIDED_REVIEW_MORE_CONTEXT_LINES,
  guidedReviewContextLeft,
  guidedReviewSnippet,
  parseGuidedReviewDiff,
  type DiffFile,
  type GuidedReviewCodeRef,
  type GuidedReviewContext,
} from "../../shared/guided-review.js";
import { api } from "../api.js";

/**
 * The code around a guided review stop's lines, read live from git rather than saved with the
 * review (Jiayi, Nov 1: reviews matter while the change is fresh, so git still has it). Each file is
 * read once per review, with the whole file as context, from the machine the review was published
 * on. When it can't be read, the stop shows its saved lines and `unavailable` says why, so the stop
 * can say so; `retry` reads it again on demand (Jiayi chose a Retry button over retrying by itself).
 */
export function useLiveReviewSnippet(
  sessionId: string,
  reviewId: string,
  codeRef: GuidedReviewCodeRef,
): {
  snippet: string;
  /** Lines the next "Show more" on each side adds: up to 30, and 0 when nothing is left there. */
  more: GuidedReviewContext;
  showMore: (side: keyof GuidedReviewContext) => void;
  /** Why the code around the stop isn't shown: git or the commits can't be reached, or it is too large. */
  unavailable: LiveContextFailure | null;
  retry: () => void;
} {
  // A reference to a whole file already shows all of its changes; only a range gets surroundings.
  const { result, retry } = useLiveFileDiff(sessionId, reviewId, codeRef.lines ? codeRef.path : null);
  const [context, setContext] = useState<GuidedReviewContext>(INITIAL_CONTEXT);
  return useMemo(() => {
    const saved = { snippet: codeRef.snippet!, more: NO_MORE, showMore: () => {}, retry };
    if (!result) return { ...saved, unavailable: null };
    if (!("file" in result)) return { ...saved, unavailable: result.failure };
    const snippet = guidedReviewSnippet(result.file, codeRef, context);
    // A stop whose lines the live change no longer has (a rewritten range) keeps its saved lines.
    if (!snippet.includes("\n@@")) return { ...saved, unavailable: null };
    const left = guidedReviewContextLeft(result.file, codeRef, context);
    return {
      snippet,
      more: {
        above: Math.min(GUIDED_REVIEW_MORE_CONTEXT_LINES, left.above),
        below: Math.min(GUIDED_REVIEW_MORE_CONTEXT_LINES, left.below),
      },
      showMore: (side: keyof GuidedReviewContext) =>
        setContext((current) => ({ ...current, [side]: current[side] + GUIDED_REVIEW_MORE_CONTEXT_LINES })),
      unavailable: null,
      retry,
    };
  }, [result, codeRef, context, retry]);
}

const INITIAL_CONTEXT: GuidedReviewContext = { above: GUIDED_REVIEW_CONTEXT_LINES, below: GUIDED_REVIEW_CONTEXT_LINES };
const NO_MORE: GuidedReviewContext = { above: 0, below: 0 };

/** Why the code around a stop can't be shown. */
export type LiveContextFailure = "unreachable" | "too_large";

type LiveFileResult = { file: DiffFile } | { failure: LiveContextFailure };

const fileDiffs = new Map<string, Promise<LiveFileResult>>();

/**
 * One file of a review's range with whole-file context: null while loading or for no path. A
 * failure stays until `retry`, which forgets it and reads again.
 */
function useLiveFileDiff(
  sessionId: string,
  reviewId: string,
  path: string | null,
): { result: LiveFileResult | null; retry: () => void } {
  const [result, setResult] = useState<LiveFileResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${sessionId}\u0000${reviewId}\u0000${path}`;
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let loading = fileDiffs.get(key);
    if (!loading) {
      loading = api
        .getGuidedReviewFileDiff(sessionId, reviewId, path)
        .then((response): LiveFileResult => {
          const file = response.available ? parseGuidedReviewDiff(response.diff)[0] : undefined;
          if (file) return { file };
          return { failure: !response.available && response.reason === "too_large" ? "too_large" : "unreachable" };
        })
        .catch((): LiveFileResult => ({ failure: "unreachable" }));
      fileDiffs.set(key, loading);
    }
    void loading.then((loaded) => {
      if (!cancelled) setResult(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reviewId, path, key, attempt]);
  const retry = useCallback(() => {
    fileDiffs.delete(key);
    setResult(null);
    setAttempt((current) => current + 1);
  }, [key]);
  return { result, retry };
}

/** Forgets the files read so far, for tests. */
export function resetLiveReviewContextForTest(): void {
  fileDiffs.clear();
}
