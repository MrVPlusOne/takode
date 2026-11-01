import { useEffect, useRef, useState } from "react";
import type { SessionNotification } from "../types.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";

/**
 * A leader's unread answers and reports are read once they have actually been on screen, as in
 * Slack: opening a topic or a quest no longer reads everything in it. Each is read after its
 * message has been on screen for a second, in whichever view shows it (its quest, its topic's
 * conversation, Main, All).
 *
 * How a view marks what is unread, decided when it opens and kept until it changes: when every
 * unread answer it shows comes after the last read one (they are together at the bottom), one
 * "New" line sits above the first, as in Slack. Otherwise, as when the Scribe joined a newer thread
 * onto an older one and an earlier answer is still unread below read ones, each unread answer gets
 * its own "New" tag, since a line would say everything under it is unread (Jiayi, Nov 1).
 *
 * Finished quests (their result is the Quest complete card, not the anchored message) and
 * results an agent sent still read when their thread is on screen (`readsWhenSeen`).
 *
 * It also reports the unread messages above the view, so a conversation opened at its latest
 * messages can say how many wait above and step up to them one at a time, nearest first.
 *
 * Only the focused chat reads what arrives on screen by itself (`focused`, see chat-focus.ts). In a
 * chat that isn't focused, a message counts only once the user scrolls that chat with it on screen,
 * since scrolling is deliberate attention; an answer arriving there while the user works elsewhere
 * stays unread (Jiayi, Oct 31).
 */

/** How long a message must stay on screen to count as read. */
export const SEEN_DWELL_MS = 1_000;
const POLL_MS = 400;
/** A message counts as on screen when this much of it shows (or half of a short one). */
const MIN_VISIBLE_PX = 160;
/** How long after the user scrolls a chat that isn't focused its messages on screen start to count. */
export const SCROLL_ATTENTION_MS = 1_500;

