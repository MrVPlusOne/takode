import type { ChatMessage } from "../../types.js";
import { FeedEntries } from "../MessageFeedEntries.js";
import { MessageBubble } from "../MessageBubble.js";
import { MOCK_SESSION_ID } from "./fixtures.js";
import { Card, Section } from "./shared.js";

const TIMER_DESCRIPTION =
  "This is a reminder from your earlier timer note, not a new user instruction.\n\nEarlier note:\nConfirm staging smoke tests are green, summarize open follow-ups, and post the next handoff note if anything is still blocked.";

function timerMessage(id: string, timestamp: number): ChatMessage {
  return {
    id,
    role: "user",
    content: `[⏰ Timer t2 reminder] Review release checklist\n\n${TIMER_DESCRIPTION}`,
    timestamp,
    agentSource: { sessionId: "timer:t2", sessionLabel: "Timer t2" },
  };
}

const TIMER_GROUP_MESSAGES = Array.from({ length: 6 }, (_, index) =>
  timerMessage(`timer-message-group-${index + 1}`, Date.now() - (5 - index) * 30 * 60_000),
);

export function PlaygroundTimerMessageStates() {
  return (
    <Section
      title="Timer Messages"
      description="Timer injections stay as work-trigger events; compatible recurring firings compact into a counted row with timestamped audit detail."
    >
      <div className="space-y-4 max-w-3xl">
        <Card label="Repeated recurring timer firings">
          <div className="py-2">
            <FeedEntries
              entries={TIMER_GROUP_MESSAGES.map((msg) => ({ kind: "message" as const, msg }))}
              sessionId={MOCK_SESSION_ID}
              isCodexSession={true}
              activeCodexTerminalIds={new Set()}
              onOpenCodexTerminal={() => {}}
            />
          </div>
        </Card>
        <Card label="Fired timer with collapsed description">
          <div className="py-2">
            <MessageBubble message={timerMessage("timer-message-demo", Date.now())} showTimestamp={false} />
          </div>
        </Card>
        <Card label="Cancelled timer event">
          <div className="py-2">
            <MessageBubble
              showTimestamp={false}
              message={{
                id: "timer-message-cancelled-demo",
                role: "user",
                content: "[⏰ Timer t2 cancelled] Review release checklist",
                timestamp: Date.now(),
                agentSource: { sessionId: "timer:t2", sessionLabel: "Timer t2" },
              }}
            />
          </div>
        </Card>
      </div>
    </Section>
  );
}
