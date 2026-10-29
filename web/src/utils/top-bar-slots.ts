import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useStore } from "../store.js";
import { useLeaderTopicsOn } from "./leader-topics.js";

/**
 * A leader with Library topics on navigates by breadcrumb, on desktop and phones alike: no tab row,
 * the place and quest pickers at the start of the strip under the top bar, and the Working on picker
 * (which holds the work board) in the top bar before the attention bell. The conversation on screen
 * fills the top bar's helpers place.
 */
export function useLeaderBreadcrumb(sessionId: string | null | undefined): boolean {
  const isLeader = useStore(
    (state) =>
      !!sessionId && state.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator),
  );
  const topicsOn = useLeaderTopicsOn(sessionId ?? "");
  return isLeader && topicsOn;
}

type TopBarSlot = "helpers";
const slots: Record<TopBarSlot, HTMLElement | null> = { helpers: null };
const listeners = new Set<() => void>();
let shownSessionId: string | null = null;

function setSlot(name: TopBarSlot, element: HTMLElement | null) {
  if (slots[name] === element) return;
  slots[name] = element;
  for (const listener of listeners) listener();
}

/** A stable ref callback for the top bar's helpers place. */
export const topBarHelpersRef = (element: HTMLElement | null) => setSlot("helpers", element);

/**
 * Shows only this session's parts of the top bar. Recently viewed conversations stay mounted while
 * hidden (React Activity), and a hidden one does not re-render to remove what it put in the top bar,
 * so each conversation draws into its own box there and the top bar, which is never hidden, decides
 * which box shows. The top bar calls this whenever the session on screen changes.
 */
export function showTopBarSession(sessionId: string | null): void {
  shownSessionId = sessionId;
  for (const slot of Object.values(slots)) {
    for (const box of slot?.children ?? []) showBox(box as HTMLElement);
  }
}

function showBox(box: HTMLElement) {
  box.style.display = box.dataset.session === shownSessionId ? "contents" : "none";
}

/** A conversation's own box in one of the top bar's places, once the top bar has drawn it. */
export function useTopBarSlot(name: TopBarSlot, sessionId: string | null): HTMLElement | null {
  const slot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slots[name],
    () => null,
  );
  const box = useMemo(() => {
    if (!slot || !sessionId) return null;
    const existing = [...slot.children].find((child) => (child as HTMLElement).dataset.session === sessionId);
    if (existing) return existing as HTMLElement;
    const created = document.createElement("div");
    created.dataset.session = sessionId;
    showBox(created);
    slot.appendChild(created);
    return created;
  }, [slot, sessionId]);
  // A hidden kept conversation's effects are torn down, so its box leaves the top bar with them,
  // and comes back when it is shown again.
  useEffect(() => {
    if (!box || !slot) return;
    if (!box.isConnected) slot.appendChild(box);
    showBox(box);
    return () => box.remove();
  }, [box, slot]);
  return box;
}
