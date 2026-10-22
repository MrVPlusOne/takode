import { create } from "zustand";
import type { GuidedReviewMeta } from "../shared/guided-review.js";
import type { SyncedGuidedReviewDraft } from "../shared/session-drafts.js";
import { notifyLocalDraftChange } from "./draft-sync-bridge.js";

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

interface GuidedReviewState {
  open: GuidedReviewTarget | null;
  /**
   * Each review's answers (the text of each stop's answer field, by stop index) and when
   * they were sent. Synced through the server like other drafts, so they continue on
   * another device, survive reloads, and a sent review shows as sent everywhere.
   */
  drafts: Record<string, SyncedGuidedReviewDraft>;
  /** The session each known review belongs to, for draft sync. */
  reviewSessions: Record<string, string>;
}

export const useGuidedReviewState = create<GuidedReviewState>(() => ({
  open: null,
  drafts: {},
  reviewSessions: {},
}));

/** Answers suggested on stops that are not questions; they only fill the answer field. */
export const GUIDED_REVIEW_REACTIONS = ["Looks right", "Question", "Change"] as const;

export function openGuidedReview(target: GuidedReviewTarget): void {
  useGuidedReviewState.setState({ open: target });
}

export function closeGuidedReview(): void {
  useGuidedReviewState.setState({ open: null });
}

/** The draft of a review, for the draft sync; null when it has none. */
export function getGuidedReviewDraft(reviewId: string): SyncedGuidedReviewDraft | null {
  return useGuidedReviewState.getState().drafts[reviewId] ?? null;
}

/** Reviews of a session this tab holds drafts for. */
export function guidedReviewIdsForSession(sessionId: string): string[] {
  const { drafts, reviewSessions } = useGuidedReviewState.getState();
  return Object.keys(drafts).filter((reviewId) => reviewSessions[reviewId] === sessionId);
}

/** Set one stop's answer text; the change is synced to the server. Sent reviews no longer change. */
export function setGuidedReviewAnswer(sessionId: string, reviewId: string, stopIndex: number, text: string): void {
  const current = getGuidedReviewDraft(reviewId);
  if (current?.sentAt !== undefined) return;
  const answers = { ...current?.answers };
  if (text) answers[stopIndex] = text;
  else delete answers[stopIndex];
  writeDraft(sessionId, reviewId, Object.keys(answers).length ? { answers } : null);
  notifyLocalDraftChange(sessionId, { kind: "guided-review", reviewId });
}

/** Record that the review's answers were sent, so no browser offers to send them again. */
export function markGuidedReviewSent(sessionId: string, reviewId: string, sentAt = Date.now()): void {
  writeDraft(sessionId, reviewId, { answers: getGuidedReviewDraft(reviewId)?.answers ?? {}, sentAt });
  notifyLocalDraftChange(sessionId, { kind: "guided-review", reviewId });
}

/** Apply a draft from the server (another browser's change or a snapshot) without syncing it back. */
export function applySyncedGuidedReviewDraft(
  sessionId: string,
  reviewId: string,
  draft: SyncedGuidedReviewDraft | null,
): void {
  writeDraft(sessionId, reviewId, draft);
}

function writeDraft(sessionId: string, reviewId: string, draft: SyncedGuidedReviewDraft | null): void {
  useGuidedReviewState.setState((state) => {
    const drafts = { ...state.drafts };
    if (draft) drafts[reviewId] = draft;
    else delete drafts[reviewId];
    return { drafts, reviewSessions: { ...state.reviewSessions, [reviewId]: sessionId } };
  });
}

/**
 * The one message that carries the user's answers back to the reviewing agent: each question with
 * its answer (or "not answered"), then the answers on other stops, in map order.
 */
export function formatGuidedReviewAnswers(meta: GuidedReviewMeta, answers: Record<string, string>): string {
  const lines = [`Guided review answers: ${meta.map.title}`];
  const answerLines = (text: string) => text.trim().split("\n");
  let question = 0;
  meta.map.stops.forEach((stop, index) => {
    if (stop.tier !== "decide") return;
    question++;
    const [first, ...rest] = answerLines(answers[index] ?? "not answered");
    lines.push("", `${question}. ${stop.question}`, `   Answer: ${first}`, ...rest.map((line) => `   ${line}`));
  });
  const others = meta.map.stops.flatMap((stop, index) => {
    const answer = answers[index]?.trim();
    if (stop.tier === "decide" || !answer) return [];
    const [first, ...rest] = answerLines(answer);
    return [`- "${stop.title}": ${first}`, ...rest.map((line) => `  ${line}`)];
  });
  if (others.length) lines.push("", "On other stops:", ...others);
  return lines.join("\n");
}
