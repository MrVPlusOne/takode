import { createContext, useContext, useLayoutEffect, useRef } from "react";
import { localDaysAgo, useLocalToday } from "./local-today.js";
import { type MessageTimeSide, useMessageTimeLabelHidden } from "./message-time-labels.js";

export const InlineMessageTimingVisibilityContext = createContext(true);

function formatMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function isValidMessageTimestamp(timestamp: number | undefined): timestamp is number {
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return false;
  return !Number.isNaN(new Date(timestamp).getTime());
}

/**
 * A message's time, with as much of its day as it takes to tell how old it is: "2:13 PM" today,
 * "Yesterday 2:13 PM", "Mon 2:13 PM" within the past week, then "Oct 19, 2:13 PM", with the year
 * when it differs from this one.
 */
export function formatMessageTimestamp(timestamp: number, now: number | Date = Date.now()): string {
  const parts = messageTimestampParts(timestamp, now);
  if (!parts) return "";
  return parts.day ? `${parts.day} ${parts.time}` : parts.time;
}

/** formatMessageTimestamp's text as its day ("" today, "Yesterday", "Mon", "Oct 19,") and its time. */
function messageTimestampParts(timestamp: number, now: number | Date): { day: string; time: string } | null {
  const d = new Date(timestamp);
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (Number.isNaN(d.getTime()) || Number.isNaN(nowMs)) return null;

  const time = formatMessageTime(timestamp);
  if (!time) return null;

  const daysAgo = localDaysAgo(timestamp, nowMs);
  if (daysAgo === 0) return { day: "", time };
  if (daysAgo === 1) return { day: "Yesterday", time };
  if (daysAgo > 1 && daysAgo < 7) return { day: d.toLocaleDateString([], { weekday: "short" }), time };

  const dateText = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: "numeric" }),
  });
  return { day: `${dateText},`, time };
}

/** How long ago a message's day was: "today", "yesterday" or "5 days ago". */
export function formatMessageDayAge(timestamp: number, now: number = Date.now()): string {
  const daysAgo = localDaysAgo(timestamp, now);
  if (daysAgo <= 0) return "today";
  return daysAgo === 1 ? "yesterday" : `${daysAgo} days ago`;
}

/** The full date and time, then how many days ago that was, for tooltips and the message menu. */
export function formatExactMessageTimestamp(timestamp: number, now: number = Date.now()): string {
  const d = new Date(timestamp);
  if (!isValidMessageTimestamp(timestamp)) return "";
  const exact = d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  return `${exact} · ${formatMessageDayAge(timestamp, now)}`;
}

function formatTurnDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 100) return "<0.1s";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(/\.0$/, "")}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}m ${secs}s`;
}

export function MessageTimestamp({ timestamp, turnDurationMs }: { timestamp: number; turnDurationMs?: number }) {
  const isVisible = useContext(InlineMessageTimingVisibilityContext);
  const today = useLocalToday();
  const d = new Date(timestamp);
  if (!isVisible || !isValidMessageTimestamp(timestamp)) return null;
  const timestampText = formatMessageTimestamp(timestamp, today);
  if (!timestampText) return null;
  const durationText = typeof turnDurationMs === "number" ? formatTurnDuration(turnDurationMs) : "";
  return (
    <time
      data-testid="message-timestamp"
      dateTime={d.toISOString()}
      title={formatExactMessageTimestamp(timestamp, today)}
      className="inline-block ml-2 text-[11px] text-cc-muted/70"
    >
      {durationText ? `${timestampText} · ${durationText}` : timestampText}
    </time>
  );
}

/**
 * A message's time in the feed, at the message's start: on a line of its own just above the
 * message, at the start of a line it shares (beside a user's bubble, before an answer's
 * reference), or, where the feed has a wide enough left margin, in that margin beside the first
 * line (`.message-start-time` in index.css). When an earlier message from the same side already
 * shows a time less than MESSAGE_TIME_CLUSTER_MS before it, the label takes no room and shows
 * nothing. A pending message (not delivered yet) holds its label's place invisibly, so landing
 * moves nothing. `data-feed-time` lets the feed's day pill find which day is at the top of the view.
 */
export function MessageTimeLabel({
  id,
  side,
  timestamp,
  turnDurationMs,
  pending = false,
  inline = false,
}: {
  id: string;
  side: MessageTimeSide;
  timestamp: number;
  turnDurationMs?: number;
  pending?: boolean;
  /** Shares its line with what follows it (a user's bubble, an answer's reference) instead of taking a line of its own. */
  inline?: boolean;
}) {
  const hidden = useMessageTimeLabelHidden(id, side, timestamp);
  const showDuration = useContext(InlineMessageTimingVisibilityContext);
  const today = useLocalToday();
  const parts = messageTimeLabelParts(timestamp, showDuration ? turnDurationMs : undefined, today);
  const labelRef = useRef<HTMLTimeElement>(null);
  const dayComma = parts?.day.endsWith(",") ?? false;
  // A date's comma ("Oct 24, 2026,") only joins it to the time on one line; when the label breaks,
  // the day line drops it. Whether it breaks depends on the text and font, not the feed's width,
  // so measuring when the text changes is enough.
  useLayoutEffect(() => {
    const label = labelRef.current;
    if (!label || !dayComma) return;
    delete label.dataset.broken;
    const [day, time] = label.querySelectorAll("[data-time-run]");
    if (day && time && time.getBoundingClientRect().top > day.getBoundingClientRect().top)
      label.dataset.broken = "true";
  }, [dayComma, parts?.day, parts?.time]);
  if (!parts) return null;
  return (
    <time
      ref={labelRef}
      data-testid="message-time-label"
      data-side={side}
      data-inline={inline ? "true" : undefined}
      data-hidden={hidden ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
      data-feed-time={timestamp}
      dateTime={new Date(timestamp).toISOString()}
      title={formatExactMessageTimestamp(timestamp, today)}
      aria-hidden={hidden || pending ? true : undefined}
      className={`message-start-time text-[11px] leading-4 tabular-nums text-cc-muted/70 ${pending ? "invisible" : ""}`}
    >
      {/* Where the label is too narrow for one line, it breaks only between the day and the time. */}
      {parts.day && (
        <>
          <span className="whitespace-nowrap" data-time-run="day">
            {dayComma ? parts.day.slice(0, -1) : parts.day}
            {dayComma && <span data-time-comma="true">,</span>}
          </span>{" "}
        </>
      )}
      <span className="whitespace-nowrap" data-time-run="time">
        {parts.time}
      </span>
    </time>
  );
}

/** Label text: the day-aware time, plus the turn's duration where the feed shows durations. */
export function formatMessageTimeLabel(timestamp: number, turnDurationMs?: number, now: number = Date.now()): string {
  const parts = messageTimeLabelParts(timestamp, turnDurationMs, now);
  if (!parts) return "";
  return parts.day ? `${parts.day} ${parts.time}` : parts.time;
}

function messageTimeLabelParts(
  timestamp: number,
  turnDurationMs: number | undefined,
  now: number,
): { day: string; time: string } | null {
  const parts = isValidMessageTimestamp(timestamp) ? messageTimestampParts(timestamp, now) : null;
  if (!parts) return null;
  const duration = typeof turnDurationMs === "number" ? formatTurnDuration(turnDurationMs) : "";
  return duration ? { day: parts.day, time: `${parts.time} · ${duration}` } : parts;
}
