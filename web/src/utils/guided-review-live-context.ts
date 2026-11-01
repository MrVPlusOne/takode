import { useEffect, useMemo, useState } from "react";
import {
  GUIDED_REVIEW_CONTEXT_LINES,
  GUIDED_REVIEW_MORE_CONTEXT_LINES,
  guidedReviewSnippet,
  parseGuidedReviewDiff,
  type DiffFile,
  type GuidedReviewCodeRef,
} from "../../shared/guided-review.js";
import { api } from "../api.js";

/**
 * The code around a guided review stop's lines, read live from git rather than saved with the
 * review (Jiayi, Nov 1: reviews matter while the change is fresh, so git still has it). Each file is
 * read once per review, with the whole file as context, from the machine the review was published
 * on. When git can't be reached or the commits are gone, the stop shows its saved lines.
 */
export function useLiveReviewSnippet(
  sessionId: string,
  reviewId: string,
  codeRef: GuidedReviewCodeRef,
): { snippet: string; canShowMore: boolean; showMore: () => void } {
  // A reference to a whole file already shows all of its changes; only a range gets surroundings.
  const file = useLiveFileDiff(sessionId, reviewId, codeRef.lines ? codeRef.path : null);
  const [context, setContext] = useState(GUIDED_REVIEW_CONTEXT_LINES);
  return useMemo(() => {
    const saved = { snippet: codeRef.snippet!, canShowMore: false, showMore: () => {} };
    if (!file) return saved;
    const snippet = guidedReviewSnippet(file, codeRef, context);
    // A stop whose lines the live change no longer has (a rewritten range) keeps its saved lines.
    if (!snippet.includes("\n@@")) return saved;
    const more = guidedReviewSnippet(file, codeRef, context + 1);
    return {
      snippet,
      canShowMore: more.length > snippet.length,
      showMore: () => setContext((current) => current + GUIDED_REVIEW_MORE_CONTEXT_LINES),
    };
  }, [file, codeRef, context]);
}

const fileDiffs = new Map<string, Promise<DiffFile | null>>();

/** One file of a review's range with whole-file context; null while loading or when unavailable. */
function useLiveFileDiff(sessionId: string, reviewId: string, path: string | null): DiffFile | null {
  const [file, setFile] = useState<DiffFile | null>(null);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    const key = `${sessionId}\u0000${reviewId}\u0000${path}`;
    let loading = fileDiffs.get(key);
    if (!loading) {
      loading = api
        .getGuidedReviewFileDiff(sessionId, reviewId, path)
        .then((result) => (result.available ? (parseGuidedReviewDiff(result.diff)[0] ?? null) : null))
        .catch(() => null);
      fileDiffs.set(key, loading);
    }
    void loading.then((loaded) => {
      if (!cancelled) setFile(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId, reviewId, path]);
  return file;
}

/** Forgets the files read so far, for tests. */
export function resetLiveReviewContextForTest(): void {
  fileDiffs.clear();
}
