import type { ChatMessage } from "../../types.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { makeGuidedReviewReportFixture } from "../../../shared/test-fixtures/guided-review.js";
import { MessageBubble } from "../MessageBubble.js";
import { Card, Section } from "./shared.js";

const REPORT = makeGuidedReviewReportFixture();
const [MESSAGE] = normalizeHistoryMessageToChatMessages(REPORT, 0) as ChatMessage[];

/** A published guided review in the feed; its buttons open the review on its questions or tour. */
export function PlaygroundGuidedReviewSection() {
  return (
    <Section
      title="Guided review"
      description="A review published with takode review: the feed card, and the tour it opens (Full diff needs a real repository)"
    >
      <div className="max-w-3xl">
        <Card label="Guided review card">
          <MessageBubble message={MESSAGE} sessionId={REPORT.source.sessionId} />
        </Card>
      </div>
    </Section>
  );
}
