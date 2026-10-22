import type { ChatMessage } from "../../types.js";
import { primeGuidedReviewDiff } from "../../guided-review-state.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import {
  GUIDED_REVIEW_FIXTURE_DIFF,
  makeGuidedReviewReportFixture,
} from "../../../shared/test-fixtures/guided-review.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

const REPORT = makeGuidedReviewReportFixture();
const [MESSAGE] = normalizeHistoryMessageToChatMessages(REPORT, 0) as ChatMessage[];
// The fixture review is not on the server, so its diff comes from the fixture.
primeGuidedReviewDiff(REPORT.guidedReview!.reviewId, GUIDED_REVIEW_FIXTURE_DIFF);

/** A published guided review in the feed; its buttons open the review on its questions or tour. */
export function PlaygroundGuidedReviewSection() {
  return (
    <Section
      title="Guided review"
      description="A review published with takode review: the feed card, and the review it opens (questions, tour, raw diff)"
    >
      <div className="max-w-3xl">
        <Card label="Guided review card">
          <MessageBubble message={MESSAGE} sessionId={REPORT.source.sessionId} />
        </Card>
      </div>
    </Section>
  );
}
