import { useState, type KeyboardEvent, type SyntheticEvent } from "react";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** The server refuses snoozes longer than this. */
const MAX_SNOOZE_MS = 30 * DAY_MS;
/** A day picked without changing the time reminds at the start of a working morning. */
const DEFAULT_DAY_TIME = "09:00";

export const NEEDS_INPUT_SNOOZE_PRESETS: ReadonlyArray<{ label: string; durationMs: number }> = [
  { label: "1 hour", durationMs: HOUR_MS },
  { label: "6 hours", durationMs: 6 * HOUR_MS },
  { label: "24 hours", durationMs: DAY_MS },
];

const DATE_INPUT_CLASS =
  "rounded border border-cc-border bg-cc-bg/70 px-1.5 py-1 text-[11px] text-cc-fg outline-none focus:border-cc-attention [color-scheme:dark]";

export const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-cc-border/60 px-2.5 py-1 text-[11px] cc-muted-readable transition-colors hover:border-cc-primary/40 hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer";

/** "Today 8:15 PM" reads as just the time; the coming week adds the weekday and later days the date. */
export function formatSnoozeUntil(until: number, now = Date.now()): string {
  const date = new Date(until);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const daysAhead = Math.round((startOfDay(date) - startOfDay(new Date(now))) / DAY_MS);
  if (daysAhead === 0) return time;
  if (daysAhead > 0 && daysAhead < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
  return `${date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} ${time}`;
}

/**
 * The "Remind me in" and "Remind me on" choices shared by every remind-later control:
 * presets, a custom amount, and a day and time. `onChoose` gets the delay in milliseconds;
 * the browser turns a picked local day and time into a delay so the wake time follows the
 * user's clock.
 */
export function RemindLaterChoices({ busy, onChoose }: { busy: boolean; onChoose: (durationMs: number) => void }) {
  const [customAmount, setCustomAmount] = useState("");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours">("minutes");
  const [day, setDay] = useState(() => toDateInputValue(new Date(Date.now() + DAY_MS)));
  const [dayTime, setDayTime] = useState(DEFAULT_DAY_TIME);

  const customDurationMs = Number(customAmount) * (customUnit === "hours" ? HOUR_MS : MINUTE_MS);
  const canSnoozeCustom = Number.isFinite(customDurationMs) && customDurationMs >= MINUTE_MS;
  const snoozeCustom = (event: SyntheticEvent) => {
    event.stopPropagation();
    if (canSnoozeCustom && !busy) onChoose(customDurationMs);
  };
  const dayDurationMs = localDateTimeMs(day, dayTime) - Date.now();
  const canSnoozeDay = dayDurationMs >= MINUTE_MS && dayDurationMs <= MAX_SNOOZE_MS;
  const snoozeDay = (event: SyntheticEvent) => {
    event.stopPropagation();
    if (canSnoozeDay && !busy) onChoose(dayDurationMs);
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Remind me in">
        <span className="text-[11px] text-cc-muted">Remind me in</span>
        {NEEDS_INPUT_SNOOZE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={busy}
            onClick={() => onChoose(preset.durationMs)}
            className={SECONDARY_BUTTON_CLASS}
          >
            {preset.label}
          </button>
        ))}
        <span className="inline-flex items-center gap-1">
          <input
            type="number"
            inputMode="decimal"
            min="1"
            value={customAmount}
            onChange={(event) => setCustomAmount(event.target.value)}
            onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") snoozeCustom(event);
            }}
            placeholder="Custom"
            aria-label="Custom snooze amount"
            className="w-20 rounded border border-cc-border bg-cc-bg/70 px-1.5 py-1 text-[11px] text-cc-fg outline-none focus:border-cc-attention"
          />
          <select
            value={customUnit}
            onChange={(event) => setCustomUnit(event.target.value as "minutes" | "hours")}
            aria-label="Custom snooze unit"
            className="rounded border border-cc-border bg-cc-bg/70 px-1 py-1 text-[11px] text-cc-fg outline-none"
          >
            <option value="minutes">min</option>
            <option value="hours">hours</option>
          </select>
          <button
            type="button"
            disabled={!canSnoozeCustom || busy}
            onClick={snoozeCustom}
            className={SECONDARY_BUTTON_CLASS}
          >
            Snooze
          </button>
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label="Remind me on">
        <span className="text-[11px] text-cc-muted">Remind me on</span>
        <input
          type="date"
          value={day}
          min={toDateInputValue(new Date())}
          // The last offered day fits any time of day within the server's limit.
          max={toDateInputValue(new Date(Date.now() + MAX_SNOOZE_MS - DAY_MS))}
          onChange={(event) => setDay(event.target.value)}
          aria-label="Snooze until day"
          className={DATE_INPUT_CLASS}
        />
        <input
          type="time"
          value={dayTime}
          onChange={(event) => setDayTime(event.target.value)}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") snoozeDay(event);
          }}
          aria-label="Snooze until time"
          className={DATE_INPUT_CLASS}
        />
        <button type="button" disabled={!canSnoozeDay || busy} onClick={snoozeDay} className={SECONDARY_BUTTON_CLASS}>
          Snooze
        </button>
      </div>
    </>
  );
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The `YYYY-MM-DD` value a date input uses for the given local day. */
function toDateInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local epoch milliseconds for date and time input values; NaN while either is empty or partial. */
function localDateTimeMs(day: string, time: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, date, hours, minutes).getTime();
}

export function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-3" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
    </svg>
  );
}
