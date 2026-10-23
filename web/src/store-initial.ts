import { isEmbeddedInVsCode } from "./utils/embed-context.js";
import { scopedGetItem } from "./utils/scoped-storage.js";
import { toNotificationSoundSetId, type NotificationSoundSetId } from "./utils/notification-sound-sets.js";

type ColorTheme = "light" | "dark" | "system";

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Whether the device or browser is set to dark mode. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/** Call `onChange` whenever the device switches between light and dark; returns the unsubscribe. */
export function watchSystemDarkMode(onChange: (dark: boolean) => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(SYSTEM_DARK_QUERY);
  const listener = (event: MediaQueryListEvent) => onChange(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function isDarkThemeLocal(theme: ColorTheme): boolean {
  return theme === "system" ? systemPrefersDark() : theme === "dark";
}

export function getInitialSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return scopedGetItem("cc-current-session") || null;
}

export function getInitialColorTheme(): ColorTheme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem("cc-color-theme");
  if (stored === "light" || stored === "dark" || stored === "system") return stored;
  // The retired VS Code theme was a dark theme, so it becomes Dark.
  if (stored === "vscode-dark") return "dark";
  const legacyDark = localStorage.getItem("cc-dark-mode");
  if (legacyDark !== null) return legacyDark === "true" ? "dark" : "light";
  // Nothing chosen yet: follow the device.
  return "system";
}

export function getInitialDarkMode(): boolean {
  return isDarkThemeLocal(getInitialColorTheme());
}

export function getInitialNotificationSound(): boolean {
  if (typeof window === "undefined") return true;
  const stored = localStorage.getItem("cc-notification-sound");
  if (stored !== null) return stored === "true";
  return true;
}

export function getInitialNotificationSoundSet(): NotificationSoundSetId {
  if (typeof window === "undefined") return toNotificationSoundSetId(null);
  return toNotificationSoundSetId(localStorage.getItem("cc-notification-sound-set"));
}

export function getInitialNotificationDesktop(): boolean {
  if (typeof window === "undefined") return false;
  const stored = localStorage.getItem("cc-notification-desktop");
  if (stored !== null) return stored === "true";
  return false;
}

export function getInitialZoomLevel(): number {
  if (typeof window === "undefined") return 0.9;
  const stored = localStorage.getItem("cc-zoom-level");
  if (stored !== null) {
    const val = parseFloat(stored);
    if (!isNaN(val) && val >= 0.2 && val <= 4.0) return val;
  }
  if (isEmbeddedInVsCode()) {
    return 0.8;
  }
  return 0.9;
}

export function getInitialCollapsedSet(key: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    return new Set(JSON.parse(scopedGetItem(key) || "[]"));
  } catch {
    return new Set();
  }
}
