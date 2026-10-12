import { type RefObject, useEffect, useRef } from "react";

const HISTORY_STATE_KEY = "takodeQuestPreviewSheet";
let nextEntryToken = 0;

/**
 * Give an open modal preview sheet its own browser-history entry, so the phone's back gesture
 * closes the sheet instead of leaving the page.
 *
 * The entry repeats the current URL, so adding and removing it changes no route. Closing the sheet
 * any other way removes the entry again. A same-page link followed from inside the sheet is held
 * until the entry is gone and then followed, so history ends up as if the sheet had never been
 * open and no dead back step is left behind.
 */
export function usePreviewSheetHistoryEntry(
  active: boolean,
  sheetRef: RefObject<HTMLElement | null>,
  onBack: () => void,
): void {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active) return;
    const token = `${Date.now()}-${++nextEntryToken}`;
    const ownsCurrentEntry = () => historyStateRecord()[HISTORY_STATE_KEY] === token;
    history.pushState({ ...historyStateRecord(), [HISTORY_STATE_KEY]: token }, "", location.href);
    let entryRemoved = false;
    let heldLink: HTMLAnchorElement | null = null;
    let replaying = false;

    const handlePopState = () => {
      if (entryRemoved) return;
      entryRemoved = true;
      if (!heldLink) {
        onBackRef.current();
        return;
      }
      const link = heldLink;
      heldLink = null;
      replaying = true;
      try {
        link.click();
      } finally {
        replaying = false;
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (replaying || heldLink || entryRemoved || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link?.getAttribute("href")?.startsWith("#") || !sheetRef.current?.contains(link)) return;
      if (!ownsCurrentEntry()) return;
      event.preventDefault();
      event.stopPropagation();
      heldLink = link;
      history.back();
    };

    window.addEventListener("popstate", handlePopState);
    // Capture on the document runs before React's own listeners, so a held link's handlers run only once.
    document.addEventListener("click", handleClick, true);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      document.removeEventListener("click", handleClick, true);
      if (!entryRemoved && ownsCurrentEntry()) history.back();
    };
  }, [active, sheetRef]);
}

function historyStateRecord(): Record<string, unknown> {
  const state: unknown = history.state;
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}
