import { ActiveTimersPage } from "./ActiveTimersPage.js";
import { TodoListPanel } from "./TodoListPanel.js";

export function TodosAndTimersPage() {
  return (
    <div className="h-full overflow-y-auto bg-cc-bg" data-testid="todos-and-timers-page">
      <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 sm:px-8 sm:py-10">
        <header>
          <h1 className="text-xl font-semibold text-cc-fg">To-dos &amp; Timers</h1>
          <p className="mt-1 text-sm text-cc-muted">
            Keep personal reminders at the top and inspect session timers below.
          </p>
        </header>
        <TodoListPanel />
        <section className="border-t border-cc-border pt-8">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-cc-fg">Timers</h2>
            <p className="mt-1 text-xs text-cc-muted">
              Session-scoped waits and recurring checks remain separate from personal to-dos.
            </p>
          </div>
          <ActiveTimersPage />
        </section>
      </div>
    </div>
  );
}
