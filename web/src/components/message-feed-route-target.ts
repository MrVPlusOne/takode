import { messageIdFromHash, threadRouteFromHash } from "../utils/routing.js";
import type { FeedViewportPosition } from "../utils/thread-viewport.js";

export function getRouteMessageTargetForThread(normalizedThreadKey: string): string | null {
  if (typeof window === "undefined") return null;
  const routeThread = threadRouteFromHash(window.location.hash);
  if (routeThread.hasThreadParam && routeThread.threadKey !== normalizedThreadKey) return null;
  return messageIdFromHash(window.location.hash);
}

export function getSavedViewportTargetMessageId(savedViewport: FeedViewportPosition | null): string | null {
  return savedViewport?.isAtBottom ? null : (savedViewport?.anchorMessageId ?? savedViewport?.anchorTurnId ?? null);
}

export function getInitialThreadWindowTarget(
  scrollToMessageId?: string | null,
  pendingScrollToMessageId?: string | null,
  routeScrollToMessageId?: string | null,
  savedViewportTargetMessageId?: string | null,
): string | undefined {
  return (
    scrollToMessageId ?? pendingScrollToMessageId ?? routeScrollToMessageId ?? savedViewportTargetMessageId ?? undefined
  );
}
