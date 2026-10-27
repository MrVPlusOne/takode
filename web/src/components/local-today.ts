import { useSyncExternalStore } from "react";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight at the start of the day containing `ms`. */
export function localDayStartMs(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Calendar days from the day containing `timestamp` to the day containing `now` (0 = same day). */
export function localDaysAgo(timestamp: number, now: number): number {
  // Rounding absorbs the 23- and 25-hour days around daylight saving changes.
  return Math.round((localDayStartMs(now) - localDayStartMs(timestamp)) / ONE_DAY_MS);
}

// One shared clock for every message time on screen: hundreds of labels subscribe, so they
// share a single midnight timer instead of each setting its own.
let today = localDayStartMs(Date.now());
const listeners = new Set<() => void>();
let midnightTimer: number | undefined;

function refresh() {
  const next = localDayStartMs(Date.now());
  scheduleMidnight();
  if (next === today) return;
  today = next;
  for (const listener of listeners) listener();
}

function scheduleMidnight() {
  window.clearTimeout(midnightTimer);
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  midnightTimer = window.setTimeout(refresh, midnight.getTime() - Date.now() + 1000);
}

// A sleeping phone skips timers, so a page shown again checks the day too.
function onVisible() {
  if (document.visibilityState === "visible") refresh();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    today = localDayStartMs(Date.now());
    scheduleMidnight();
    document.addEventListener("visibilitychange", onVisible);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    window.clearTimeout(midnightTimer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

/**
 * Local midnight of the current day. Components that show how old something is ("Yesterday",
 * "Mon") read it so they re-render when the day changes, including after a phone wakes up.
 */
export function useLocalToday(): number {
  return useSyncExternalStore(subscribe, () => today);
}
