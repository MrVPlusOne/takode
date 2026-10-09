import { useStore } from "../store.js";
import { getShortcutHint } from "../shortcuts.js";
import { GlobalNeedsInputMenu } from "./GlobalNeedsInputMenu.js";
import { GlobalNotifyMeMenu } from "./GlobalNotifyMeMenu.js";
import { PanelChip } from "./PanelChip.js";

/**
 * Quick actions at the top of the sessions panel, on desktop and phone alike:
 * a search field that opens Universal Search, then the needs-input, Notify Me
 * and Quests chips that the top bar no longer carries. On the phone, where the
 * panel overlays the page, `closePanelOnOpen` closes it before opening a view.
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
  const searchHint = getShortcutHint(
    shortcutSettings,
    "search_session",
    typeof navigator === "undefined" ? undefined : navigator.platform,
  );
  const closePanel = closePanelOnOpen ? () => useStore.getState().setSidebarOpen(false) : undefined;

  return (
    <div className="space-y-2" data-testid="sidebar-quick-actions">
      <button
        type="button"
        onClick={() => {
          closePanel?.();
          onOpenUniversalSearch?.();
        }}
        aria-label="Universal Search"
        className="flex h-8 w-full items-center gap-2 rounded-lg border border-cc-border bg-cc-input-bg px-2.5 text-[12px] text-cc-muted transition-colors hover:border-cc-primary/40 hover:text-cc-fg cursor-pointer"
      >
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
          <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zm-5.442.156a5 5 0 110-10 5 5 0 010 10z" />
        </svg>
        <span className="flex-1 truncate text-left">Search everything…</span>
        {searchHint && (
          <span className="shrink-0 rounded border border-cc-border px-1 text-[10px] leading-4">{searchHint}</span>
        )}
      </button>
      <div className="flex gap-1.5">
        <GlobalNeedsInputMenu variant="panel" onOpen={closePanel} />
        <GlobalNotifyMeMenu variant="panel" onOpen={closePanel} />
        <PanelChip
          onClick={() => {
            closePanel?.();
            window.location.hash = "#/questmaster";
          }}
          ariaLabel={`Quests (${activeQuestCount} active)`}
          icon={
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
              <path d="M2.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-11zM1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11zM4 5.75a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 5.75zM4.75 8a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zM4 11.25a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
            </svg>
          }
          label={`Quests ${activeQuestCount}`}
          grow
        />
      </div>
    </div>
  );
}
