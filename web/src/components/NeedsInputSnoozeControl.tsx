import { useState } from "react";
import { api } from "../api.js";
import { applyServerNotification } from "../notification-status.js";
import type { SessionNotification } from "../types.js";
import { ClockIcon, RemindLaterChoices, SECONDARY_BUTTON_CLASS, formatSnoozeUntil } from "./RemindLaterChoices.js";

export { NEEDS_INPUT_SNOOZE_PRESETS, formatSnoozeUntil } from "./RemindLaterChoices.js";

/**
 * "Remind me later" for an unresolved needs-input prompt. Snoozing hides the prompt from attention and phone
 * alerts until the chosen time, when the server brings it back as a fresh alert. Rendered as fragment items so
 * it joins the caller's right-aligned flex-wrap action row ahead of the send button; the duration picker and any
 * error take full rows of their own after the whole row, so they never split the buttons apart.
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

  if (notification.category !== "needs-input" || notification.done) return null;

  const run = async (request: () => Promise<{ notification: SessionNotification }>, failure: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await request();
      applyServerNotification(sessionId, result.notification);
      setOpen(false);
    } catch (err) {
      setError(`${failure} ${err instanceof Error && err.message ? err.message : "Please retry."}`);
    } finally {
      setBusy(false);
    }
  };
  const snooze = (durationMs: number) =>
    run(() => api.snoozeNotification(sessionId, notification.id, durationMs), "Snooze failed.");

  const errorLine = error ? (
    <p className="order-last basis-full text-[10px] leading-snug text-cc-error">{error}</p>
  ) : null;

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
          className="order-last flex basis-full flex-col items-end gap-1 font-normal"
          onClick={(event) => event.stopPropagation()}
        >
          <RemindLaterChoices busy={busy} onChoose={(durationMs) => void snooze(durationMs)} />
        </div>
      )}
      {errorLine}
    </>
  );
}
