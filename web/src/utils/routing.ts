import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";

export type Route =
  | { page: "home" }
  | { page: "session"; sessionId: string }
  | { page: "settings" }
  | { page: "terminal" }
  | { page: "environments" }
  | { page: "scheduled" }
  | { page: "playground" };

const SESSION_PREFIX = "#/session/";

/**
 * Parse a window.location.hash string into a typed Route.
 */
export function parseHash(hash: string): Route {
  if (hash === "#/settings") return { page: "settings" };
  if (hash === "#/terminal") return { page: "terminal" };
  if (hash === "#/environments") return { page: "environments" };
  if (hash === "#/scheduled") return { page: "scheduled" };
  if (hash === "#/playground") return { page: "playground" };

  if (hash.startsWith(SESSION_PREFIX)) {
    const sessionId = hash.slice(SESSION_PREFIX.length);
    if (sessionId) return { page: "session", sessionId };
  }

  return { page: "home" };
}

/**
 * Build a hash string for a given session ID.
 */
export function sessionHash(sessionId: string): string {
  return `#/session/${sessionId}`;
}

/**
 * Navigate to a session by updating the URL hash.
 * When replace=true, uses replaceState to avoid creating a history entry.
 */
export function navigateToSession(sessionId: string, replace = false): void {
  const newHash = sessionHash(sessionId);
  if (replace) {
    history.replaceState(null, "", newHash);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = `/session/${sessionId}`;
  }
}

/**
 * Navigate to the home page (no session selected) by clearing the hash.
 * When replace=true, uses replaceState to avoid creating a history entry.
 */
export function navigateHome(replace = false): void {
  if (replace) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.hash = "";
  }
}

/**
 * Navigate to the most recent non-archived, non-cron session.
 * If excludeId is provided, skip that session (used when deleting/archiving).
 * Falls back to navigateHome() if no sessions are available.
 * Returns true if navigated to a session, false if fell back to home.
 */
export function navigateToMostRecentSession(
  options: { excludeId?: string; replace?: boolean } = {},
): boolean {
  const { excludeId, replace = false } = options;
  const candidates = (useStore.getState().sdkSessions as SdkSessionInfo[])
    .filter((s) => !s.archived && !s.cronJobId && s.sessionId !== excludeId)
    .sort((a, b) => b.createdAt - a.createdAt);

  if (candidates.length > 0) {
    navigateToSession(candidates[0].sessionId, replace);
    return true;
  }
  navigateHome(replace);
  return false;
}
