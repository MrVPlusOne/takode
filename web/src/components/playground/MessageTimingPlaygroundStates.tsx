import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { InlineMessageTimingVisibilityContext } from "../MessageTimestamp.js";
import { Card, Section } from "./shared.js";

const TIMED_NORMAL_MESSAGE: ChatMessage = {
  id: "playground-normal-inline-timing",
  role: "assistant",
  content: "Normal sessions keep the compact inline completion time and duration.",
  timestamp: Date.now() - 90_000,
  turnDurationMs: 42_000,
};

const TIMED_LEADER_MESSAGE: ChatMessage = {
  ...TIMED_NORMAL_MESSAGE,
  id: "playground-leader-inline-timing",
  content: "Leader feeds remove inline timing while keeping it in message options.",
};

export function PlaygroundMessageTimingStates() {
  return (
    <Section
      title="Message Timing by Session Role"
      description="Normal feeds retain inline time and duration. Leader feeds remove that repeated inline detail, while both keep exact stored time in the message-options affordance."
    >
      <div className="grid max-w-3xl gap-4 md:grid-cols-2">
        <Card label="Normal session">
          <div data-testid="playground-normal-inline-timing">
            <InlineMessageTimingVisibilityContext.Provider value>
              <MessageBubble message={TIMED_NORMAL_MESSAGE} />
            </InlineMessageTimingVisibilityContext.Provider>
          </div>
        </Card>
        <Card label="Leader session">
          <div data-testid="playground-leader-inline-timing">
            <InlineMessageTimingVisibilityContext.Provider value={false}>
              <MessageBubble message={TIMED_LEADER_MESSAGE} />
            </InlineMessageTimingVisibilityContext.Provider>
          </div>
        </Card>
      </div>
    </Section>
  );
}
