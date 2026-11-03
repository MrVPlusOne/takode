/**
 * Whether the user has ever opened the glossary, as the server records it, so every browser and
 * device shows the same state. Unknown (null) until the server answers; the sidebar's link is
 * highlighted only once the server says it was never opened.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { getGlossaryOpened, markGlossaryOpened } from "../api/glossary.js";

export const useGlossaryOpenedStore = create<{ opened: boolean | null }>(() => ({ opened: null }));

/** The server's answer, fetched on mount and again when the window regains focus (another device may have opened it). */
export function useGlossaryOpened(): boolean | null {
  const opened = useGlossaryOpenedStore((state) => state.opened);
  useEffect(() => {
    const load = () => {
      if (useGlossaryOpenedStore.getState().opened) return;
      getGlossaryOpened()
        .then(({ opened: value }) => useGlossaryOpenedStore.setState({ opened: value }))
        .catch((err: unknown) => console.warn("[glossary] could not read whether the glossary was opened:", err));
    };
    load();
    window.addEventListener("focus", load);
    return () => window.removeEventListener("focus", load);
  }, []);
  return opened;
}

/** Tells the server the glossary was opened, then shows its answer. */
export function recordGlossaryOpened(): void {
  if (useGlossaryOpenedStore.getState().opened) return;
  markGlossaryOpened()
    .then(({ opened }) => useGlossaryOpenedStore.setState({ opened }))
    .catch((err: unknown) => console.warn("[glossary] could not record that the glossary was opened:", err));
}
