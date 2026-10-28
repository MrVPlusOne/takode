import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { useStore } from "../store.js";
import { useLeaderTopicsOn } from "./leader-topics.js";

/**
 * On desktop, a leader with Library topics on keeps its thread navigation in the top bar instead
 * of a tab row of its own: Main | All and Topics after the session name, and the Next chip and the
 * Working on menu (which holds the work board) before the attention bell. The conversation on
 * screen fills these two places of the top bar; phones keep the tab row.
 */
export function useLeaderNavInTopBar(sessionId: string | null | undefined): boolean {
  const desktop = useDesktopShellLayout();
  const isLeader = useStore(
    (state) =>
      !!sessionId && state.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator),
  );
  const topicsOn = useLeaderTopicsOn(sessionId ?? "");
  return desktop && isLeader && topicsOn;
}

type TopBarSlot = "nav" | "helpers";
const slots: Record<TopBarSlot, HTMLElement | null> = { nav: null, helpers: null };
const listeners = new Set<() => void>();
let shownSessionId: string | null = null;

function setSlot(name: TopBarSlot, element: HTMLElement | null) {
  if (slots[name] === element) return;
  slots[name] = element;
  for (const listener of listeners) listener();
}

/** Stable ref callbacks for the top bar's two places. */
export const topBarNavRef = (element: HTMLElement | null) => setSlot("nav", element);
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
export function useTopBarSlot(name: TopBarSlot, sessionId: string): HTMLElement | null {
  const slot = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slots[name],
    () => null,
  );
  const box = useMemo(() => {
    if (!slot) return null;
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
