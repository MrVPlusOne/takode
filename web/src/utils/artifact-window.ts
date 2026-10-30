import { platformIsMac } from "../shortcuts.js";

/**
 * An artifact in a window of its own, showing only that artifact, so it can stay open while the user
 * works in Takode. Opened from a card's or the Library's "Open in new window", or with Cmd-click
 * (Ctrl-click elsewhere) on an artifact, as browsers open links. The click is handled here rather
 * than left to the browser, because an installed Chrome app treats Cmd-click on its links
 * inconsistently: `window.open` with window features opens a new app window there, and a popup
 * window in the browser.
 */

const ARTIFACT_WINDOW_PREFIX = "#/artifact/";

/** The page of an artifact window: `#/artifact/<id>`, with `?v=<n>` for a version. */
export function artifactWindowHash(id: string, version?: number): string {
  return `${ARTIFACT_WINDOW_PREFIX}${encodeURIComponent(id)}${version ? `?v=${version}` : ""}`;
}

/** The artifact an artifact window's hash names, or null for any other page. */
export function parseArtifactWindowHash(hash: string): { id: string; version?: number } | null {
  if (!hash.startsWith(ARTIFACT_WINDOW_PREFIX)) return null;
  const [path, query = ""] = hash.slice(ARTIFACT_WINDOW_PREFIX.length).split("?");
  const id = decodeURIComponent(path ?? "");
  if (!id) return null;
  const version = Number(new URLSearchParams(query).get("v"));
  return { id, ...(Number.isInteger(version) && version > 0 ? { version } : {}) };
}

/** Whether a click asks for a new window: Cmd on Mac or Ctrl elsewhere, and no other key. */
export function isNewWindowClick(
  event: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean } | undefined,
): boolean {
  if (!event || event.shiftKey || event.altKey) return false;
  const mac = platformIsMac(typeof navigator === "undefined" ? undefined : navigator.platform);
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

/** The click that opens a new window, for menus and tooltips: "⌘-click" or "Ctrl-click". */
export function newWindowClickLabel(): string {
  return platformIsMac(typeof navigator === "undefined" ? undefined : navigator.platform) ? "⌘-click" : "Ctrl-click";
}

/**
 * Opens the artifact in its own window, or brings forward the one already showing it. The window
 * starts beside the current one, about as wide as a reading column.
 */
export function openArtifactWindow(target: { id: string; version?: number }): void {
  const width = Math.round(Math.min(1100, Math.max(640, window.screen.availWidth * 0.5)));
  const height = Math.round(Math.max(600, window.screen.availHeight * 0.85));
  const url = `${window.location.pathname}${window.location.search}${artifactWindowHash(target.id, target.version)}`;
  const opened = window.open(url, `takode-artifact-${target.id}`, `popup,width=${width},height=${height}`);
  opened?.focus();
}

/**
 * From an artifact window: shows a Takode page (a conversation, say) in the window it was opened
 * from, else in a new tab.
 */
export function openInMainWindow(hash: string): void {
  const opener = window.opener as Window | null;
  try {
    if (opener && !opener.closed && opener.location.origin === window.location.origin) {
      opener.location.hash = hash;
      opener.focus();
      return;
    }
  } catch (error) {
    console.warn("[artifact-window] The window this opened from can't be reached:", error);
  }
  window.open(`${window.location.pathname}${window.location.search}${hash}`, "_blank");
}

/** Whether this is an artifact window. */
export function inArtifactWindow(): boolean {
  return typeof window !== "undefined" && parseArtifactWindowHash(window.location.hash) !== null;
}
