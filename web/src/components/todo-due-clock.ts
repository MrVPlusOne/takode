import { useEffect, useMemo, useState } from "react";
import { todoDueDeadline } from "../../shared/todo-due.js";
import { SERVER_TODO_ITEM_SUMMARIES, useTodoItemSummaries } from "./todo-item-summaries.js";

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
 * day changes, and when the page becomes visible again (a sleeping phone skips timers). Without
 * due dates nothing depends on the time, so it sets no timer.
 */
export function useTodoDueNow(dues: readonly string[]): number {
  const [tick, setTick] = useState(0);
  const key = dues.join(",");
  // Read the clock again whenever the due dates change too, so a new one is judged against the real time.
  const now = useMemo(() => Date.now(), [key, tick]);
  useEffect(() => {
    if (!key) return;
    const refresh = () => setTick((value) => value + 1);
    const delay = Math.min(nextTodoDueChange(key.split(","), now) - now, MAX_TIMEOUT_MS);
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

/**
 * How many current to-dos are overdue, for the To-dos button. Reads only the to-do summaries
 * (`GET /todos/item-summaries`) shared with to-do links, never the full list.
 */
export function useTodoOverdueCount(): number {
  const summaries = useTodoItemSummaries(SERVER_TODO_ITEM_SUMMARIES);
  const dues = useMemo(
    () =>
      Object.values(summaries?.items ?? {}).flatMap((item) =>
        item.due && item.status !== "done" && !item.archivedAt ? [item.due] : [],
      ),
    [summaries],
  );
  const now = useTodoDueNow(dues);
  return dues.filter((due) => now >= todoDueDeadline(due)).length;
}
