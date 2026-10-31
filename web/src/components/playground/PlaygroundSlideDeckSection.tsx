import { makeSlideDeckReportFixture } from "../../../shared/test-fixtures/slide-deck.js";
import { normalizeHistoryMessageToChatMessages } from "../../utils/history-message-normalization.js";
import { MessageBubble } from "../MessageBubble.js";

const deck = makeSlideDeckReportFixture();
const [message] = normalizeHistoryMessageToChatMessages(deck, 0);

/** A published report that is a slide deck, as the conversation shows it. */
export function PlaygroundSlideDeckSection() {
  return (
    <section id="slide-decks" className="space-y-4 scroll-mt-24" data-testid="playground-slide-decks">
      <h2 className="text-lg font-semibold">Slide decks</h2>
      <p className="text-sm text-cc-muted">
        A report whose front matter says <code>slides: true</code>: one slide at a time with its speaker notes under it,
        Present for full screen, Play to present while each slide's notes are read aloud, and a comment button for the
        whole slide.
      </p>
      <div data-message-id={deck.id} data-message-role="assistant">
        <MessageBubble message={message} sessionId={deck.source.sessionId} />
      </div>
    </section>
  );
}
