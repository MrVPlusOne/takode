import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLongPress } from "../hooks/useLongPress.js";
import { useStore } from "../store.js";

/** How long the mouse rests on a cut line before its full text shows, about a native tooltip's delay. */
const HOVER_DELAY_MS = 350;
/** The card's padding plus border, so its text starts where the line's did. */
const CARD_INSET_PX = 13;
const CARD_INSET_TOP_PX = 9;
const VIEWPORT_INSET_PX = 8;

/**
 * One line of text cut at the end with an ellipsis, its full text shown in a card while the mouse
 * rests on it or after a long-press on touch. The card shows only when the text is actually cut,
 * and closes when the mouse leaves, on the next press anywhere, or on scroll. Home's news lines use
 * it (Jiayi, Nov 1: wrapped news lines made Home's rows two to four lines tall).
 */
export function TruncatedLine({ text, className = "", testId }: { text: string; className?: string; testId?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    const element = ref.current;
    if (element && element.scrollWidth > element.clientWidth) setAnchor(element.getBoundingClientRect());
  };
  const longPress = useLongPress(show);
  useEffect(() => clearTimer, []);
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor]);
  const { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel } = longPress.handlers;
  return (
    <>
      <span
        ref={ref}
        className={`block min-w-0 truncate ${className}`}
        data-testid={testId}
        onPointerEnter={(event) => {
          if (event.pointerType !== "mouse" || longPress.isSuppressingMouse()) return;
          clearTimer();
          timer.current = setTimeout(show, HOVER_DELAY_MS);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse") return;
          clearTimer();
          setAnchor(null);
        }}
        {...{ onTouchStart, onTouchMove, onTouchEnd, onTouchCancel }}
      >
        {text}
      </span>
      {anchor && <FullTextCard text={text} anchor={anchor} />}
    </>
  );
}

/**
 * The full text laid over the cut line, its first words where the line's were, so the line reads as
 * unfolding in place. It moves up when it would run past the bottom of the screen.
 */
function FullTextCard({ text, anchor }: { text: string; anchor: DOMRect }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const zoomLevel = useStore((state) => state.zoomLevel ?? 1);
  // The app is scaled by its zoom level and the card, outside it, by the same: the anchor's rect is
  // already scaled, the card's own sizes are not.
  const width = Math.min(
    anchor.width / zoomLevel + 2 * CARD_INSET_PX,
    (window.innerWidth - 2 * VIEWPORT_INSET_PX) / zoomLevel,
  );
  const left = Math.max(
    VIEWPORT_INSET_PX,
    Math.min(anchor.left - CARD_INSET_PX * zoomLevel, window.innerWidth - width * zoomLevel - VIEWPORT_INSET_PX),
  );
  const top = anchor.top - CARD_INSET_TOP_PX * zoomLevel;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const overflow = card.getBoundingClientRect().bottom - (window.innerHeight - VIEWPORT_INSET_PX);
    if (overflow > 0) card.style.top = `${Math.max(VIEWPORT_INSET_PX, top - overflow)}px`;
  }, [top]);
  return createPortal(
    <div
      ref={cardRef}
      role="tooltip"
      className="pointer-events-none fixed z-50 rounded-lg border border-cc-border bg-cc-card px-3 py-2 text-[13px] leading-5 text-cc-fg shadow-xl"
      style={{ left, top, width, transform: `scale(${zoomLevel})`, transformOrigin: "top left" }}
      data-testid="truncated-line-card"
    >
      {text}
    </div>,
    document.body,
  );
}
