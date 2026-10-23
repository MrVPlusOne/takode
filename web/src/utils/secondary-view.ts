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
 * primary view, which stays mounted. Wide screens float it over the app from the right, as wide as
 * its content needs; phones cover the conversation with it.
 */

/** The widest the secondary view grows for each kind of content, in CSS pixels. */
export const SECONDARY_VIEW_MAX_WIDTHS = {
  /** Quest details and Markdown files: a comfortable text column. */
  reading: 880,
  /** Pages such as Questmaster, Memory and Settings, whose content is at most 1024 px wide. */
  page: 1080,
  /** Diffs and logs, whose long lines read better unwrapped. */
  wide: 1280,
  /** Images, which use all the room a large window gives them. */
  media: 1600,
  /** Text beside long code, such as a guided review's walkthrough: the whole window. */
  full: Number.POSITIVE_INFINITY,
} as const;

export type SecondaryViewSize = keyof typeof SECONDARY_VIEW_MAX_WIDTHS;

interface SecondaryViewOccupant {
  close: () => void;
  size: SecondaryViewSize;
}

interface SecondaryDockState {
  /** The right-hand area viewers render into, or null when the layout has none. */
  target: HTMLElement | null;
  /** The viewers open in the right-hand area. */
  occupants: ReadonlyMap<number, SecondaryViewOccupant>;
}

const useSecondaryDock = create<SecondaryDockState>(() => ({
  target: null,
  occupants: new Map(),
}));

let nextOccupantId = 0;

/** Set by the app shell: the right-hand area's element, or null when the layout has none. */
export function setSecondaryViewTarget(target: HTMLElement | null): void {
  if (useSecondaryDock.getState().target !== target) useSecondaryDock.setState({ target });
}

/** Whether any viewer is open in the right-hand area. */
export function useSecondaryViewOccupied(): boolean {
  return useSecondaryDock((state) => state.occupants.size > 0);
}

/** Whether any viewer is open in the right-hand area right now, for event handlers. */
export function secondaryViewersOpen(): boolean {
  return useSecondaryDock.getState().occupants.size > 0;
}

/** The widest maximum among the viewers open in the right-hand area, or 0 when none is. */
export function useSecondaryViewersMaxWidth(): number {
  return useSecondaryDock((state) =>
    Math.max(0, ...[...state.occupants.values()].map((occupant) => SECONDARY_VIEW_MAX_WIDTHS[occupant.size])),
  );
}

/** Close every viewer open in the right-hand area, as an outside click does. */
export function closeSecondaryViewers(): void {
  for (const { close } of [...useSecondaryDock.getState().occupants.values()]) close();
}

/**
 * Where a viewer opened from the conversation renders while `open`: the right-hand area on wide
 * screens, or null for its own full-screen modal. `onClose` lets the area dismiss the viewer, and
 * `size` caps how wide the area grows for it.
 */
export function useSecondaryViewTarget(
  open: boolean,
  onClose: () => void,
  size: SecondaryViewSize,
): HTMLElement | null {
  const target = useSecondaryDock((state) => state.target);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const docked = open && target !== null;
  useEffect(() => {
    if (!docked) return;
    const id = nextOccupantId++;
    useSecondaryDock.setState((state) => ({
      occupants: new Map(state.occupants).set(id, { close: () => onCloseRef.current(), size }),
    }));
    return () =>
      useSecondaryDock.setState((state) => {
        const occupants = new Map(state.occupants);
        occupants.delete(id);
        return { occupants };
      });
  }, [docked, size]);
  return docked ? target : null;
}

/**
 * Whether a viewer's outermost element is on top, so Escape there closes it and not a viewer or
 * modal opened above it, such as quest details opened from a link inside it. Later viewers in the
 * right-hand area stack on top of earlier ones; modals follow it in the page.
 */
export function isTopViewerLayer(element: HTMLElement): boolean {
  const area = useSecondaryDock.getState().target;
  if (area && element.parentElement === area && area.lastElementChild !== element) return false;
  return ![...document.querySelectorAll('[aria-modal="true"], dialog[open]')].some(
    (layer) =>
      !element.contains(layer) && (element.compareDocumentPosition(layer) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
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
