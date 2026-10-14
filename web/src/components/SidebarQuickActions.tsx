import { useStore } from "../store.js";
import { getShortcutTitle } from "../shortcuts.js";

/**
 * Quick actions at the top of the sessions panel, on desktop and phone alike:
 * one row with a search field that opens Universal Search and the Quests chip.
 * Needs input and Notify Me live in the top bar's attention list. On the phone,
 * where the panel overlays the page, `closePanelOnOpen` closes it before opening a view.
 */
export function SidebarQuickActions({
  onOpenUniversalSearch,
  closePanelOnOpen,
}: {
  onOpenUniversalSearch?: () => void;
  closePanelOnOpen: boolean;
}) {
  const activeQuestCount = useStore(
    (s) => s.questSummary?.active ?? s.quests.reduce((count, quest) => count + (quest.status !== "done" ? 1 : 0), 0),
  );
  const shortcutSettings = useStore((s) => s.shortcutSettings);
  // The row is too narrow for a visible shortcut hint, so it lives in the tooltip.
  const searchTitle = getShortcutTitle(
    "Search everything",
    shortcutSettings,
    "search_session",
    typeof navigator === "undefined" ? undefined : navigator.platform,
  );
  const closePanel = closePanelOnOpen ? () => useStore.getState().setSidebarOpen(false) : undefined;

  return (
    <div className="flex gap-1.5" data-testid="sidebar-quick-actions">
      <button
        type="button"
        onClick={() => {
          closePanel?.();
          onOpenUniversalSearch?.();
        }}
        aria-label="Universal Search"
        title={searchTitle}
        className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-cc-border bg-cc-input-bg px-2.5 text-[12px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg cursor-pointer"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
          <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zm-5.442.156a5 5 0 110-10 5 5 0 010 10z" />
        </svg>
        <span className="truncate">Search…</span>
      </button>
      <button
        type="button"
        onClick={() => {
          closePanel?.();
          window.location.hash = "#/questmaster";
        }}
        aria-label={`Quests (${activeQuestCount} active)`}
        className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-cc-border px-2.5 text-[12px] font-medium tabular-nums text-cc-fg/85 transition-colors hover:bg-cc-hover cursor-pointer"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
          <path d="M2.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-11zM1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11zM4 5.75a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 5.75zM4.75 8a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zM4 11.25a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
        </svg>
        Quests {activeQuestCount}
      </button>
    </div>
  );
}
