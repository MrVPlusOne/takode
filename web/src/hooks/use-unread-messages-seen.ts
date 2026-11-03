import { useEffect, useRef, useState } from "react";
import type { SessionNotification } from "../types.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";

/**
 * A leader's unread answers and reports are read once they have actually been on screen, as in
 * Slack: opening a topic or a quest no longer reads everything in it. Each is read the moment its
 * beginning shows (its first line), in whichever view shows it (its quest, its topic's
 * conversation, Main, All).
 *
 * Each unread answer the view marks gets a small blue dot in the margin left of it. When the answer
 * is read the dot turns, with a short animation, into a hollow "read" ring that stays, so the user
 * sees what just got read; the rings go when the chat loses focus (another chat focused, or the
 * window losing focus). The dot takes no room, so nothing in the feed moves when it appears or goes;
 * the earlier "New" line and tags above the answer pushed the feed down (Jiayi, Nov 2).
 *
 * The marker shows what the user did not watch arrive. An answer that comes in while the view is
 * open and is read within its first seconds (`MARK_GRACE_MS`) gets none, as a reply arriving while
 * you chat in Slack gets none (Jiayi, Nov 1). One the view already had unread when it opened, or
 * when the page came back into view, is marked at once; one that arrives where the user isn't
 * looking (a chat that isn't focused, scrolled away) is marked once its grace runs out unread.
 *
 * Finished quests (their result is the Quest complete card, not the anchored message) and
 * results an agent sent still read when their thread is on screen (`readsWhenSeen`).
 *
 * It also reports the unread messages above the view, so a conversation opened at its latest
 * messages can say how many wait above and step up to them one at a time, nearest first.
 *
 * Only the focused chat reads (`focused`, see chat-focus.ts): an answer arriving in another chat
 * while the user works elsewhere stays unread (Jiayi, Oct 31). Scrolling a chat focuses it, so one
 * the user scrolls to reads as usual.
 */

const POLL_MS = 400;
/** How much of a message's start must show for it to count as seen: about its first line. */
const BEGINNING_PX = 24;
/** A message counts as on screen when this much of it shows (or half of a short one). */
const MIN_VISIBLE_PX = 160;
/**
 * How long an answer that arrives while the view is open may stay unread before it is marked: long
 * enough for one that lands on screen in the focused chat to be read first.
 */
export const MARK_GRACE_MS = 3_000;
/** Server timestamps this much older than the view count as already there when it opened. */
const ARRIVAL_CLOCK_SLACK_MS = 10_000;
/**
 * The attribute that marks an answer's element; CSS draws the dot. "true" while unread; "read" when
 * it was just read (the dot animates into a ring); "seen" for a ring put back on a re-rendered
 * element, without the animation.
 */
const MARK_ATTRIBUTE = "data-unread-answer";

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
  /** Whether the chat is the focused one: only then does a message on screen count. */
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
    const reported = new Set<string>();
    // Marked messages by message ID, unread or read. Marked elements are marked again whenever the
    // feed re-renders them (a window update can replace an element).
    const marked = new Map<string, { element: HTMLElement | null; read: boolean }>();
    const mark = (id: string, element: HTMLElement | null, state: "true" | "read" | "seen") => {
      element?.setAttribute(MARK_ATTRIBUTE, state);
      marked.set(id, { element, read: state !== "true" });
    };
    const remark = (feed: HTMLElement) => {
      const stale = [...marked].filter(([, { element }]) => !element?.isConnected).map(([id]) => id);
      if (!stale.length) return;
      const found = messageElements(feed, new Set(stale));
      for (const id of stale) mark(id, found.get(id) ?? null, marked.get(id)!.read ? "seen" : "true");
    };
    // The read rings show what was just read: they go when the chat stops being the one in use.
    let inUse = false;
    const clearReadMarks = () => {
      for (const [id, { element, read }] of marked) {
        if (!read) continue;
        element?.removeAttribute(MARK_ATTRIBUTE);
        marked.delete(id);
      }
    };
    // What the view had unread when it opened, or when the page last came back into view: marked at
    // once. Anything later arrived while the user was here, and is marked only if it stays unread
    // past its grace. The server timestamp also catches answers that were there before the view
    // opened but reached this browser after (notifications loading on a fresh page).
    let openedAt = 0;
    let atOpen: Set<string> | null = null;
    const arrivedAt = new Map<string, number>();
    const markable = (notification: SessionNotification, now: number) =>
      !reported.has(notification.id) &&
      (atOpen!.has(notification.id) ||
        notification.timestamp < openedAt - ARRIVAL_CLOCK_SLACK_MS ||
        now - (arrivedAt.get(notification.id) ?? now) >= MARK_GRACE_MS);

    const poll = () => {
      const inUseNow = document.visibilityState !== "hidden" && latest.current.focused && document.hasFocus();
      if (inUse && !inUseNow) clearReadMarks();
      inUse = inUseNow;
      if (document.visibilityState === "hidden") {
        // Coming back is like opening the view: what arrived meanwhile wasn't watched.
        atOpen = null;
        return;
      }
      const now = Date.now();
      const unread = (latest.current.notifications ?? []).filter(readsWhenSeen);
      if (!atOpen) {
        atOpen = new Set(unread.map((notification) => notification.id));
        openedAt = now;
      }
      for (const notification of unread) if (!arrivedAt.has(notification.id)) arrivedAt.set(notification.id, now);
      const feed = visibleFeed(sessionId, feedKey);
      if (!feed) return;
      remark(feed);
      // Answers read elsewhere (replying, another browser) show as read too.
      const unreadIds = new Set(unread.map((notification) => notification.messageId!));
      for (const [id, { element, read }] of marked) if (!read && !unreadIds.has(id)) mark(id, element, "read");
      if (unread.length === 0) {
        setUnreadAbove(null);
        return;
      }
      const elements = messageElements(feed, new Set(unread.map((notification) => notification.messageId!)));
      const toMark = new Set(
        unread.filter((notification) => markable(notification, now)).map((notification) => notification.messageId!),
      );
      for (const [id, element] of elements) if (toMark.has(id) && !marked.has(id)) mark(id, element, "true");
      const view = feed.getBoundingClientRect();
      const focusedNow = latest.current.focused;
      for (const notification of unread) {
        const element = elements.get(notification.messageId!);
        if (!focusedNow || !element || reported.has(notification.id) || !beginningOnScreen(element, view)) continue;
        reported.add(notification.id);
        latest.current.onSeen(notification.id);
        const markedNow = marked.get(notification.messageId!);
        if (markedNow) mark(notification.messageId!, markedNow.element, "read");
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
      for (const { element } of marked.values()) element?.removeAttribute(MARK_ATTRIBUTE);
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

/** Whether a message's beginning (about its first line) shows in the view. */
function beginningOnScreen(element: HTMLElement, view: DOMRect): boolean {
  const rect = element.getBoundingClientRect();
  return rect.top >= view.top - 1 && rect.top + Math.min(BEGINNING_PX, rect.height) <= view.bottom + 1;
}

function onScreen(element: HTMLElement, view: DOMRect): boolean {
  const rect = element.getBoundingClientRect();
  const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
  return shown > 0 && shown >= Math.min(MIN_VISIBLE_PX, rect.height * 0.5);
}
