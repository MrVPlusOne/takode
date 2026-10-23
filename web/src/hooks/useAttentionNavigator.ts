import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "../api.js";
import { openNotifyMeEntry } from "../components/NotifyMe.js";
import { useStore } from "../store.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import {
  attentionCursorFor,
  pickAttentionAfter,
  type AttentionCursor,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import { firstUnreadResult, navigateToNotification, resultLanding } from "../utils/notification-navigation.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import {
  navigateToSession,
  navigateToSessionMessageId,
  navigateToSessionThread,
  parseHash,
  routeSessionRefForId,
  threadRouteFromHash,
  type Route,
} from "../utils/routing.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";

export interface NextAttentionLanding {
  item: NextAttentionItem;
  sessionNum: number | null;
  /** 1-based position of the opened item in the queue. */
  position: number;
  total: number;
}

export interface AttentionNavigator {
  /** The item the next step opens, with its 0-based position; null when the queue is empty. */
  next: { item: NextAttentionItem; position: number } | null;
  /** Open the next item and say where it landed. */
  goNext: () => NextAttentionLanding | null;
  /**
   * Where the next step would land, without opening it, leaving out items
   * `skip` rejects (position and total then count only the rest).
   */
  peekNext: (skip?: (item: NextAttentionItem) => boolean) => NextAttentionLanding | null;
  /** Open one item; later steps continue after it. */
  open: (item: NextAttentionItem) => void;
}

// Cursors live outside React so they survive remounts: switching threads
// remounts the feed chip, and the top bar has separate phone and desktop
// mounts. Keys are "global" or "session:<id>".
const cursors = new Map<string, AttentionCursor>();
const listeners = new Set<() => void>();

function subscribeCursors(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setCursor(scope: string, cursor: AttentionCursor) {
  cursors.set(scope, cursor);
  for (const listener of listeners) listener();
}

/** Forget every navigator position. Tests only. */
export function resetAttentionCursorsForTest() {
  cursors.clear();
}

/**
 * Step through `queue` from a remembered position. Each step opens the item
 * after the last one opened in this scope, walking into lower-priority groups
 * and wrapping at the end (see `pickAttentionAfter`). With `navigate: false`
 * steps only move the position, for the Playground.
 */
export function useAttentionNavigator(
  scope: string,
  queue: readonly NextAttentionItem[],
  { navigate = true }: { navigate?: boolean } = {},
): AttentionNavigator {
  const cursor = useSyncExternalStore(subscribeCursors, () => cursors.get(scope) ?? null);
  const next = useMemo(() => pickAttentionAfter(queue, cursor), [cursor, queue]);

  const open = useCallback(
    (item: NextAttentionItem) => {
      setCursor(scope, attentionCursorFor(item));
      if (navigate) openAttentionItem(item, useStore.getState().sdkSessions);
    },
    [navigate, scope],
  );

  const peekNext = useCallback(
    (skip?: (item: NextAttentionItem) => boolean): NextAttentionLanding | null => {
      const walked = skip ? queue.filter((item) => !skip(item)) : queue;
      const step = pickAttentionAfter(walked, cursors.get(scope) ?? null);
      if (!step) return null;
      const sessionNum =
        useStore.getState().sdkSessions.find((session) => session.sessionId === step.item.sessionId)?.sessionNum ??
        null;
      return { item: step.item, sessionNum, position: step.position + 1, total: walked.length };
    },
    [queue, scope],
  );

  const goNext = useCallback((): NextAttentionLanding | null => {
    const landing = peekNext();
    if (landing) open(landing.item);
    return landing;
  }, [open, peekNext]);

  return { next, goNext, peekNext, open };
}

/**
 * Open an attention item. Unread threads open at their first unread result, scrolled to and
 * flashed; when this browser hasn't loaded the session's notifications yet, the thread opens at
 * once and moves to that result when they arrive. Main keeps an explicit thread route: without
 * it, a leader session restores the thread it was showing instead of Main.
 */
export function openAttentionItem(item: NextAttentionItem, sdkSessions: SdkSessionInfo[]) {
  if (item.kind === "needs-input") {
    navigateToNotification(item.sessionId, item.entry.notification, sdkSessions);
    return;
  }
  if (item.kind === "notify-me") {
    openNotifyMeEntry(item.entry, sdkSessions);
    return;
  }
  const { sessionId, threadKey } = item;
  if (threadKey) {
    const inThread = (notification: SessionNotification) =>
      resolveNotificationOwnerThreadKey(notification) === threadKey;
    const known = useStore.getState().sessionNotifications?.get(sessionId);
    const result = firstUnreadResult(known, inThread);
    if (result) {
      navigateToNotification(sessionId, result, sdkSessions);
      return;
    }
    const routeSessionId = routeSessionRefForId(sessionId, sdkSessions);
    navigateToSessionThread(sessionId, threadKey, false, routeSessionId, { preserveMainThreadRoute: true });
    if (known) return;
    const openedRoute = parseHash(window.location.hash);
    api
      .getSessionNotifications(sessionId, { visible: true })
      .then((notifications) => {
        const loaded = firstUnreadResult(notifications, inThread);
        // Only while the thread just opened is still on screen as it was: never pull the user back.
        if (!loaded?.messageId || !stillShowsThread(openedRoute, threadKey)) return;
        navigateToSessionMessageId(sessionId, loaded.messageId, {
          replace: true,
          routeSessionId,
          threadKey,
          preserveMainThreadRoute: true,
          landing: resultLanding(loaded),
        });
      })
      .catch(() => {});
    return;
  }
  // Same as choosing the session in the sidebar: opening it reads its unread result.
  api.markSessionRead?.(sessionId, { mode: "session-view" }).catch(() => {});
  navigateToSession(sessionId);
}

/** Whether the view is still the thread just opened: same session and thread, no message jump since. */
function stillShowsThread(openedRoute: Route, threadKey: string): boolean {
  const route = parseHash(window.location.hash);
  if (route.page !== "session" || openedRoute.page !== "session") return false;
  if (route.sessionId !== openedRoute.sessionId || route.messageId || route.messageIndex != null) return false;
  // Main's canonical route has no thread param.
  return (threadRouteFromHash(window.location.hash).threadKey ?? MAIN_THREAD_KEY) === threadKey;
}
