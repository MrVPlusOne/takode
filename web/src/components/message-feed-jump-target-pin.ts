import { useCallback, useEffect, useRef, type RefObject } from "react";
import { escapeSelectorValue } from "./message-feed-utils.js";
import { getFeedViewportScale } from "./message-feed-viewport-anchor.js";

/** Long enough for late feed content (quest cards fetching their record, images) on a phone. */
export const JUMP_TARGET_PIN_MS = 5000;

const STABLE_TARGET_ATTRIBUTES = ["data-message-id", "data-feed-block-id", "data-turn-id"] as const;

interface JumpTargetPin {
  selector: string;
  offsetTop: number;
  stop: () => void;
}

/**
 * Keeps the element a message jump landed on at the place it landed while the
 * rest of the feed is still rendering around it.
 *
 * Content that mounts after a jump, such as a quest thread's description and
 * completion cards (they wait for the quest record) or images, shifts
 * everything below it. Chrome's CSS scroll anchoring usually hides that, but
 * iOS Safari has no scroll anchoring, so the target got pushed away about half
 * a second after the jump. While pinned, every size change of the feed puts
 * the target back at its landing offset before paint. The pin ends when the
 * user touches or scrolls the feed (`release`, also wired to deliberate
 * navigation), when the feed's session or thread changes, or after
 * {@link JUMP_TARGET_PIN_MS}.
 */
export function useJumpTargetPin({
  containerRef,
  contentRootRef,
  lastScrollTopRef,
  programmaticScrollTargetRef,
  scopeKey,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  contentRootRef: RefObject<HTMLDivElement | null>;
  lastScrollTopRef: { current: number };
  programmaticScrollTargetRef: { current: number | null };
  scopeKey: string;
}) {
  const pinRef = useRef<JumpTargetPin | null>(null);

  const release = useCallback(() => {
    pinRef.current?.stop();
    pinRef.current = null;
  }, []);

  const pin = useCallback(
    (target: HTMLElement) => {
      release();
      const container = containerRef.current;
      const attribute = STABLE_TARGET_ATTRIBUTES.find((name) => target.hasAttribute(name));
      if (!container || !attribute || typeof ResizeObserver === "undefined") return;
      // Look the target up by its stable id each time: a window replacement can remount it.
      const selector = `[${attribute}="${escapeSelectorValue(target.getAttribute(attribute) ?? "")}"]`;

      const keepInPlace = () => {
        const current = pinRef.current;
        const element = current && container.querySelector<HTMLElement>(current.selector);
        if (!current || !element) return;
        const drift = element.getBoundingClientRect().top - container.getBoundingClientRect().top - current.offsetTop;
        if (Math.abs(drift) < 1) return;
        const nextTop = container.scrollTop + drift / getFeedViewportScale(container);
        programmaticScrollTargetRef.current = nextTop;
        container.scrollTop = nextTop;
        lastScrollTopRef.current = container.scrollTop;
      };
      const observer = new ResizeObserver(keepInPlace);
      observer.observe(container);
      if (contentRootRef.current) observer.observe(contentRootRef.current);
      container.addEventListener("pointerdown", release, true);
      const timeout = setTimeout(release, JUMP_TARGET_PIN_MS);
      pinRef.current = {
        selector,
        offsetTop: target.getBoundingClientRect().top - container.getBoundingClientRect().top,
        stop: () => {
          observer.disconnect();
          container.removeEventListener("pointerdown", release, true);
          clearTimeout(timeout);
        },
      };
    },
    [containerRef, contentRootRef, lastScrollTopRef, programmaticScrollTargetRef, release],
  );

  // A pinned message can also show in another thread of the same session.
  useEffect(() => release, [release, scopeKey]);

  return { pinJumpTarget: pin, releaseJumpTarget: release };
}
