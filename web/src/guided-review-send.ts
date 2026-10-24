import { flushPendingDrafts } from "./draft-sync.js";
import {
  formatGuidedReviewAnswers,
  getGuidedReviewDraft,
  markGuidedReviewSent,
  type GuidedReviewTarget,
} from "./guided-review-state.js";
import { sendToSession } from "./ws.js";

/**
 * Send the answers to the session that published the review, in the review's thread, and record
 * at once that they were sent. Returns false when they were already sent or the connection is down.
 */
export function sendGuidedReviewAnswers(target: GuidedReviewTarget): boolean {
  const { reviewId } = target.meta;
  const draft = getGuidedReviewDraft(reviewId);
  if (draft?.sentAt !== undefined) return false;
  const sent = sendToSession(target.sessionId, {
    type: "user_message",
    content: formatGuidedReviewAnswers(target.meta, draft),
    threadKey: target.threadKey,
    ...(target.threadKey !== "main" ? { questId: target.questId ?? target.threadKey } : {}),
    inputSource: "composer",
    session_id: target.sessionId,
  });
  if (!sent) return false;
  markGuidedReviewSent(target.sessionId, reviewId);
  flushPendingDrafts();
  return true;
}
