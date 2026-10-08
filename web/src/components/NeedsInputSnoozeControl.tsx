import { useState, type KeyboardEvent, type SyntheticEvent } from "react";
import { api } from "../api.js";
import { applyServerNotification } from "../notification-status.js";
import type { SessionNotification } from "../types.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;

export const NEEDS_INPUT_SNOOZE_PRESETS: ReadonlyArray<{ label: string; durationMs: number }> = [
  { label: "15 min", durationMs: 15 * MINUTE_MS },
  { label: "1 hour", durationMs: HOUR_MS },
  { label: "3 hours", durationMs: 3 * HOUR_MS },
  { label: "8 hours", durationMs: 8 * HOUR_MS },
];

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-cc-border/60 px-2.5 py-1 text-[11px] cc-muted-readable transition-colors hover:border-cc-primary/40 hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer";

/** "Today 8:15 PM" reads as just the time; later days add the weekday. */
export function formatSnoozeUntil(until: number, now = Date.now()): string {
  const date = new Date(until);
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (date.toDateString() === new Date(now).toDateString()) return time;
  return `${date.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

/**
 * "Remind me later" for an unresolved needs-input prompt. Snoozing hides the prompt from attention and phone
 * alerts until the chosen time, when the server brings it back as a fresh alert. Rendered as fragment items so
 * it joins the caller's flex-wrap action row; the duration picker takes a full row of its own.
 */
export function NeedsInputSnoozeControl({
  sessionId,
  notification,
}: {
  sessionId: string;
  notification: SessionNotification;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours">("minutes");

  if (notification.category !== "needs-input" || notification.done) return null;

  const run = async (request: () => Promise<{ notification: SessionNotification }>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      applyServerNotification(sessionId, result.notification);
      setOpen(false);
      setCustomAmount("");
    } catch (err) {
      setError(`${failure} ${err instanceof Error && err.message ? err.message : "Please retry."}`);
    } finally {
      setBusy(false);
    }
  };
  const snooze = (durationMs: number) =>
    run(() => api.snoozeNotification(sessionId, notification.id, durationMs), "Snooze failed.");

  const customDurationMs = Number(customAmount) * (customUnit === "hours" ? HOUR_MS : MINUTE_MS);
  const canSnoozeCustom = Number.isFinite(customDurationMs) && customDurationMs >= MINUTE_MS;
  const snoozeCustom = (event: SyntheticEvent) => {
    event.stopPropagation();
    if (canSnoozeCustom && !busy) void snooze(customDurationMs);
  };
  const errorLine = error ? <p className="basis-full text-[10px] leading-snug text-cc-error">{error}</p> : null;

  if (notification.snoozedUntil !== undefined) {
    return (
      <>
        <span className="inline-flex items-center gap-1 text-[11px] font-normal text-cc-muted">
          <ClockIcon />
          Snoozed until {formatSnoozeUntil(notification.snoozedUntil)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            void run(() => api.setNotificationMuted(sessionId, notification.id, false), "Cancel failed.");
          }}
          className={SECONDARY_BUTTON_CLASS}
          aria-label="Cancel snooze"
        >
          {busy ? "..." : "Cancel snooze"}
        </button>
        {errorLine}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={`${SECONDARY_BUTTON_CLASS} inline-flex items-center gap-1`}
      >
        <ClockIcon />
        Remind me later
      </button>
      {open && (
        <div
          className="flex basis-full flex-wrap items-center gap-1 font-normal"
          role="group"
          aria-label="Remind me in"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="text-[11px] text-cc-muted">Remind me in</span>
          {NEEDS_INPUT_SNOOZE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={busy}
              onClick={() => void snooze(preset.durationMs)}
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
              className="w-16 rounded border border-cc-border bg-cc-bg/70 px-1.5 py-1 text-[11px] text-cc-fg outline-none focus:border-cc-attention"
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
      )}
      {errorLine}
    </>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="size-3" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" strokeLinecap="round" />
    </svg>
  );
}
