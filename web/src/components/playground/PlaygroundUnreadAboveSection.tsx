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

/** Three answers in a feed, marked as the unread hook marks them (`data-unread-start` or `data-unread-answer`). */
function AnswerList({ marks }: { marks: Array<"read" | "unread" | "line" | "tag"> }) {
  const texts = ["The rebase is done and CI is green.", "Joined: the earlier thread's answer.", "The PR is open."];
  return (
    <div className="space-y-3 rounded-lg border border-cc-border bg-cc-bg px-4 py-3 text-sm text-cc-fg">
      {marks.map((mark, index) => (
        <p
          key={index}
          {...(mark === "line" ? { "data-unread-start": "true" } : {})}
          {...(mark === "tag" ? { "data-unread-answer": "true" } : {})}
        >
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
      description="A conversation left more than 30 minutes ago, and not one of the last three places left, opens at its latest messages. A pill at the top of the feed counts the unread answers and reports above; each tap jumps to the nearest one, skipping read messages in between. It takes the day pill's place while shown. When the unread answers are together at the bottom one New line sits above the first; when a read answer sits below an unread one (a joined thread), each unread answer gets its own New tag instead."
    >
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card label="One unread above">
          <FeedTop count={1} />
        </Card>
        <Card label="Several unread above">
          <FeedTop count={4} />
        </Card>
        <Card label="Unread answers together at the bottom: one New line">
          <AnswerList marks={["read", "line", "unread"]} />
        </Card>
        <Card label="A read answer below an unread one: a New tag on each">
          <AnswerList marks={["tag", "read", "tag"]} />
        </Card>
      </div>
    </Section>
  );
}
