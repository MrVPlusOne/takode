import { useStore } from "../store.js";
import { openSecondaryPage } from "../utils/secondary-view.js";

/** Opens the glossary page, closing the phone's sessions panel first so the page is in view. */
export function openGlossary({ closePanel }: { closePanel: boolean }) {
  if (closePanel) useStore.getState().setSidebarOpen(false);
  openSecondaryPage("glossary");
}
