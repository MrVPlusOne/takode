import { useStore } from "../store.js";
import { getShortcutTitle } from "../shortcuts.js";

/**
 * Full-width field at the top of the sessions panel, on desktop and phone alike,
 * that opens Universal Search across all sessions, quests and messages.
 * Questmaster opens from the panel's bottom bar. On the phone, where the panel
 * overlays the page, `closePanelOnOpen` closes it before opening the search.
 */
export function SidebarGlobalSearch({
  onOpenUniversalSearch,
  closePanelOnOpen,
}: {
  onOpenUniversalSearch?: () => void;
  closePanelOnOpen: boolean;
}) {
  const shortcutSettings = useStore((s) => s.shortcutSettings);
  // A visible shortcut hint would truncate the label in the default panel width,
  // so the shortcut lives in the tooltip.
  const searchTitle = getShortcutTitle(
    "Search everything",
    shortcutSettings,
    "search_session",
    typeof navigator === "undefined" ? undefined : navigator.platform,
  );

  return (
    <button
      type="button"
      onClick={() => {
        if (closePanelOnOpen) useStore.getState().setSidebarOpen(false);
        onOpenUniversalSearch?.();
      }}
      aria-label="Universal Search"
      title={searchTitle}
      data-testid="sidebar-global-search"
      className="flex h-8 w-full items-center gap-2 rounded-lg border border-cc-border bg-cc-input-bg px-2.5 text-[12px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg cursor-pointer"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
        <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zm-5.442.156a5 5 0 110-10 5 5 0 010 10z" />
      </svg>
      <span className="truncate">Search everything…</span>
    </button>
  );
}
