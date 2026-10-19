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

function localDateValue(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The one-tap due dates: today, tomorrow and the coming Monday, as local `YYYY-MM-DD` values. */
export function todoDueQuickPicks(now: number): { label: string; due: string }[] {
  const day = (offset: number) => {
    const date = new Date(now);
    date.setDate(date.getDate() + offset);
    return localDateValue(date);
  };
  const weekday = new Date(now).getDay();
  return [
    { label: "Today", due: day(0) },
    { label: "Tomorrow", due: day(1) },
    { label: "Next week", due: day((8 - weekday) % 7 || 7) },
  ];
}

/**
 * Due-date choices as one segmented control of equal cells: Today, Tomorrow and Next week save in
 * one tap, and Date… opens the date and time inputs (selected when the due date is another day).
 */
export function TodoDueQuickPicks({
  due,
  busy,
  now,
  onSet,
}: {
  due: string | undefined;
  busy: boolean;
  now: number;
  onSet: (due: string | null) => void;
}) {
  const picks = todoDueQuickPicks(now);
  const other = !!due && !picks.some((pick) => pick.due === due);
  const [picking, setPicking] = useState(false);
  const segment = (selected: boolean) =>
    `flex h-8 min-w-0 items-center justify-center rounded-md px-1 text-[13px] disabled:opacity-50 pointer-coarse:h-10 ${
      selected ? "bg-cc-hover text-cc-fg" : "text-cc-muted hover:text-cc-fg"
    }`;
  return (
    <div className="space-y-2">
      <div
        role="group"
        aria-label="Due date shortcuts"
        className="grid grid-cols-4 rounded-lg border border-cc-border p-0.5"
      >
        {picks.map((pick) => (
          <button
            key={pick.label}
            type="button"
            disabled={busy}
            aria-pressed={due === pick.due}
            onClick={() => {
              setPicking(false);
              if (due !== pick.due) onSet(pick.due);
            }}
            className={segment(due === pick.due)}
          >
            <span className="truncate">{pick.label}</span>
          </button>
        ))}
        <button
          type="button"
          aria-pressed={other}
          aria-expanded={picking}
          onClick={() => setPicking((open) => !open)}
          className={segment(other || picking)}
        >
          Date…
        </button>
      </div>
      {picking && (
        <TodoDueEditor
          key={due ?? ""}
          due={due}
          busy={busy}
          onSet={(value) => {
            setPicking(false);
            onSet(value);
          }}
        />
      )}
    </div>
  );
}

/**
 * Date and optional time inputs for an exact due date. The draft is saved only with Set, so
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
    "h-8 min-w-0 rounded-lg border border-cc-border bg-cc-bg px-2 text-[13px] text-cc-fg [color-scheme:light] dark:[color-scheme:dark] pointer-coarse:h-10";
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,6.5rem)_auto] gap-1.5">
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
      <button
        type="button"
        disabled={busy || !canSet}
        onClick={() => onSet(draft)}
        className="h-8 rounded-lg bg-cc-primary px-3 text-[13px] text-white hover:bg-cc-primary-hover disabled:opacity-40 pointer-coarse:h-10"
      >
        Set
      </button>
    </div>
  );
}
