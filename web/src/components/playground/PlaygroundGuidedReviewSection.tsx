import { useEffect } from "react";
import type { ChatMessage } from "../../types.js";
import { applySyncedGuidedReviewDraft, getGuidedReviewDraft } from "../../guided-review-state.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { makeGuidedReviewReportFixture } from "../../../shared/test-fixtures/guided-review.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

const REPORT = makeGuidedReviewReportFixture();
const [MESSAGE] = normalizeHistoryMessageToChatMessages(REPORT, 0) as ChatMessage[];

/** A comment already left on the second stop's code, so the walkthrough shows marked lines. */
const LINE_COMMENT = {
  id: "playground-line-comment",
  stop: 1,
  path: "src/client.ts",
  lines: [6, 7] as [number, number],
  code: "+  // Cached for a day: profiles rarely change.\n+  profileCache.set(id, profile, { ttlMs: 86_400_000 });",
  comment: "Clear this entry when the profile is edited.",
};

/** A published guided review in the feed; its button opens the walkthrough. */
export function PlaygroundGuidedReviewSection() {
  useEffect(() => {
    const { reviewId } = REPORT.guidedReview!;
    if (!getGuidedReviewDraft(reviewId))
      applySyncedGuidedReviewDraft(REPORT.source.sessionId, reviewId, {
        answers: {},
        lineComments: [LINE_COMMENT],
      });
  }, []);
  return (
    <Section
      title="Guided review"
      description="A review published with takode review: the feed card, and the walkthrough it opens (Full diff needs a real repository). Its second stop starts with a comment on two lines of code; select lines in any stop's code to comment on them."
    >
      <div className="max-w-3xl">
        <Card label="Guided review card">
          <MessageBubble message={MESSAGE} sessionId={REPORT.source.sessionId} />
        </Card>
      </div>
    </Section>
  );
}
