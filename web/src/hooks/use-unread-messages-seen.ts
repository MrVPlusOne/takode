import { useEffect, useRef, useState } from "react";
import type { SessionNotification } from "../types.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";

/**
 * A leader's unread answers and reports are read once they have actually been on screen, as in
 * Slack: opening a topic or a quest no longer reads everything in it. Each is read after its
 * message has been on screen for a second, in whichever view shows it (its quest, its topic's
 * conversation, Main, All). The first unread message on screen when a view opens gets a "New"
 * line above it, which stays until the view changes.
 *
 * Finished quests (their result is the Quest complete card, not the anchored message) and
 * results an agent sent still read when their thread is on screen (`readsWhenSeen`).
 *
 * It also reports the unread messages above the view, so a conversation opened at its latest
 * messages can say how many wait above and jump to the first one.
 */

/** How long a message must stay on screen to count as read. */
export const SEEN_DWELL_MS = 1_000;
const POLL_MS = 400;
/** A message counts as on screen when this much of it shows (or half of a short one). */
const MIN_VISIBLE_PX = 160;

/** Unread messages of the feed on screen that sit above the view, oldest first. */
export interface UnreadAbove {
  count: number;
  /** The oldest of them: where a jump to the unread lands. */
  first: SessionNotification;
}

/** Whether a notification is read by seeing its message rather than by opening its thread. */
export function readsWhenSeen(notification: SessionNotification): boolean {
  return (
    notification.category === "review" &&
    !notification.done &&
    !!notification.messageId &&
    (notification.unreadReason === "answer" || notification.unreadReason === "report")
  );
}

export function useUnreadMessagesSeen({
  sessionId,
  feedKey,
  notifications,
  enabled,
  inFeed,
  onSeen,
}: {
  sessionId: string;
  /** The thread key of the feed on screen (a quest, Main, All or a topic conversation). */
  feedKey: string;
  notifications: ReadonlyArray<SessionNotification> | undefined;
  enabled: boolean;
  /**
   * Whether a message of this thread (a quest, or Main) shows in the feed. Without it, nothing is
   * counted above (a feed that cannot jump to it, such as one in the side column).
   */
  inFeed?: (ownerThreadKey: string) => boolean;
  onSeen: (notificationId: string) => void;
}): UnreadAbove | null {
  const latest = useRef({ notifications, onSeen, inFeed });
  latest.current = { notifications, onSeen, inFeed };
  const [unreadAbove, setUnreadAbove] = useState<UnreadAbove | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const firstSeen = new Map<string, number>();
    const reported = new Set<string>();
    // The message the "New" line sits above, chosen once per view; its element is marked again
    // whenever the feed re-renders it (a window update can replace the element).
    let newLineMessageId: string | null = null;
    let newLine: HTMLElement | null = null;

    const poll = () => {
      if (document.visibilityState === "hidden") {
        firstSeen.clear();
        return;
      }
      const unread = (latest.current.notifications ?? []).filter(readsWhenSeen);
      const feed = visibleFeed(sessionId, feedKey);
      if (!feed) return;
      if (newLineMessageId && !newLine?.isConnected) {
        newLine = messageElements(feed, new Set([newLineMessageId])).get(newLineMessageId) ?? null;
        newLine?.setAttribute("data-unread-start", "true");
      }
      if (unread.length === 0) {
        setUnreadAbove(null);
        return;
      }
      const elements = messageElements(feed, new Set(unread.map((notification) => notification.messageId!)));
      if (!newLineMessageId && elements.size > 0) {
        // The oldest unread message this view shows: the reader starts there.
        const oldest = [...unread]
          .sort((a, b) => a.timestamp - b.timestamp)
          .find((notification) => elements.has(notification.messageId!));
        newLineMessageId = oldest?.messageId ?? null;
        newLine = newLineMessageId ? (elements.get(newLineMessageId) ?? null) : null;
        newLine?.setAttribute("data-unread-start", "true");
      }
      const now = Date.now();
      const view = feed.getBoundingClientRect();
      for (const notification of unread) {
        const element = elements.get(notification.messageId!);
        if (!element || reported.has(notification.id) || !onScreen(element, view)) {
          firstSeen.delete(notification.id);
          continue;
        }
        const since = firstSeen.get(notification.id) ?? now;
        firstSeen.set(notification.id, since);
        if (now - since < SEEN_DWELL_MS) continue;
        reported.add(notification.id);
        latest.current.onSeen(notification.id);
      }
      const unseen = unread.filter((notification) => !reported.has(notification.id));
      const inFeed = latest.current.inFeed;
      const above = inFeed ? findUnreadAbove(feed, view, elements, unseen, inFeed) : null;
      setUnreadAbove((current) =>
        current?.count === above?.count && current?.first.id === above?.first.id ? current : above,
      );
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(timer);
      newLine?.removeAttribute("data-unread-start");
      setUnreadAbove(null);
    };
  }, [enabled, feedKey, sessionId]);

  return unreadAbove;
}

function findUnreadAbove(
  feed: HTMLElement,
  view: DOMRect,
  elements: Map<string, HTMLElement>,
  unread: SessionNotification[],
  inFeed: (ownerThreadKey: string) => boolean,
): UnreadAbove | null {
  // A message not in the loaded window is older than it, unless a newer section is unloaded.
  const newerUnloaded = feed.dataset.feedHasNewer === "true";
  const above = unread
    .filter((notification) => inFeed(resolveNotificationOwnerThreadKey(notification)))
    .filter((notification) => {
      const element = elements.get(notification.messageId!);
      if (!element) return !newerUnloaded;
      return !onScreen(element, view) && element.getBoundingClientRect().top < view.top;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
  return above.length > 0 ? { count: above.length, first: above[0]! } : null;
}

function visibleFeed(sessionId: string, feedKey: string): HTMLElement | null {
  const key = feedKey.toLowerCase();
  for (const feed of document.querySelectorAll<HTMLElement>('[data-testid="message-feed-scroll-container"]')) {
    if (feed.dataset.feedSessionId === sessionId && feed.dataset.feedThreadKey?.toLowerCase() === key) {
      if (feed.offsetParent || feed.getClientRects().length > 0) return feed;
    }
  }
  return null;
}

/** The feed's elements for these message IDs (the first element of each). */
function messageElements(feed: HTMLElement, ids: ReadonlySet<string>): Map<string, HTMLElement> {
  const found = new Map<string, HTMLElement>();
  for (const element of feed.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const id = element.dataset.messageId;
    if (id && ids.has(id) && !found.has(id)) found.set(id, element);
  }
  return found;
}

function onScreen(element: HTMLElement, view: DOMRect): boolean {
  const rect = element.getBoundingClientRect();
  const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
  return shown > 0 && shown >= Math.min(MIN_VISIBLE_PX, rect.height * 0.5);
}
