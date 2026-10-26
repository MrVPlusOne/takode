/**
 * Zooming between a quest and its topic conversation, which shows the quest's messages among its
 * topic's other quests. The reader keeps their place: the message at the top of the view before
 * the zoom lands at the same height after it (or, zooming into a quest from its strip in the
 * topic, that part's first message on screen). A short scale of the view shows which way it went:
 * zooming in grows from the tapped strip, zooming out recedes toward the header.
 *
 * The anchor waits here until the new feed is on screen, then goes out as an ordinary jump to a
 * message (`requestScrollToMessage`), which loads the message's window when needed; the jump
 * reads its placement from `takeZoomPlacement` instead of centering and flashing the message.
 */
import { useStore } from "../store.js";

export type ZoomDirection = "in" | "out";

interface ZoomAnchor {
  sessionId: string;
  /** The thread key of the feed the zoom lands in. */
  feedKey: string;
  messageId: string | null;
  /** The message's distance from the top of the feed, in layout pixels. */
  offsetTop: number;
  direction: ZoomDirection;
  /** Where the view scales from, as a share of the column's height. */
  originY: number;
}

let pending: ZoomAnchor | null = null;
const placements = new Map<string, number>();

const ZOOM_MS = 320;
const ZOOM_EASING = "cubic-bezier(0.2, 0.7, 0.2, 1)";
/** A message picked below the top of a strip-tapped part lands this far under the header. */
const DEFAULT_OFFSET = 48;

/**
 * Notes a zoom into the feed of `toKey` before navigating there. With `from`, the reader's place
 * goes along: the first message on screen in the visible feed of `from.feedKey`, or with
 * `from.part` (a quest strip in a topic conversation) the first of that part's messages on screen,
 * else its first message. Without it, the new feed opens where it would anyway.
 */
export function prepareZoom(
  sessionId: string,
  toKey: string,
  direction: ZoomDirection,
  from?: { feedKey: string; part?: HTMLElement | null },
): void {
  const container = from ? visibleFeed(sessionId, from.feedKey) : null;
  const part = from?.part ?? null;
  const top = container?.getBoundingClientRect().top ?? 0;
  const scale = container?.offsetHeight ? container.getBoundingClientRect().height / container.offsetHeight : 1;
  const candidates = container ? messagesOf(container, part) : [];
  const onScreen = candidates.find((element) => element.getBoundingClientRect().bottom > top + 4);
  const anchor = onScreen ?? candidates[0] ?? null;
  const columnRect = container?.parentElement?.getBoundingClientRect();
  const partTop = part?.getBoundingClientRect().top;
  pending = {
    sessionId,
    feedKey: toKey.toLowerCase(),
    messageId: anchor?.dataset.messageId ?? null,
    offsetTop:
      onScreen && anchor ? Math.max(0, (anchor.getBoundingClientRect().top - top) / (scale || 1)) : DEFAULT_OFFSET,
    direction,
    originY:
      columnRect?.height && partTop !== undefined
        ? Math.min(1, Math.max(0, (partTop - columnRect.top) / columnRect.height))
        : 0,
  };
}

/**
 * Once the feed of `feedKey` is on screen: lands the prepared zoom there and plays it on
 * `column`. Does nothing unless a zoom into this feed was prepared.
 */
export function landZoom(sessionId: string, feedKey: string, column: HTMLElement | null): void {
  const zoom = pending;
  if (!zoom || zoom.sessionId !== sessionId || zoom.feedKey !== feedKey.toLowerCase()) return;
  pending = null;
  if (zoom.messageId) {
    placements.set(zoom.messageId, zoom.offsetTop);
    useStore.getState().requestScrollToMessage(sessionId, zoom.messageId);
  }
  playZoom(column, zoom.direction, zoom.originY);
}

/** The height a zoom's jump places `messageId` at, once; null for any other jump. */
export function takeZoomPlacement(messageId: string): number | null {
  const offset = placements.get(messageId);
  if (offset === undefined) return null;
  placements.delete(messageId);
  return offset;
}

function playZoom(column: HTMLElement | null, direction: ZoomDirection, originY: number): void {
  if (!column || typeof column.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  // Scale only: feed content never fades in (an opacity start can leave rows blank on phones).
  const from = direction === "in" ? "scale(0.94)" : "scale(1.05)";
  column.style.transformOrigin = `50% ${Math.round(originY * 100)}%`;
  column.animate([{ transform: from }, { transform: "scale(1)" }], { duration: ZOOM_MS, easing: ZOOM_EASING });
}

function visibleFeed(sessionId: string, threadKey: string): HTMLElement | null {
  const key = threadKey.toLowerCase();
  const feeds = document.querySelectorAll<HTMLElement>('[data-testid="message-feed-scroll-container"]');
  for (const feed of feeds) {
    const { feedSessionId, feedThreadKey } = feed.dataset;
    if (feedSessionId === sessionId && feedThreadKey?.toLowerCase() === key && feed.offsetParent) return feed;
  }
  return null;
}

/** The feed's messages in order; with `part`, only those between that strip and the next one. */
function messagesOf(container: HTMLElement, part: HTMLElement | null): HTMLElement[] {
  const elements = [
    ...container.querySelectorAll<HTMLElement>('[data-message-id], [data-testid="topic-feed-quest-start"]'),
  ];
  const messages: HTMLElement[] = [];
  let inPart = !part;
  for (const element of elements) {
    if (element.dataset.testid === "topic-feed-quest-start") {
      if (part) {
        if (element === part) inPart = true;
        else if (inPart) break;
      }
      continue;
    }
    const id = element.dataset.messageId;
    // Grouped error rows carry message IDs but are not places to land on.
    if (!inPart || !id || id.startsWith("hist-error")) continue;
    messages.push(element);
  }
  return messages;
}
