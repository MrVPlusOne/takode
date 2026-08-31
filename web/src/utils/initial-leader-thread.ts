import { shouldPersistLeaderThreadTab, type LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";
import { readLeaderSelectedThreadKey } from "./thread-viewport.js";

export function resolveInitialLeaderThreadKey({
  sessionId,
  isLeaderSession,
  hasThreadRoute,
  routeThreadKey,
  leaderOpenThreadTabs,
}: {
  sessionId: string;
  isLeaderSession: boolean;
  hasThreadRoute?: boolean;
  routeThreadKey?: string | null;
  leaderOpenThreadTabs: LeaderOpenThreadTabsState | undefined;
}): string {
  if (!isLeaderSession) return MAIN_THREAD_KEY;
  if (hasThreadRoute) {
    if (!routeThreadKey) return MAIN_THREAD_KEY;
    const normalizedRouteThreadKey = normalizeThreadKey(routeThreadKey);
    if (normalizedRouteThreadKey === MAIN_THREAD_KEY || normalizedRouteThreadKey === ALL_THREADS_KEY) {
      return normalizedRouteThreadKey;
    }
    return shouldPersistLeaderThreadTab(normalizedRouteThreadKey) ? normalizedRouteThreadKey : MAIN_THREAD_KEY;
  }

  const restoredThreadKey = readLeaderSelectedThreadKey(sessionId);
  if (!restoredThreadKey) return MAIN_THREAD_KEY;
  const normalizedRestoredThreadKey = normalizeThreadKey(restoredThreadKey);
  if (normalizedRestoredThreadKey === MAIN_THREAD_KEY || normalizedRestoredThreadKey === ALL_THREADS_KEY) {
    return normalizedRestoredThreadKey;
  }
  if (!shouldPersistLeaderThreadTab(normalizedRestoredThreadKey)) return MAIN_THREAD_KEY;
  if (leaderOpenThreadTabs && !leaderOpenThreadTabs.orderedOpenThreadKeys.includes(normalizedRestoredThreadKey)) {
    return MAIN_THREAD_KEY;
  }
  return normalizedRestoredThreadKey;
}
