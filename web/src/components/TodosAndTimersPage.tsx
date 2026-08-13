import { ActiveTimersPage } from "./ActiveTimersPage.js";
import { TodoListPanel } from "./TodoListPanel.js";

export function TodosAndTimersPage() {
  return (
    <div className="h-full overflow-y-auto bg-cc-bg" data-testid="todos-and-timers-page">
      <div className="mx-auto max-w-5xl space-y-7 px-4 py-6 sm:px-8 sm:py-9">
        <TodoListPanel />
        <details className="border-t border-cc-border pt-5" data-testid="timers-collapsible-section">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-1 py-2 text-sm font-medium text-cc-muted hover:text-cc-fg [&::-webkit-details-marker]:hidden">
            <span>▸ Timers</span>
            <span className="text-xs font-normal">Session-scoped waits and recurring checks</span>
          </summary>
          <div className="pt-4">
            <ActiveTimersPage />
          </div>
        </details>
      </div>
    </div>
  );
}
