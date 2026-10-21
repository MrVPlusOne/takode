/**
 * The Notify Me menu behind a thread's Notify button: turn Notify Me on now, or after a
 * delay ("Remind me later"). A delay marks the thread read now; when the time comes the
 * thread enters Notify Me with a result to acknowledge. Main has only the delayed choice,
 * because Notify Me does not track Main.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { cancelThreadReminder } from "../api/thread-reminders.js";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { remindThreadLater } from "../utils/attention-item-menu.js";
import { useThreadReminder } from "../utils/thread-reminders.js";
import { ClockIcon, RemindLaterChoices, SECONDARY_BUTTON_CLASS, formatSnoozeUntil } from "./RemindLaterChoices.js";

export function NotifyMeMenu({
  sessionId,
  threadKey,
  tracking,
  onSetTracking,
  anchor,
  trigger,
  onClose,
}: {
  sessionId: string;
  threadKey: string;
  tracking: boolean;
  /** Turns Notify Me on or off now; absent on Main, which Notify Me does not track. */
  onSetTracking?: (enabled: boolean) => Promise<void>;
  anchor: DOMRect | null;
  trigger: HTMLElement | null;
  onClose: () => void;
}) {
  const reminder = useThreadReminder(sessionId, threadKey);
  const panelRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });
  useOutsidePress([panelRef, trigger], onClose);

  // Under the button, kept on screen; above it when there is no room below.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchor) return;
    const margin = 12;
    const width = Math.min(panel.offsetWidth, window.innerWidth - 2 * margin);
    const left = Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin));
    const below = anchor.bottom + 6 + panel.offsetHeight <= window.innerHeight - margin;
    setStyle({ left, top: below ? anchor.bottom + 6 : Math.max(margin, anchor.top - 6 - panel.offsetHeight) });
  }, [anchor]);

  const run = async (request: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await request();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Please retry.");
    } finally {
      setBusy(false);
    }
  };

  const status = reminder
    ? `Back in Notify Me ${formatSnoozeUntil(reminder.remindAt)}.`
    : tracking
      ? "Notify Me is on: new results wait here until you acknowledge them."
      : onSetTracking
        ? "Get notified about new results now, or have this come back later."
        : "Have Main come back later, waiting for you to acknowledge it.";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Notify Me"
      style={style}
      className="fixed z-50 flex w-max max-w-[min(26rem,calc(100vw-1.5rem))] flex-col items-end gap-2 rounded-xl border border-cc-border bg-cc-card p-3 shadow-xl font-sans-ui"
      data-testid="notify-me-menu"
    >
      <p className="w-full text-[11px] leading-snug text-cc-muted">{status}</p>
      {(onSetTracking || reminder) && (
        <div className="flex w-full flex-wrap items-center justify-end gap-1.5">
          {reminder && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => cancelThreadReminder(sessionId, threadKey))}
              className={SECONDARY_BUTTON_CLASS}
            >
              Cancel reminder
            </button>
          )}
          {onSetTracking && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => onSetTracking(!tracking))}
              className={SECONDARY_BUTTON_CLASS}
              data-testid="notify-me-now"
            >
              {tracking ? "Stop notifying" : "Notify me now"}
            </button>
          )}
        </div>
      )}
      <div className="flex w-full items-center gap-1.5 border-t border-cc-border/60 pt-2 text-[11px] text-cc-muted">
        <ClockIcon />
        {reminder ? "Change the time" : "Remind me later"}
      </div>
      <RemindLaterChoices
        busy={busy}
        onChoose={(durationMs) => void run(() => remindThreadLater(sessionId, threadKey, durationMs))}
      />
      {error && <p className="text-[10px] leading-snug text-cc-error">{error}</p>}
    </div>,
    document.body,
  );
}
