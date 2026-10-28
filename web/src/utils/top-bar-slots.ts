import { useSyncExternalStore } from "react";
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

function setSlot(name: TopBarSlot, element: HTMLElement | null) {
  if (slots[name] === element) return;
  slots[name] = element;
  for (const listener of listeners) listener();
}

/** Stable ref callbacks for the top bar's two places. */
export const topBarNavRef = (element: HTMLElement | null) => setSlot("nav", element);
export const topBarHelpersRef = (element: HTMLElement | null) => setSlot("helpers", element);

/** The top bar's place for the conversation's navigation or helpers, once the top bar has drawn it. */
export function useTopBarSlot(name: TopBarSlot): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => slots[name],
    () => null,
  );
}
