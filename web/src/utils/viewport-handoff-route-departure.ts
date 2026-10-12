import { useStore } from "../store.js";
import { parseHash, resolveSessionIdFromRoute, threadRouteFromHash } from "./routing.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import {
  readDisplayedLeaderThreadKey,
  readLeaderSelectedThreadKey,
  requestThreadViewportSnapshot,
} from "./thread-viewport.js";
import { noteViewportSelectionActivity } from "./viewport-handoff-client.js";

interface ViewportRouteIdentity {
  sessionId: string;
  threadKey: string;
}

/** A bare route (no thread param) names no thread; `readBareRouteThread` supplies it. */
export function resolveViewportRouteIdentity(
  hash: string,
  readBareRouteThread: (sessionId: string) => string | null = readLeaderSelectedThreadKey,
): ViewportRouteIdentity | null {
  const route = parseHash(hash);
  if (route.page !== "session") return null;
  const storeState = typeof useStore.getState === "function" ? useStore.getState() : null;
  const sessionId = resolveSessionIdFromRoute(route.sessionId, storeState?.sdkSessions ?? []);
  if (!sessionId) return null;
  const threadRoute = threadRouteFromHash(hash);
  const effectiveThreadKey = threadRoute.hasThreadParam ? threadRoute.threadKey : readBareRouteThread(sessionId);
  return {
    sessionId,
    threadKey: normalizeThreadKey(effectiveThreadKey ?? MAIN_THREAD_KEY),
  };
}

export function requestViewportHandoffForRouteDeparture(previousHash: string, nextHash: string): void {
  // The route being left shows the thread still on screen, which the saved
  // selection can lag behind; the destination is the selection just made.
  const previous = resolveViewportRouteIdentity(
    previousHash,
    (sessionId) => readDisplayedLeaderThreadKey(sessionId) ?? readLeaderSelectedThreadKey(sessionId),
  );
  if (!previous) return;
  const next = resolveViewportRouteIdentity(nextHash);
  if (next && next.sessionId === previous.sessionId && next.threadKey === previous.threadKey) return;
  if (next?.sessionId === previous.sessionId) {
    noteViewportSelectionActivity(previous.sessionId, next.threadKey);
  }
  void requestThreadViewportSnapshot(previous.sessionId, {
    threadKey: previous.threadKey,
    selectedThreadKey: next?.sessionId === previous.sessionId ? next.threadKey : previous.threadKey,
    publishHandoff: true,
    keepalive: true,
    reason: next?.sessionId === previous.sessionId ? "thread-departure" : "session-departure",
  });
}