/** Unread messages of the feed on screen that sit above the view. */
export interface UnreadAbove {
  count: number;
  /** The nearest of them: where a jump to the unread lands, skipping read messages in between. */
  next: SessionNotification;
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
  focused = true,
  inFeed,
  onSeen,
}: {
  sessionId: string;
  /** The thread key of the feed on screen (a quest, Main, All or a topic conversation). */
  feedKey: string;
  notifications: ReadonlyArray<SessionNotification> | undefined;
  enabled: boolean;
  /** Whether the chat is the focused one: only then does a message arriving on screen count. */
  focused?: boolean;
  /**
   * Whether a message of this thread (a quest, or Main) shows in the feed. Without it, nothing is
   * counted above (a feed that cannot jump to it, such as one in the side column).
   */
  inFeed?: (ownerThreadKey: string) => boolean;
  onSeen: (notificationId: string) => void;
}): UnreadAbove | null {
  const latest = useRef({ notifications, onSeen, inFeed, focused });
  latest.current = { notifications, onSeen, inFeed, focused };
  const [unreadAbove, setUnreadAbove] = useState<UnreadAbove | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const firstSeen = new Map<string, number>();
    const reported = new Set<string>();
    // How this view marks what is unread, chosen once: the "New" line above one message, or a
    // "New" tag on each unread one. Marked elements are marked again whenever the feed re-renders
    // them (a window update can replace an element).
    let marking: "line" | "tags" | null = null;
    const marked = new Map<string, HTMLElement | null>();
    const markAttribute = () => (marking === "line" ? "data-unread-start" : "data-unread-answer");
    const remark = (feed: HTMLElement) => {
      const stale = [...marked].filter(([, element]) => !element?.isConnected).map(([id]) => id);
      if (!stale.length) return;
      const found = messageElements(feed, new Set(stale));
      for (const id of stale) {
        const element = found.get(id) ?? null;
        element?.setAttribute(markAttribute(), "true");
        marked.set(id, element);
      }
    };
    const mark = (id: string, element: HTMLElement) => {
      element.setAttribute(markAttribute(), "true");
      marked.set(id, element);
    };
    // In a chat that isn't focused: when the user last scrolled it, and the messages that were on
    // screen while they did, which may then be read like any message on screen.
    let scrolledAt = 0;
    const scrolledTo = new Set<string>();
    let watched: HTMLElement | null = null;
    const noteScroll = () => {
      scrolledAt = Date.now();
    };
    const noteScrollbarPress = (event: Event) => {
      if (event.target === watched) noteScroll();
    };
    const watch = (feed: HTMLElement) => {
      if (watched === feed) return;
      unwatch();
      watched = feed;
      feed.addEventListener("wheel", noteScroll, { passive: true });
      feed.addEventListener("touchmove", noteScroll, { passive: true });
      feed.addEventListener("pointerdown", noteScrollbarPress);
    };
    const unwatch = () => {
      watched?.removeEventListener("wheel", noteScroll);
      watched?.removeEventListener("touchmove", noteScroll);
      watched?.removeEventListener("pointerdown", noteScrollbarPress);
      watched = null;
    };

    const poll = () => {
      if (document.visibilityState === "hidden") {
        firstSeen.clear();
        return;
      }
      const unread = (latest.current.notifications ?? []).filter(readsWhenSeen);
      const feed = visibleFeed(sessionId, feedKey);
      if (!feed) return;
      watch(feed);
      remark(feed);
      if (unread.length === 0) {
        setUnreadAbove(null);
        return;
      }
      const elements = messageElements(feed, new Set(unread.map((notification) => notification.messageId!)));
      if (!marking && elements.size > 0) {
        marking = unreadTogetherAtBottom(feed, latest.current.notifications ?? []) ? "line" : "tags";
        // The line sits above the first unread message this view shows: the reader starts there.
        if (marking === "line") {
          const [id, element] = elements.entries().next().value!;
          mark(id, element);
        }
      }
      if (marking === "tags") {
        // Each unread answer keeps its tag for the view, also after it is read on screen.
        for (const notification of unread) {
          const element = elements.get(notification.messageId!);
          if (element && !reported.has(notification.id) && !marked.has(notification.messageId!))
            mark(notification.messageId!, element);
        }
      }
      const now = Date.now();
      const view = feed.getBoundingClientRect();
      const focusedNow = latest.current.focused;
      const scrolling = now - scrolledAt < SCROLL_ATTENTION_MS;
      for (const notification of unread) {
        const element = elements.get(notification.messageId!);
        if (!element || reported.has(notification.id) || !onScreen(element, view)) {
          firstSeen.delete(notification.id);
          continue;
        }
        if (!focusedNow) {
          if (scrolling) scrolledTo.add(notification.id);
          if (!scrolledTo.has(notification.id)) {
            firstSeen.delete(notification.id);
            continue;
          }
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
        current?.count === above?.count && current?.next.id === above?.next.id ? current : above,
      );
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      clearInterval(timer);
      unwatch();
      for (const element of marked.values()) element?.removeAttribute(markAttribute());
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
    });
  if (!above.length) return null;
  // The nearest: the lowest loaded one, else (all above the loaded window) the newest.
  const loaded = above.filter((notification) => elements.has(notification.messageId!));
  const next = loaded.length
    ? loaded.reduce((a, b) =>
        elements.get(a.messageId!)!.getBoundingClientRect().top >=
        elements.get(b.messageId!)!.getBoundingClientRect().top
          ? a
          : b,
      )
    : above.reduce((a, b) => (a.timestamp >= b.timestamp ? a : b));
  return { count: above.length, next };
}

/**
 * Whether the unread answers a feed shows all come after its read ones, in feed order: then one
 * line above the first says it. Only answers and reports with a message count; a read one below
 * an unread one (a joined thread's, say) means they are not together.
 */
function unreadTogetherAtBottom(feed: HTMLElement, notifications: ReadonlyArray<SessionNotification>): boolean {
  const answers = notifications.filter(
    (notification) =>
      notification.category === "review" &&
      !!notification.messageId &&
      (notification.unreadReason === "answer" || notification.unreadReason === "report"),
  );
  const unreadIds = new Set(answers.filter((notification) => !notification.done).map((n) => n.messageId!));
  let sawUnread = false;
  // messageElements returns the feed's elements in document (feed) order.
  for (const id of messageElements(feed, new Set(answers.map((notification) => notification.messageId!))).keys()) {
    if (unreadIds.has(id)) sawUnread = true;
    else if (sawUnread) return false;
  }
  return true;
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
