import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useState } from "react";

/**
 * What pins at the top of the feed, so the controls floating there (the Next chip, the day pill,
 * live terminals and subagents) start below it instead of covering it:
 * - the quest strip of the quest being read, in a topic conversation (`TopicFeedQuestStart`) or in
 *   a leader's Main (`MainQuestStrip`), pinned whenever the feed is scrolled past the first one;
 * - an expanded report's collapse bar while its report is in view (`ReportCard`), which pins under
 *   the strip.
 *
 * Their heights go to the feed's overlay as CSS variables: `--feed-pinned-top` (the strip, set only
 * in feeds that have strips) and `--feed-pinned-bar` (a pinned collapse bar, 0px otherwise). Every
 * strip is the same height, so it is measured once per layout; a bar is pinned only while scrolling
 * through its report, so that is checked as the feed scrolls.
 */
export function useFeedPinnedTop(
  containerRef: RefObject<HTMLElement | null>,
  contentRootRef: RefObject<HTMLElement | null>,
  layoutSignature: string,
): { style: CSSProperties; belowPinnedStrip: boolean } {
  const strip = useTopicStripHeight(contentRootRef, layoutSignature);
  const bar = usePinnedBarHeight(containerRef, strip ?? 0, layoutSignature);
  return {
    style: {
      ...(strip === null ? {} : { "--feed-pinned-top": `${strip}px` }),
      "--feed-pinned-bar": `${bar}px`,
    } as CSSProperties,
    belowPinnedStrip: strip !== null,
  };
}

/** Quest strips of either kind (topic conversations and Main). */
const STRIP_SELECTOR = '[data-feed-quest-strip="true"]';

/** The height of the feed's quest strips; null in a feed without strips. */
function useTopicStripHeight(contentRootRef: RefObject<HTMLElement | null>, layoutSignature: string): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const root = contentRootRef.current;
    if (!root) return setHeight(null);
    let observer: ResizeObserver | null = null;
    // A hidden feed measures zero: keep the last height.
    const watch = (strip: HTMLElement) => {
      const measure = () => strip.offsetHeight > 0 && setHeight(strip.offsetHeight);
      measure();
      // The strip's text grows a size on wide screens.
      observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
      observer?.observe(strip);
    };
    const strip = root.querySelector<HTMLElement>(STRIP_SELECTOR);
    if (strip) {
      watch(strip);
      return () => observer?.disconnect();
    }
    setHeight(null);
    // Main's strips come with the started-quests list, which can arrive after the messages.
    const appearing =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(() => {
            const found = root.querySelector<HTMLElement>(STRIP_SELECTOR);
            if (!found) return;
            appearing?.disconnect();
            watch(found);
          });
    appearing?.observe(root, { childList: true, subtree: true });
    return () => {
      appearing?.disconnect();
      observer?.disconnect();
    };
  }, [contentRootRef, layoutSignature]);
  return height;
}

/**
 * The height of the report collapse bar pinned at the top of the feed (under a strip of
 * `stripPx`), or 0. A bar is pinned when it sits at its sticky position rather than at the top of
 * its report.
 */
function usePinnedBarHeight(
  containerRef: RefObject<HTMLElement | null>,
  stripPx: number,
  layoutSignature: string,
): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const bars = container.querySelectorAll<HTMLElement>("[data-feed-pinned-bar]");
      if (bars.length === 0) return setHeight(0);
      // Rects are in screen pixels, offsets in CSS pixels: they differ under the app's zoom.
      const scale = container.offsetHeight > 0 ? container.getBoundingClientRect().height / container.offsetHeight : 1;
      const pinnedAt = container.getBoundingClientRect().top + stripPx * scale;
      let pinned = 0;
      for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        const card = bar.parentElement?.getBoundingClientRect();
        // At its sticky position, and its report has scrolled up past it.
        if (Math.abs(rect.top - pinnedAt) < 1.5 && card && card.top < rect.top - 1) pinned = bar.offsetHeight;
      }
      setHeight(pinned);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    container.addEventListener("scroll", schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", schedule);
    };
  }, [containerRef, stripPx, layoutSignature]);
  return height;
}
