import { useStore } from "../store.js";
import { parseHash, resolveSessionIdFromRoute, threadRouteFromHash } from "./routing.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import { readLeaderSelectedThreadKey, requestThreadViewportSnapshot } from "./thread-viewport.js";
import { noteViewportSelectionActivity } from "./viewport-handoff-client.js";

interface ViewportRouteIdentity {
  sessionId: string;
  threadKey: string;
}

export function resolveViewportRouteIdentity(hash: string): ViewportRouteIdentity | null {
  const route = parseHash(hash);
  if (route.page !== "session") return null;
  const storeState = typeof useStore.getState === "function" ? useStore.getState() : null;
  const sessionId = resolveSessionIdFromRoute(route.sessionId, storeState?.sdkSessions ?? []);
  if (!sessionId) return null;
  const threadRoute = threadRouteFromHash(hash);
  const effectiveThreadKey = threadRoute.hasThreadParam
    ? threadRoute.threadKey
    : readLeaderSelectedThreadKey(sessionId);
  return {
    sessionId,
    threadKey: normalizeThreadKey(effectiveThreadKey ?? MAIN_THREAD_KEY),
  };
}

export function requestViewportHandoffForRouteDeparture(previousHash: string, nextHash: string): void {
  const previous = resolveViewportRouteIdentity(previousHash);
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
