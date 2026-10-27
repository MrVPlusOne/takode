import { type RefObject, useEffect, useState } from "react";
import { localDayStartMs, localDaysAgo, useLocalToday } from "./local-today.js";
import { formatMessageDayAge } from "./MessageTimestamp.js";
import { formatFeedDayLabel } from "./message-feed-utils.js";

/** How far below the top edge the pill reads the feed: the content under the pill itself. */
const DAY_PILL_PROBE_PX = 8;
/** How long the pill stays after scrolling stops before it fades out. */
const DAY_PILL_LINGER_MS = 1500;
/** Scrolled less than this, the top of the feed shows and the pill would only cover its first row. */
const DAY_PILL_MIN_SCROLL_PX = 24;

/**
 * Which day the content at the top of the feed's view is from, as a timestamp on that day, or
 * null when nothing dated is above it. Message time labels and day dividers carry
 * `data-feed-time`; they are in document order, which is also top-to-bottom order, so a binary
 * search finds the first one still below `viewTop` with a handful of layout reads. Content above
 * a day divider belongs to the day before it.
 */
export function findFeedDayAtTop(root: ParentNode, viewTop: number): number | null {
  const markers = root.querySelectorAll<HTMLElement>("[data-feed-time]");
  let lo = 0;
  let hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (markers[mid]!.getBoundingClientRect().bottom > viewTop) hi = mid;
    else lo = mid + 1;
  }
  const first = markers[lo];
  if (first && first.dataset.feedDayDivider !== "true") return Number(first.dataset.feedTime);
  const previous = markers[lo - 1];
  return previous ? Number(previous.dataset.feedTime) : null;
}

/**
 * The day of what's at the top of the feed, shown there (by `MessageFeedTopControls`, so it never
 * covers the live terminal and subagent rail) while it isn't today, so a jump into an
 * older conversation always says which day it is and how long ago that was. Today's content
 * needs no pill: its times are bare clock times. Nothing shows at the very top of the feed, where
 * the pill would cover the first row, or while the oldest loaded day's divider is still in view,
 * since the divider already names that day; message times carry their day there.
 *
 * It shows only while the feed scrolls (including a jump to a message) and fades out shortly
 * after, like the date label in iOS Photos, so a feed at rest is never covered by it.
 */
export function MessageFeedDayPill({
  containerRef,
  contentRootRef,
  layoutSignature,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRootRef: RefObject<HTMLDivElement | null>;
  /** Changes when the feed's rendered content changes, so the pill re-reads it without a scroll. */
  layoutSignature: string;
}) {
  const today = useLocalToday();
  const [topDay, setTopDay] = useState<number | null>(null);
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    let lingerTimer: number | undefined;
    const read = () => {
      frame = 0;
      // Without layout (a hidden feed) every position reads as zero and says nothing.
      if (container.clientHeight === 0 || container.scrollTop < DAY_PILL_MIN_SCROLL_PX) return setTopDay(null);
      const viewTop = container.getBoundingClientRect().top + DAY_PILL_PROBE_PX;
      const timestamp = findFeedDayAtTop(contentRootRef.current ?? container, viewTop);
      setTopDay(timestamp === null || !Number.isFinite(timestamp) ? null : localDayStartMs(timestamp));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    const onScroll = () => {
      schedule();
      setScrolling(true);
      window.clearTimeout(lingerTimer);
      lingerTimer = window.setTimeout(() => setScrolling(false), DAY_PILL_LINGER_MS);
    };
    read();
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(lingerTimer);
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", schedule);
    };
  }, [containerRef, contentRootRef, layoutSignature]);

  if (topDay === null || localDaysAgo(topDay, today) <= 0) return null;
  const age = formatMessageDayAge(topDay, today);
  return (
    <time
      data-testid="message-feed-day-pill"
      data-visible={scrolling ? "true" : undefined}
      aria-hidden={scrolling ? undefined : true}
      dateTime={new Date(topDay).toISOString()}
      className={`rounded-full border border-cc-border bg-cc-card/95 px-2 text-[11px] leading-4 text-cc-muted shadow-sm backdrop-blur-sm transition-opacity motion-reduce:transition-none ${scrolling ? "opacity-100 duration-150" : "opacity-0 duration-500"}`}
    >
      {formatFeedDayLabel(topDay, today)} · {age.charAt(0).toUpperCase() + age.slice(1)}
    </time>
  );
}
