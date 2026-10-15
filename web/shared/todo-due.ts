import type { TodoItem } from "./todo-types.js";

/**
 * Due dates are wall-clock values, `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM` (the `<input type="date">` and
 * `datetime-local` formats), read in the viewer's local time zone. "Due Oct 20" stays Oct 20 wherever
 * the list is read, instead of shifting with the zone of whoever set it.
 */
const DUE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

/** Whether `value` is a well-formed due date with real calendar values. */
export function isValidTodoDue(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DUE_PATTERN.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute] = match.map(Number) as number[];
  const date = new Date(year!, month! - 1, day!);
  if (date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day) return false;
  return match[4] === undefined || (hour! <= 23 && minute! <= 59);
}

/**
 * The moment a to-do with this due date becomes overdue, in local time: the due time when it has one,
 * otherwise the start of the day after the due date (a to-do due today is not overdue until tomorrow).
 */
export function todoDueDeadline(due: string): number {
  const [datePart, timePart] = due.split("T");
  const [year, month, day] = datePart!.split("-").map(Number);
  if (timePart) {
    const [hour, minute] = timePart.split(":").map(Number);
    return new Date(year!, month! - 1, day!, hour, minute).getTime();
  }
  return new Date(year!, month! - 1, day! + 1).getTime();
}

/** Only current Todo and Doing items can be overdue; Done and archived items never are. */
export function isTodoOverdue(item: Pick<TodoItem, "due" | "status" | "archivedAt">, now = Date.now()): boolean {
  return !!item.due && item.status !== "done" && !item.archivedAt && now >= todoDueDeadline(item.due);
}
