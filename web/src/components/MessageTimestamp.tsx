import { createContext, useContext } from "react";
import { type MessageTimeSide, useMessageTimeLabelHidden } from "./message-time-labels.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export const InlineMessageTimingVisibilityContext = createContext(true);

function localDayStartMs(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

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

export function formatMessageTimestamp(timestamp: number, now = new Date()): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime()) || Number.isNaN(now.getTime())) return "";

  const timeText = formatMessageTime(timestamp);
  if (!timeText) return "";

  const messageDayStart = localDayStartMs(d);
  const todayStart = localDayStartMs(now);
  const dayDelta = Math.round((todayStart - messageDayStart) / ONE_DAY_MS);

  if (dayDelta === 0) return timeText;
  if (dayDelta === 1) return `yesterday ${timeText}`;

  const dateText = d.toLocaleDateString([], {
    month: "numeric",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });

  return `${dateText} ${timeText}`;
}

export function formatExactMessageTimestamp(timestamp: number): string {
  const d = new Date(timestamp);
  if (!isValidMessageTimestamp(timestamp)) return "";
  return d.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
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
  const d = new Date(timestamp);
  if (!isVisible || !isValidMessageTimestamp(timestamp)) return null;
  const timestampText = formatMessageTimestamp(timestamp);
  if (!timestampText) return null;
  const durationText = typeof turnDurationMs === "number" ? formatTurnDuration(turnDurationMs) : "";
  return (
    <time
      data-testid="message-timestamp"
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
      className="inline-block ml-2 text-[11px] text-cc-muted/70"
    >
      {durationText ? `${timestampText} · ${durationText}` : timestampText}
    </time>
  );
}

/** The clock time a feed label shows ("4:35 PM"); the day comes from the feed's date dividers. */
export function formatMessageClockTime(timestamp: number): string {
  return isValidMessageTimestamp(timestamp) ? formatMessageTime(timestamp) : "";
}

/**
 * Room the label needs at the end of a message's last line, as a CSS length. Labels use
 * 11px digits, roughly 6px per character.
 */
export function messageTimeLabelReserve(text: string): string {
  return `${text.length * 6 + 10}px`;
}

/**
 * A message's time in the feed. When a newer message from the same side covers it, the
 * label turns invisible but keeps its space, so nothing in the feed moves.
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
  const text = formatMessageTimeLabel(timestamp, showDuration ? turnDurationMs : undefined);
  if (!text) return null;
  return (
    <time
      data-testid="message-time-label"
      data-hidden={hidden ? "true" : undefined}
      dateTime={new Date(timestamp).toISOString()}
      title={formatExactMessageTimestamp(timestamp)}
      aria-hidden={hidden ? true : undefined}
      className={`whitespace-nowrap text-[11px] leading-4 tabular-nums text-cc-muted/70 ${hidden ? "invisible" : ""} ${className}`}
    >
      {text}
    </time>
  );
}

/** Label text: the clock time, plus the turn's duration where the feed shows durations. */
export function formatMessageTimeLabel(timestamp: number, turnDurationMs?: number): string {
  const time = formatMessageClockTime(timestamp);
  if (!time) return "";
  const duration = typeof turnDurationMs === "number" ? formatTurnDuration(turnDurationMs) : "";
  return duration ? `${time} · ${duration}` : time;
}
