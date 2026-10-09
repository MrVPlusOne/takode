import { useStore } from "../store.js";
import { GlobalNeedsInputMenu } from "./GlobalNeedsInputMenu.js";
import { GlobalNotifyMeMenu } from "./GlobalNotifyMeMenu.js";
import { ShortcutTile } from "./ShortcutTile.js";

/**
 * Phone-only shortcut row at the top of the sessions panel: the actions that
 * no longer fit the phone top bar. Each tile closes the panel before opening
 * its view so the view is not hidden behind it.
 */
export function SidebarShortcutTiles({ onOpenUniversalSearch }: { onOpenUniversalSearch?: () => void }) {
  const activeQuestCount = useStore(
    (s) => s.questSummary?.active ?? s.quests.reduce((count, quest) => count + (quest.status !== "done" ? 1 : 0), 0),
  );
  const closePanel = () => useStore.getState().setSidebarOpen(false);

  return (
    <div className="grid grid-cols-4 gap-1.5" data-testid="sidebar-shortcut-tiles">
      <GlobalNeedsInputMenu variant="tile" onOpen={closePanel} />
      <GlobalNotifyMeMenu variant="tile" onOpen={closePanel} />
      <ShortcutTile
        onClick={() => {
          closePanel();
          window.location.hash = "#/questmaster";
        }}
        icon={
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M2.5 2a.5.5 0 00-.5.5v11a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-11a.5.5 0 00-.5-.5h-11zM1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v11a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 011 13.5v-11zM4 5.75a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 014 5.75zM4.75 8a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-4.5zM4 11.25a.75.75 0 01.75-.75h2.5a.75.75 0 010 1.5h-2.5a.75.75 0 01-.75-.75z" />
          </svg>
        }
        count={activeQuestCount}
        label="Quests"
      />
      <ShortcutTile
        onClick={() => {
          closePanel();
          onOpenUniversalSearch?.();
        }}
        icon={
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
            <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zm-5.442.156a5 5 0 110-10 5 5 0 010 10z" />
          </svg>
        }
        label="Search"
      />
    </div>
  );
}
