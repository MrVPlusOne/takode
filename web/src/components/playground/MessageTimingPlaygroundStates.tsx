import { useState } from "react";
import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { InlineMessageTimingVisibilityContext } from "../MessageTimestamp.js";
import { MessageTimeLabelContext, MessageTimeLabelStore } from "../message-time-labels.js";
import { Card, Section } from "./shared.js";

const NOW = Date.now();
const MINUTE = 60_000;

const TIMED_NORMAL_MESSAGE: ChatMessage = {
  id: "playground-normal-inline-timing",
  role: "assistant",
  content: "Normal sessions keep the turn duration next to the time.",
  timestamp: NOW - 90_000,
  turnDurationMs: 42_000,
};

const TIMED_LEADER_MESSAGE: ChatMessage = {
  ...TIMED_NORMAL_MESSAGE,
  id: "playground-leader-inline-timing",
  content: "Leader feeds show the time without the duration.",
};

// A short exchange: the user sends two messages a minute apart, then two answers arrive a
// minute apart, then a later answer. Only the newer message of each close pair shows its time.
const CLUSTERED_MESSAGES: ChatMessage[] = [
  { id: "playground-time-u1", role: "user", content: "Can you check the build?", timestamp: NOW - 20 * MINUTE },
  {
    id: "playground-time-u2",
    role: "user",
    content: "Also the flaky test on main\n[transcribed]",
    timestamp: NOW - 19 * MINUTE,
  },
  {
    id: "playground-time-a1",
    role: "assistant",
    content: "Looking at both now.",
    timestamp: NOW - 18 * MINUTE,
  },
  {
    id: "playground-time-a2",
    role: "assistant",
    content: "The build is green; the flaky test failed once in the last ten runs.",
    timestamp: NOW - 17 * MINUTE,
  },
  {
    id: "playground-time-a3",
    role: "assistant",
    content:
      "Fixed the flaky test: it waited on a timer that the test never advanced. The fix is on the branch and the last twenty runs passed.",
    timestamp: NOW - 5 * MINUTE,
  },
];

export function PlaygroundMessageTimingStates() {
  const [store] = useState(() => new MessageTimeLabelStore());
  return (
    <Section
      title="Message Times"
      description="Each message shows its time in the lower-right corner: on its transcribed line, or at the end of its last text line. Within a run on one side, a message less than 3 minutes before the next shown time keeps an invisible label, so nothing shifts. Normal feeds add the turn duration; exact time stays in the options menu."
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
      <div className="mt-4 max-w-3xl">
        <Card label="Close messages share one time">
          <div data-testid="playground-clustered-message-times" className="space-y-3">
            <InlineMessageTimingVisibilityContext.Provider value={false}>
              <MessageTimeLabelContext.Provider value={store}>
                {CLUSTERED_MESSAGES.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </MessageTimeLabelContext.Provider>
            </InlineMessageTimingVisibilityContext.Provider>
          </div>
        </Card>
      </div>
    </Section>
  );
}
