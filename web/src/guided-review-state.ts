import { create } from "zustand";
import type { GuidedReviewMeta } from "../shared/guided-review.js";
import type { GuidedReviewLineComment, SyncedGuidedReviewDraft } from "../shared/session-drafts.js";
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
  /** The comment on lines of code being written or edited in the open review. */
  lineCommentEditor: LineCommentEditor | null;
}

export interface LineCommentEditor {
  comment: GuidedReviewLineComment;
  /** Where the editor opens: beside the selected lines for a new comment, centred otherwise. */
  position?: { x: number; y: number };
}

export const useGuidedReviewState = create<GuidedReviewState>(() => ({
  open: null,
  drafts: {},
  reviewSessions: {},
  lineCommentEditor: null,
}));

/**
 * Answers suggested on stops that are not questions; they only fill the answer field. Questions
 * and requested changes are typed into that field, so they need no button of their own.
 */
export const GUIDED_REVIEW_REACTIONS = ["Looks right"] as const;

export function openGuidedReview(target: GuidedReviewTarget): void {
  useGuidedReviewState.setState({ open: target });
}

export function closeGuidedReview(): void {
  useGuidedReviewState.setState({ open: null, lineCommentEditor: null });
}

export function openLineCommentEditor(editor: LineCommentEditor | null): void {
  useGuidedReviewState.setState({ lineCommentEditor: editor });
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
  editUnsentDraft(sessionId, reviewId, (draft) => {
    const answers = { ...draft.answers };
    if (text) answers[stopIndex] = text;
    else delete answers[stopIndex];
    return { ...draft, answers };
  });
}

/** Set the message about the whole review; synced like the answers. */
export function setGuidedReviewMessage(sessionId: string, reviewId: string, text: string): void {
  editUnsentDraft(sessionId, reviewId, ({ message: _previous, ...draft }) =>
    text ? { ...draft, message: text } : draft,
  );
}

/** Add a comment on lines of code, or replace the one with the same ID; synced like the answers. */
export function saveGuidedReviewLineComment(
  sessionId: string,
  reviewId: string,
  comment: GuidedReviewLineComment,
): void {
  editUnsentDraft(sessionId, reviewId, (draft) => {
    const comments = draft.lineComments ?? [];
    const exists = comments.some((entry) => entry.id === comment.id);
    return {
      ...draft,
      lineComments: exists
        ? comments.map((entry) => (entry.id === comment.id ? comment : entry))
        : [...comments, comment],
    };
  });
}

export function removeGuidedReviewLineComment(sessionId: string, reviewId: string, commentId: string): void {
  editUnsentDraft(sessionId, reviewId, ({ lineComments, ...draft }) => {
    const rest = lineComments?.filter((entry) => entry.id !== commentId) ?? [];
    return rest.length ? { ...draft, lineComments: rest } : draft;
  });
}

/** Record that the review's answers were sent, so no browser offers to send them again. */
export function markGuidedReviewSent(sessionId: string, reviewId: string, sentAt = Date.now()): void {
  writeDraft(sessionId, reviewId, { ...(getGuidedReviewDraft(reviewId) ?? { answers: {} }), sentAt });
  notifyLocalDraftChange(sessionId, { kind: "guided-review", reviewId });
}

function editUnsentDraft(
  sessionId: string,
  reviewId: string,
  edit: (draft: SyncedGuidedReviewDraft) => SyncedGuidedReviewDraft,
): void {
  const current = getGuidedReviewDraft(reviewId);
  if (current?.sentAt !== undefined) return;
  const next = edit(current ?? { answers: {} });
  writeDraft(sessionId, reviewId, Object.keys(next.answers).length || next.message || next.lineComments ? next : null);
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
 * The one message that carries the user's answers back to the reviewing agent: the user's message
 * about the whole review when there is one, then each question with its answer (or "not
 * answered"), then the answers on other stops, in map order, then the comments on lines of code.
 */
export function formatGuidedReviewAnswers(meta: GuidedReviewMeta, draft: SyncedGuidedReviewDraft | null): string {
  const answers = draft?.answers ?? {};
  const message = draft?.message;
  const lines = [`Guided review answers: ${meta.map.title}`];
  const answerLines = (text: string) => text.trim().split("\n");
  if (message?.trim())
    lines.push("", "Message about the whole review:", ...answerLines(message).map((line) => `> ${line}`));
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
  const comments = sortLineComments(draft?.lineComments ?? []);
  // The agent must know which file version each number refers to; removed lines exist only before the change.
  if (comments.length)
    lines.push(
      "",
      "Comments on the code (lines numbered as in the file after the change, removed lines as before it):",
    );
  for (const comment of comments) {
    const stop = meta.map.stops[comment.stop];
    const fence = codeFence(comment.code);
    lines.push(
      "",
      `${comment.path}, ${lineCommentSpan(comment)}${stop ? ` (stop "${stop.title}")` : ""}:`,
      `${fence}diff`,
      comment.code,
      fence,
      `Comment: ${comment.comment.trim()}`,
    );
  }
  return lines.join("\n");
}

/**
 * The lines a comment is on, as people say it: "lines 5-7" in the file after the change,
 * "removed lines 9-10" for lines the change removed, or both.
 */
export function lineCommentSpan(comment: Pick<GuidedReviewLineComment, "lines" | "removedLines">): string {
  const span = ([first, last]: [number, number]) => (first === last ? `line ${first}` : `lines ${first}-${last}`);
  const removed = comment.removedLines && `removed ${span(comment.removedLines)}`;
  if (!comment.lines) return removed!;
  return removed ? `${span(comment.lines)} with ${removed}` : span(comment.lines);
}

/** Comments in reading order: by stop as the map lists them, then by line. */
export function sortLineComments(comments: GuidedReviewLineComment[]): GuidedReviewLineComment[] {
  const first = (comment: GuidedReviewLineComment) => comment.lines?.[0] ?? comment.removedLines?.[0] ?? 0;
  return [...comments].sort((a, b) => a.stop - b.stop || first(a) - first(b));
}

/** Whether a line of a diff is one of the comment's lines. */
export function lineCommentCovers(
  comment: Pick<GuidedReviewLineComment, "lines" | "removedLines">,
  line: { oldLineNo?: number; newLineNo?: number },
): boolean {
  const within = (range: [number, number] | undefined, n: number | undefined) =>
    range !== undefined && n !== undefined && n >= range[0] && n <= range[1];
  // A removed line has only an old number; kept lines are matched by their new one.
  if (line.newLineNo !== undefined) return within(comment.lines, line.newLineNo);
  return within(comment.removedLines, line.oldLineNo);
}

/** A Markdown fence longer than any run of backticks in the code, so the code can't close it early. */
function codeFence(code: string): string {
  const longest = Math.max(0, ...[...code.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}
