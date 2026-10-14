import { api } from "../api.js";

/** At most one report per this long; reminders are timed in hours, so minute precision is plenty. */
export const USER_ACTIVITY_REPORT_INTERVAL_MS = 60_000;

/**
 * Tell the server the user is active in Takode whenever they tap, click or
 * type here, at most once a minute. The server postpones follow-up phone
 * reminders about waiting questions while the user is active. Only taps,
 * clicks and key presses count: a window that is merely open or visible
 * reports nothing.
 */
export function installUserActivityReporter(
  doc: Document = document,
  report: () => Promise<unknown> = api.reportUserActivity,
): () => void {
  let lastReportAt = -Infinity;
  const onInput = () => {
    const now = Date.now();
    if (now - lastReportAt < USER_ACTIVITY_REPORT_INTERVAL_MS) return;
    lastReportAt = now;
    report().catch(() => undefined);
  };
  const options = { capture: true, passive: true };
  doc.addEventListener("pointerdown", onInput, options);
  doc.addEventListener("keydown", onInput, options);
  return () => {
    doc.removeEventListener("pointerdown", onInput, options);
    doc.removeEventListener("keydown", onInput, options);
  };
}
