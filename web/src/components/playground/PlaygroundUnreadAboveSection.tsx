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
        <MessageFeedUnreadAbove unread={{ count, next: FIRST_UNREAD }} onJump={() => {}} />
      </div>
      <p>The latest answer starts here. The ones not read yet sit above it.</p>
    </div>
  );
}

/**
 * Three answers in a feed, marked as the unread hook marks them (`data-unread-answer`): "true" is
 * the unread dot, "read" the ring it turns into (with its pop), "seen" the settled ring, null none.
 */
function AnswerList({ marks }: { marks: Array<"true" | "read" | "seen" | null> }) {
  const texts = ["The rebase is done and CI is green.", "Joined: the earlier thread's answer.", "The PR is open."];
  return (
    <div className="space-y-3 rounded-lg border border-cc-border bg-cc-bg px-4 py-3 text-sm text-cc-fg">
      {marks.map((mark, index) => (
        <p key={index} {...(mark ? { "data-unread-answer": mark } : {})}>
          {texts[index]}
        </p>
      ))}
    </div>
  );
}

export function PlaygroundUnreadAboveSection() {
  return (
    <Section
      title="Unread Above"
      description="A conversation left more than 30 minutes ago, and not one of the last three places left, opens at its latest messages. A pill at the top of the feed counts the unread answers and reports above; each tap jumps to the nearest one, skipping read messages in between. It takes the day pill's place while shown. Each unread answer the view marks gets a blue dot in the margin on its left, which takes no room; the moment its beginning shows in the focused chat it is read and the dot pops into a hollow ring, which stays until the chat loses focus."
    >
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card label="One unread above">
          <FeedTop count={1} />
        </Card>
        <Card label="Several unread above">
          <FeedTop count={4} />
        </Card>
        <Card label="Unread answers: a dot beside each">
          <AnswerList marks={[null, "true", "true"]} />
        </Card>
        <Card label="Just read: rings (the first pops in)">
          <AnswerList marks={["read", "seen", "true"]} />
        </Card>
      </div>
    </Section>
  );
}
