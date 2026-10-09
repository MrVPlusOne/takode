import { useSyncExternalStore } from "react";
import { useStore } from "../store.js";
import { isDesktopShellLayout } from "../utils/layout.js";

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * Whether the app shows the desktop shell (inline sidebar) or the phone shell
 * (overlay sidebar), kept current across resizes and zoom changes. The phone
 * top bar and the sessions-panel shortcut tiles both follow this one rule, so
 * an action is never missing from both places.
 */
export function useDesktopShellLayout(): boolean {
  const zoomLevel = useStore((s) => s.zoomLevel ?? 1);
  return useSyncExternalStore(subscribeResize, () => isDesktopShellLayout(zoomLevel));
}
