import { useCallback, useMemo, useSyncExternalStore } from "react";
import { api } from "../api.js";
import { openNotifyMeEntry } from "../components/GlobalNotifyMeMenu.js";
import { useStore } from "../store.js";
import type { SdkSessionInfo } from "../types.js";
import {
  attentionCursorFor,
  pickAttentionAfter,
  type AttentionCursor,
  type NextAttentionItem,
} from "../utils/next-attention.js";
import { navigateToNotification } from "../utils/notification-navigation.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { navigateToSession, navigateToSessionThread, routeSessionRefForId } from "../utils/routing.js";

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

  const goNext = useCallback((): NextAttentionLanding | null => {
    const step = pickAttentionAfter(queue, cursors.get(scope) ?? null);
    if (!step) return null;
    open(step.item);
    const sessionNum =
      useStore.getState().sdkSessions.find((session) => session.sessionId === step.item.sessionId)?.sessionNum ?? null;
    return { item: step.item, sessionNum, position: step.position + 1, total: queue.length };
  }, [open, queue, scope]);

  return { next, goNext, open };
}

/**
 * Open an attention item. Unread threads open at their newest Ready result
 * when this browser knows it, so the result is scrolled to and flashed;
 * otherwise they open the thread. Main keeps an explicit thread route: without
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
  if (item.threadKey) {
    const result = newestReadyResult(item.sessionId, item.threadKey);
    if (result) {
      navigateToNotification(item.sessionId, result, sdkSessions);
      return;
    }
    navigateToSessionThread(item.sessionId, item.threadKey, false, routeSessionRefForId(item.sessionId, sdkSessions), {
      preserveMainThreadRoute: true,
    });
    return;
  }
  // Same as choosing the session in the sidebar: opening it reads its unread result.
  api.markSessionRead?.(item.sessionId, { mode: "session-view" }).catch(() => {});
  navigateToSession(item.sessionId);
}

function newestReadyResult(sessionId: string, threadKey: string) {
  let newest = null;
  for (const notification of useStore.getState().sessionNotifications?.get(sessionId) ?? []) {
    if (notification.category !== "review" || notification.done || !notification.messageId) continue;
    if (resolveNotificationOwnerThreadKey(notification) !== threadKey) continue;
    if (!newest || notification.timestamp > newest.timestamp) newest = notification;
  }
  return newest;
}
