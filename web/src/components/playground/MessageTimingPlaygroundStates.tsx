import { useRef, useState } from "react";
import type { ChatMessage } from "../../types.js";
import { MessageBubble } from "../MessageBubble.js";
import { MessageFeedDayPill } from "../MessageFeedDayPill.js";
import { InlineMessageTimingVisibilityContext } from "../MessageTimestamp.js";
import { MinuteBoundaryTimestamp } from "../MinuteBoundaryTimestamp.js";
import { formatFeedDayLabel } from "../message-feed-utils.js";
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

const DAY = 24 * 60 * MINUTE;

function daysBack(days: number, hour: number, minute: number): number {
  const date = new Date(NOW - days * DAY);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

// Older messages carry their day: yesterday, a weekday within the past week, then the date.
const OLDER_MESSAGES: ChatMessage[] = [
  { id: "playground-age-u1", role: "user", content: "Last year's question", timestamp: daysBack(400, 9, 5) },
  {
    id: "playground-age-a1",
    role: "assistant",
    content: "A reply from ten days ago.",
    timestamp: daysBack(10, 16, 40),
  },
  { id: "playground-age-u2", role: "user", content: "Is the import done?", timestamp: daysBack(3, 14, 10) },
  { id: "playground-age-a2", role: "assistant", content: "Yes, all 12 files loaded.", timestamp: daysBack(1, 14, 13) },
];

// Two days of conversation in a short scrolling feed: the pill names the day at the top.
const DAY_PILL_DAYS = [3, 1].map((days) => ({
  days,
  messages: [0, 1, 2].map(
    (index): ChatMessage => ({
      id: `playground-day-pill-${days}-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: index % 2 ? "Here is what I found in the logs." : "What does the log say about the retry?",
      timestamp: daysBack(days, 10 + index * 2, 15),
    }),
  ),
}));

function DayPillFeed() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  return (
    <div className="relative h-72 overflow-hidden rounded-lg border border-cc-border">
      <div ref={containerRef} className="h-full overflow-y-auto px-3 py-3">
        <div ref={contentRootRef} className="space-y-3">
          {DAY_PILL_DAYS.map(({ days, messages }) => (
            <div key={days} className="space-y-3">
              <MinuteBoundaryTimestamp
                timestamp={messages[0]!.timestamp}
                label={formatFeedDayLabel(messages[0]!.timestamp)}
              />
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <MessageFeedDayPill containerRef={containerRef} contentRootRef={contentRootRef} layoutSignature="playground" />
    </div>
  );
}

export function PlaygroundMessageTimingStates() {
  const [store] = useState(() => new MessageTimeLabelStore());
  return (
    <Section
      title="Message Times"
      description="Each message shows its time in the lower-right corner: on its transcribed line, or at the end of its last text line. Within a run on one side, a message less than 3 minutes before the next shown time keeps an invisible label, so nothing shifts. Normal feeds add the turn duration; exact time stays in the options menu. Messages not from today add their day (Yesterday, a weekday within the week, then the date), and a pill at the top of the feed names the day there whenever it isn't today."
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
      <div className="mt-4 grid max-w-3xl gap-4 md:grid-cols-2">
        <Card label="Older messages say which day">
          <div data-testid="playground-older-message-times" className="space-y-3">
            <InlineMessageTimingVisibilityContext.Provider value={false}>
              {OLDER_MESSAGES.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
            </InlineMessageTimingVisibilityContext.Provider>
          </div>
        </Card>
        <Card label="Day pill while the top isn't today (scroll)">
          <InlineMessageTimingVisibilityContext.Provider value={false}>
            <DayPillFeed />
          </InlineMessageTimingVisibilityContext.Provider>
        </Card>
      </div>
    </Section>
  );
}
