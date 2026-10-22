import { create } from "zustand";
import { parseGuidedReviewDiff, type DiffFile, type GuidedReviewMeta } from "../shared/guided-review.js";
import { sendToSession } from "./ws.js";

/** A published guided review, as the feed card that opens it knows it. */
export interface GuidedReviewTarget {
  /** The report message carrying the review. */
  messageId: string;
  /** The session the review was published in; answers go back to it. */
  sessionId: string;
  threadKey: string;
  questId?: string;
  meta: GuidedReviewMeta;
}

/** The user's reaction to one stop: an answer or reaction label, and an optional note. */
export interface GuidedReviewAnswer {
  choice?: string;
  note?: string;
}

export type GuidedReviewMode = "questions" | "tour" | "diff";

interface GuidedReviewState {
  open: GuidedReviewTarget | null;
  mode: GuidedReviewMode;
  /** Answers by review id, then stop index; kept in this tab until sent. */
  answers: Record<string, Record<number, GuidedReviewAnswer>>;
  /** Reviews whose answers were sent from this tab. */
  sent: Record<string, boolean>;
}

export const useGuidedReviewState = create<GuidedReviewState>(() => ({
  open: null,
  mode: "questions",
  answers: {},
  sent: {},
}));

/** Reactions offered on stops that are not questions. */
export const GUIDED_REVIEW_REACTIONS = ["Looks right", "Question", "Change"] as const;

export function openGuidedReview(target: GuidedReviewTarget, mode?: GuidedReviewMode): void {
  const hasQuestions = target.meta.map.stops.some((stop) => stop.tier === "decide");
  useGuidedReviewState.setState({ open: target, mode: mode ?? (hasQuestions ? "questions" : "tour") });
}

export function closeGuidedReview(): void {
  useGuidedReviewState.setState({ open: null });
}

export function setGuidedReviewMode(mode: GuidedReviewMode): void {
  useGuidedReviewState.setState({ mode });
}

export function setGuidedReviewAnswer(reviewId: string, stopIndex: number, change: GuidedReviewAnswer): void {
  useGuidedReviewState.setState((state) => {
    const review = { ...state.answers[reviewId] };
    const next = { ...review[stopIndex], ...change };
    if (!next.choice && !next.note?.trim()) delete review[stopIndex];
    else review[stopIndex] = next;
    return { answers: { ...state.answers, [reviewId]: review } };
  });
}

/**
 * The one message that carries the user's answers back to the reviewing agent: each question with
 * its answer (or "not answered"), then the reactions and notes on other stops, in map order.
 */
export function formatGuidedReviewAnswers(meta: GuidedReviewMeta, answers: Record<number, GuidedReviewAnswer>): string {
  const lines = [`Guided review answers: ${meta.map.title}`];
  const note = (answer: GuidedReviewAnswer | undefined) =>
    answer?.note?.trim() ? [`   Note: ${answer.note.trim()}`] : [];
  let question = 0;
  meta.map.stops.forEach((stop, index) => {
    if (stop.tier !== "decide") return;
    question++;
    const answer = answers[index];
    lines.push("", `${question}. ${stop.question}`, `   Answer: ${answer?.choice ?? "not answered"}`, ...note(answer));
  });
  const reactions = meta.map.stops.flatMap((stop, index) => {
    const answer = answers[index];
    if (stop.tier === "decide" || !answer) return [];
    return [`- "${stop.title}": ${answer.choice ?? "note"}`, ...note(answer).map((line) => `  ${line.trim()}`)];
  });
  if (reactions.length) lines.push("", "On other stops:", ...reactions);
  return lines.join("\n");
}

/** Send the answers to the session that published the review, in the review's thread. */
export function sendGuidedReviewAnswers(target: GuidedReviewTarget): boolean {
  const answers = useGuidedReviewState.getState().answers[target.meta.reviewId] ?? {};
  const sent = sendToSession(target.sessionId, {
    type: "user_message",
    content: formatGuidedReviewAnswers(target.meta, answers),
    threadKey: target.threadKey,
    ...(target.threadKey !== "main" ? { questId: target.questId ?? target.threadKey } : {}),
    inputSource: "composer",
    session_id: target.sessionId,
  });
  if (sent) useGuidedReviewState.setState((state) => ({ sent: { ...state.sent, [target.meta.reviewId]: true } }));
  return sent;
}

const diffs = new Map<string, Promise<DiffFile[]>>();

/** The review's diff, parsed; fetched once per review and kept for this tab. */
export function loadGuidedReviewDiff(reviewId: string): Promise<DiffFile[]> {
  let pending = diffs.get(reviewId);
  if (!pending) {
    pending = fetch(`/api/guided-reviews/${encodeURIComponent(reviewId)}`).then(async (res) => {
      const body = (await res.json().catch(() => null)) as { diff?: string; error?: string } | null;
      if (!res.ok || typeof body?.diff !== "string")
        throw new Error(body?.error || `Could not load the diff (${res.status})`);
      return parseGuidedReviewDiff(body.diff);
    });
    // A failed load can be retried by opening the review again.
    pending.catch(() => diffs.delete(reviewId));
    diffs.set(reviewId, pending);
  }
  return pending;
}

/** Use a known diff for a review instead of fetching it, as the Playground's fixture review does. */
export function primeGuidedReviewDiff(reviewId: string, diff: string): void {
  diffs.set(reviewId, Promise.resolve(parseGuidedReviewDiff(diff)));
}
