import { useTodoOverdueCount } from "./todo-due-clock.js";

/** How many current to-dos are overdue, as a red pill on the To-dos button's corner; nothing when none are. */
export function TodoOverdueBadge() {
  const count = useTodoOverdueCount();
  if (!count) return null;
  return (
    <span
      data-testid="todo-overdue-badge"
      title={`${count} overdue`}
      className="pointer-events-none absolute -right-1.5 -top-1.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cc-error px-1 text-[10px] leading-none tabular-nums text-white"
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
