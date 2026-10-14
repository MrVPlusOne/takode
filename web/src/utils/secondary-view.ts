import { useEffect, useRef } from "react";
import { create } from "zustand";
import { useStore } from "../store.js";
import { navigateTo } from "./navigation.js";
import {
  navigateToMostRecentSession,
  navigateToSession,
  parseHash,
  primarySessionHash,
  secondaryPageFromHash,
  withSecondaryPageInHash,
  type SecondaryPage,
} from "./routing.js";

/**
 * The secondary view: pages such as Questmaster, Memory and Settings, and viewers opened from the
 * conversation (quest details, files, images, diffs), shown without replacing the conversation, the
 * primary view, which stays mounted. Wide screens show it in a right-hand area, either beside the
 * conversation or on top of it; phones and narrow windows cover the conversation with it.
 */

/** "side": the right-hand area sits beside the conversation and stays open; "overlay": it floats over it and an outside click dismisses it. */
export type SecondaryViewMode = "side" | "overlay";

const MODE_STORAGE_KEY = "cc-secondary-view-mode";

interface SecondaryDockState {
  mode: SecondaryViewMode;
  /** The right-hand area viewers render into, or null when the layout has none. */
  target: HTMLElement | null;
  /** Close callbacks of the viewers open in the right-hand area. */
  occupants: ReadonlyMap<number, () => void>;
}

const useSecondaryDock = create<SecondaryDockState>(() => ({
  mode: readStoredMode(),
  target: null,
  occupants: new Map(),
}));

let nextOccupantId = 0;

function readStoredMode(): SecondaryViewMode {
  if (typeof localStorage === "undefined") return "side";
  return localStorage.getItem(MODE_STORAGE_KEY) === "overlay" ? "overlay" : "side";
}

export function useSecondaryViewMode(): SecondaryViewMode {
  return useSecondaryDock((state) => state.mode);
}

export function setSecondaryViewMode(mode: SecondaryViewMode): void {
  localStorage.setItem(MODE_STORAGE_KEY, mode);
  useSecondaryDock.setState({ mode });
}

/** Set by the app shell: the right-hand area's element, or null when the layout has none. */
export function setSecondaryViewTarget(target: HTMLElement | null): void {
  if (useSecondaryDock.getState().target !== target) useSecondaryDock.setState({ target });
}

/** Whether any viewer is open in the right-hand area. */
export function useSecondaryViewOccupied(): boolean {
  return useSecondaryDock((state) => state.occupants.size > 0);
}

/** Close every viewer open in the right-hand area, as an outside click in overlay mode does. */
export function closeSecondaryViewers(): void {
  for (const close of [...useSecondaryDock.getState().occupants.values()]) close();
}

/**
 * Where a viewer opened from the conversation renders while `open`: the right-hand area on wide
 * screens, or null for its own full-screen modal. `onClose` lets the area dismiss the viewer.
 */
export function useSecondaryViewTarget(open: boolean, onClose: () => void): HTMLElement | null {
  const target = useSecondaryDock((state) => state.target);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const docked = open && target !== null;
  useEffect(() => {
    if (!docked) return;
    const id = nextOccupantId++;
    useSecondaryDock.setState((state) => ({
      occupants: new Map(state.occupants).set(id, () => onCloseRef.current()),
    }));
    return () =>
      useSecondaryDock.setState((state) => {
        const occupants = new Map(state.occupants);
        occupants.delete(id);
        return { occupants };
      });
  }, [docked]);
  return docked ? target : null;
}

/** Classes for a viewer's outermost element inside the right-hand area; later viewers stack on top. */
export const SECONDARY_VIEWER_LAYER_CLASS = "absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-cc-bg";

/** Open a page as the secondary view, keeping the current session as the primary view. */
export function openSecondaryPage(page: SecondaryPage): void {
  const primary = primarySessionHash(window.location.hash);
  if (primary) {
    navigateTo(withSecondaryPageInHash(primary, page));
    return;
  }
  navigateTo(`/${page}`);
}

/** Close the secondary view and return to the primary session view. */
export function closeSecondaryPage(): void {
  const hash = window.location.hash;
  if (parseHash(hash).page === "session") {
    navigateTo(withSecondaryPageInHash(hash, null));
    return;
  }
  const sessionId = useStore.getState().currentSessionId;
  if (sessionId) navigateToSession(sessionId);
  else navigateToMostRecentSession();
}

export function toggleSecondaryPage(page: SecondaryPage): void {
  if (secondaryPageFromHash(window.location.hash) === page) closeSecondaryPage();
  else openSecondaryPage(page);
}
