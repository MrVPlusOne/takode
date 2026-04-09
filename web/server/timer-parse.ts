import type { TimerCreateInput, SessionTimer } from "./timer-types.js";

// ─── Duration Parsing ────────────────────────────────────────────────────────

const DURATION_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

const DURATION_RE = /^(\d+(?:\.\d+)?)(s|m|h|d)$/;
const COMPOUND_DURATION_RE = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;

/**
 * Parse a relative duration string into milliseconds.
 * Accepts: "30s", "5m", "2h", "1d", "2h30m", "1h15m30s", etc.
 * Minimum: 1 second. No zero or negative.
 */
export function parseDuration(spec: string): number {
  const s = spec.trim().toLowerCase();
  if (!s) throw new Error("Duration cannot be empty");

  // Try simple format first: "30m", "2h", etc.
  const simple = DURATION_RE.exec(s);
  if (simple) {
    const value = parseFloat(simple[1]);
    const unit = DURATION_UNITS[simple[2]];
    const ms = Math.round(value * unit);
    if (ms <= 0) throw new Error(`Duration must be positive: "${spec}"`);
    return ms;
  }

  // Try compound format: "2h30m", "1h15m30s"
  const compound = COMPOUND_DURATION_RE.exec(s);
  if (compound && (compound[1] || compound[2] || compound[3])) {
    const hours = parseInt(compound[1] || "0", 10);
    const minutes = parseInt(compound[2] || "0", 10);
    const seconds = parseInt(compound[3] || "0", 10);
    const ms = hours * 3_600_000 + minutes * 60_000 + seconds * 1_000;
    if (ms <= 0) throw new Error(`Duration must be positive: "${spec}"`);
    return ms;
  }

  throw new Error(`Invalid duration format: "${spec}". Use e.g. "30s", "5m", "2h", "1d", "2h30m".`);
}

// ─── Wall-Clock Parsing ──────────────────────────────────────────────────────

// Matches "3pm", "3:30pm", "15:00", "9am", "12:45", etc.
const TIME_12H_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i;
const TIME_24H_RE = /^(\d{1,2}):(\d{2})$/;

/**
 * Parse a wall-clock time string into an absolute epoch ms.
 * If the time has already passed today, targets tomorrow.
 * Accepts: "3pm", "3:30pm", "15:00", "9am", "12:00", etc.
 */
export function parseWallClock(spec: string): number {
  const s = spec.trim().toLowerCase();
  if (!s) throw new Error("Time cannot be empty");

  let hours: number;
  let minutes: number;

  const match12 = TIME_12H_RE.exec(s);
  if (match12) {
    hours = parseInt(match12[1], 10);
    minutes = parseInt(match12[2] || "0", 10);
    const isPM = match12[3].toLowerCase() === "pm";

    if (hours < 1 || hours > 12) throw new Error(`Invalid hour in time: "${spec}"`);
    if (minutes < 0 || minutes > 59) throw new Error(`Invalid minutes in time: "${spec}"`);

    // Convert to 24h
    if (isPM && hours !== 12) hours += 12;
    if (!isPM && hours === 12) hours = 0;
  } else {
    const match24 = TIME_24H_RE.exec(s);
    if (!match24) throw new Error(`Invalid time format: "${spec}". Use e.g. "3pm", "15:00", "9:30am".`);

    hours = parseInt(match24[1], 10);
    minutes = parseInt(match24[2], 10);

    if (hours < 0 || hours > 23) throw new Error(`Invalid hour in time: "${spec}"`);
    if (minutes < 0 || minutes > 59) throw new Error(`Invalid minutes in time: "${spec}"`);
  }

  const now = new Date();
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return target.getTime();
}

// ─── Schedule Resolution ─────────────────────────────────────────────────────

/**
 * Parse a TimerCreateInput into resolved schedule parameters.
 * Validates that exactly one of in/at/every is provided.
 */
export function resolveTimerSchedule(input: TimerCreateInput): {
  type: SessionTimer["type"];
  nextFireAt: number;
  intervalMs?: number;
  originalSpec: string;
} {
  const specCount = [input.in, input.at, input.every].filter(Boolean).length;
  if (specCount === 0) throw new Error("One of --in, --at, or --every must be provided");
  if (specCount > 1) throw new Error("Only one of --in, --at, or --every can be provided");

  if (input.in) {
    const ms = parseDuration(input.in);
    return {
      type: "delay",
      nextFireAt: Date.now() + ms,
      originalSpec: input.in,
    };
  }

  if (input.at) {
    return {
      type: "at",
      nextFireAt: parseWallClock(input.at),
      originalSpec: input.at,
    };
  }

  // input.every
  const ms = parseDuration(input.every!);
  return {
    type: "recurring",
    nextFireAt: Date.now() + ms,
    intervalMs: ms,
    originalSpec: input.every!,
  };
}
