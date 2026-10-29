import type { SessionNotification } from "../../types.js";
import { MessageFeedUnreadAbove } from "../MessageFeedUnreadAbove.js";
import { Card, Section } from "./shared.js";

const FIRST_UNREAD: SessionNotification = {
  id: "playground-unread-above",
  category: "review",
  unreadReason: "answer",
  messageId: "playground-unread-above-message",
  threadKey: "q-1",
  timestamp: Date.now() - 3_600_000,
  done: false,
};

/** The latest messages under the pill, as a conversation opened at its latest shows them. */
function FeedTop({ count }: { count: number }) {
  return (
    <div className="relative h-32 overflow-hidden rounded-lg border border-cc-border bg-cc-bg px-4 pt-10 text-sm text-cc-fg">
      <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
        <MessageFeedUnreadAbove unread={{ count, first: FIRST_UNREAD }} onJump={() => {}} />
      </div>
      <p>The latest answer starts here. The ones not read yet sit above it.</p>
    </div>
  );
}

export function PlaygroundUnreadAboveSection() {
  return (
    <Section
      title="Unread Above"
      description="A conversation left more than 30 minutes ago, and not one of the last three places left, opens at its latest messages. A pill at the top of the feed counts the unread answers and reports above; a tap jumps to the first one, where the New line is. It takes the day pill's place while shown."
    >
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card label="One unread above">
          <FeedTop count={1} />
        </Card>
        <Card label="Several unread above">
          <FeedTop count={4} />
        </Card>
      </div>
    </Section>
  );
}
