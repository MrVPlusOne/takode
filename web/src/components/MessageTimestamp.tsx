import { createContext, useContext } from "react";
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
  const d = new Date(timestamp);
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (Number.isNaN(d.getTime()) || Number.isNaN(nowMs)) return "";

  const timeText = formatMessageTime(timestamp);
  if (!timeText) return "";

  const daysAgo = localDaysAgo(timestamp, nowMs);
  if (daysAgo === 0) return timeText;
  if (daysAgo === 1) return `Yesterday ${timeText}`;
  if (daysAgo > 1 && daysAgo < 7) return `${d.toLocaleDateString([], { weekday: "short" })} ${timeText}`;

  const dateText = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date(nowMs).getFullYear() ? {} : { year: "numeric" }),
  });
  return `${dateText}, ${timeText}`;
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
 * Room the label needs at the end of a message's last line, as a CSS length. Labels use
 * 11px text, roughly 6px per character.
 */
export function messageTimeLabelReserve(text: string): string {
  return `${text.length * 6 + 10}px`;
}

/**
 * A message's time in the feed. When a newer message from the same side covers it, the
 * label turns invisible but keeps its space, so nothing in the feed moves. `data-feed-time`
 * lets the feed's day pill find which day is at the top of the view.
 */
export function MessageTimeLabel({
  id,
  side,
  timestamp,
  turnDurationMs,
  className = "",
}: {
  id: string;
  side: MessageTimeSide;
  timestamp: number;
  turnDurationMs?: number;
  className?: string;
}) {
  const hidden = useMessageTimeLabelHidden(id, side, timestamp);
  const showDuration = useContext(InlineMessageTimingVisibilityContext);
  const today = useLocalToday();
  const text = formatMessageTimeLabel(timestamp, showDuration ? turnDurationMs : undefined, today);
  if (!text) return null;
  return (
    <time
      data-testid="message-time-label"
      data-hidden={hidden ? "true" : undefined}
      data-feed-time={timestamp}
      dateTime={new Date(timestamp).toISOString()}
      title={formatExactMessageTimestamp(timestamp, today)}
      aria-hidden={hidden ? true : undefined}
      className={`whitespace-nowrap text-[11px] leading-4 tabular-nums text-cc-muted/70 ${hidden ? "invisible" : ""} ${className}`}
    >
      {text}
    </time>
  );
}

/**
 * Holds a time label's space without showing it, for a message that has not landed yet.
 * It stays out of the feed's label clustering, which only counts delivered messages.
 */
export function MessageTimePlaceholder({ timestamp }: { timestamp: number }) {
  const text = formatMessageTimeLabel(timestamp, undefined, useLocalToday());
  if (!text) return null;
  return (
    <span
      aria-hidden="true"
      data-testid="message-time-placeholder"
      className="invisible whitespace-nowrap text-[11px] leading-4 tabular-nums"
    >
      {text}
    </span>
  );
}

/** Label text: the day-aware time, plus the turn's duration where the feed shows durations. */
export function formatMessageTimeLabel(timestamp: number, turnDurationMs?: number, now: number = Date.now()): string {
  const time = isValidMessageTimestamp(timestamp) ? formatMessageTimestamp(timestamp, now) : "";
  if (!time) return "";
  const duration = typeof turnDurationMs === "number" ? formatTurnDuration(turnDurationMs) : "";
  return duration ? `${time} · ${duration}` : time;
}
