import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { todoDueDeadline } from "../../shared/todo-due.js";
import { api } from "../api.js";
import { TODO_STATE_UPDATED_EVENT } from "../todo-events.js";

/** Longest delay `setTimeout` accepts; later changes are rescheduled when it fires. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * The next moment anything shown for these due dates changes: a due date passing (an item turns
 * overdue) or local midnight (labels such as Today and Tomorrow move on).
 */
export function nextTodoDueChange(dues: readonly string[], now: number): number {
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  let next = midnight.getTime();
  for (const due of dues) {
    const deadline = todoDueDeadline(due);
    if (deadline > now && deadline < next) next = deadline;
  }
  return next;
}

/**
 * The current time for rendering due dates, refreshed exactly when an item turns overdue or the
 * day changes, and when the page becomes visible again (a sleeping phone skips timers).
 */
export function useTodoDueNow(dues: readonly string[]): number {
  const [tick, setTick] = useState(0);
  const key = dues.join(",");
  // Read the clock again whenever the due dates change too, so a new one is judged against the real time.
  const now = useMemo(() => Date.now(), [key, tick]);
  useEffect(() => {
    const refresh = () => setTick((value) => value + 1);
    const delay = Math.min(nextTodoDueChange(key ? key.split(",") : [], now) - now, MAX_TIMEOUT_MS);
    const timeout = window.setTimeout(refresh, Math.max(delay, 0));
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timeout);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key, now]);
  return now;
}

interface DueDatesCache {
  dues: string[];
  revision: number;
  loading: boolean;
  reloadAfterLoad: boolean;
  watching: boolean;
  listeners: Set<() => void>;
}

const cache: DueDatesCache = {
  dues: [],
  revision: -1,
  loading: false,
  reloadAfterLoad: false,
  watching: false,
  listeners: new Set(),
};

/**
 * How many current to-dos are overdue, for the To-dos button. Reads only the due dates
 * (`GET /todos/due-dates`), never the full list, and reloads them whenever the list changes.
 */
export function useTodoOverdueCount(): number {
  const subscribe = useCallback((listener: () => void) => {
    cache.listeners.add(listener);
    return () => cache.listeners.delete(listener);
  }, []);
  useEffect(watchDueDates, []);
  const dues = useSyncExternalStore(subscribe, () => cache.dues);
  const now = useTodoDueNow(dues);
  return dues.filter((due) => now >= todoDueDeadline(due)).length;
}

function watchDueDates(): void {
  if (cache.watching) return;
  cache.watching = true;
  window.addEventListener(TODO_STATE_UPDATED_EVENT, loadDueDates);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") loadDueDates();
  });
  loadDueDates();
}

function loadDueDates(): void {
  // A change during a load may not be in its answer, so load once more after it.
  if (cache.loading) {
    cache.reloadAfterLoad = true;
    return;
  }
  cache.loading = true;
  Promise.resolve()
    .then(() => api.getTodoDueDates())
    .then((update) => {
      if (update.revision < cache.revision) return;
      cache.dues = update.dues;
      cache.revision = update.revision;
      for (const listener of cache.listeners) listener();
    })
    .catch((error: unknown) => console.warn("[todos] Could not load due dates:", error))
    .finally(() => {
      cache.loading = false;
      if (!cache.reloadAfterLoad) return;
      cache.reloadAfterLoad = false;
      loadDueDates();
    });
}
