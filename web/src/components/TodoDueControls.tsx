import { useState } from "react";
import { isValidTodoDue } from "../../shared/todo-due.js";

/**
 * A short label for a due date in the user's local time: Today, Tomorrow or Yesterday, a weekday
 * within the coming week, otherwise the date (with the year only when it differs), plus the time
 * when there is one.
 */
export function formatTodoDue(due: string, now: number): string {
  const [datePart, timePart] = due.split("T");
  const [year, month, day] = datePart!.split("-").map(Number);
  const date = new Date(year!, month! - 1, day!);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  let label: string;
  if (days === 0) label = "Today";
  else if (days === 1) label = "Tomorrow";
  else if (days === -1) label = "Yesterday";
  else if (days > 1 && days < 7) label = date.toLocaleDateString(undefined, { weekday: "short" });
  else
    label = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(year !== today.getFullYear() ? { year: "numeric" } : {}),
    });
  if (!timePart) return label;
  const [hour, minute] = timePart.split(":").map(Number);
  const time = new Date(year!, month! - 1, day!, hour, minute).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${label} ${time}`;
}

export function CalendarIcon({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
      <path d="M2.5 6.5h11M5.5 2v2.5M10.5 2v2.5" strokeLinecap="round" />
    </svg>
  );
}

/** The due date beside a to-do's title; red once the to-do is overdue. */
export function TodoDueLabel({ due, overdue, now }: { due: string; overdue: boolean; now: number }) {
  return (
    <span
      data-testid="todo-due-label"
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] ${overdue ? "text-cc-error" : "text-cc-muted"}`}
    >
      <CalendarIcon />
      {overdue && <span className="sr-only">Overdue, due </span>}
      {formatTodoDue(due, now)}
    </span>
  );
}

/**
 * Date and optional time inputs for a to-do's overflow menu. The draft is saved only with Set, so
 * typing a date digit by digit never saves half-typed values.
 */
export function TodoDueEditor({
  due,
  busy,
  onSet,
}: {
  due: string | undefined;
  busy: boolean;
  onSet: (due: string | null) => void;
}) {
  const [date, setDate] = useState(due?.split("T")[0] ?? "");
  const [time, setTime] = useState(due?.split("T")[1] ?? "");
  const draft = date ? (time ? `${date}T${time}` : date) : "";
  const canSet = isValidTodoDue(draft) && draft !== due;
  const inputClass =
    "min-w-0 rounded-lg border border-cc-border bg-cc-bg px-2 py-1.5 text-xs text-cc-fg [color-scheme:light] dark:[color-scheme:dark]";
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-medium uppercase tracking-wide text-cc-muted">Due</div>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)] gap-1.5">
        <input
          type="date"
          aria-label="Due date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={inputClass}
        />
        <input
          type="time"
          aria-label="Due time (optional)"
          value={time}
          disabled={!date}
          onChange={(event) => setTime(event.target.value)}
          className={`${inputClass} disabled:opacity-40`}
        />
      </div>
      <div className="flex gap-1.5">
        <button
          type="button"
          disabled={busy || !canSet}
          onClick={() => onSet(draft)}
          className="flex-1 rounded-lg border border-cc-primary/40 px-2 py-1.5 text-xs text-cc-primary hover:bg-cc-primary/10 disabled:opacity-35"
        >
          {due ? "Change due date" : "Set due date"}
        </button>
        {due && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSet(null)}
            className="rounded-lg border border-cc-border px-2 py-1.5 text-xs text-cc-muted hover:text-cc-fg disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
