import { messageIdFromHash, threadRouteFromHash } from "../utils/routing.js";

export function getRouteMessageTargetForThread(normalizedThreadKey: string): string | null {
  if (typeof window === "undefined") return null;
  const routeThread = threadRouteFromHash(window.location.hash);
  if (routeThread.hasThreadParam && routeThread.threadKey !== normalizedThreadKey) return null;
  return messageIdFromHash(window.location.hash);
}
