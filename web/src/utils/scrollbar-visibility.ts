/**
 * App-wide fading scrollbars: a scroll bar shows only while the user scrolls it, or while the
 * mouse is over it, and fades away shortly after, as macOS overlay scrollbars do.
 *
 * The thumb's colour lives in `--cc-scrollbar-thumb` (see `index.css`), which is transparent
 * until this script marks a scroller with `data-scrollbar-shown`. The fade animates that property
 * on the scroller itself; it is registered as non-inherited, so neither showing nor fading
 * restyles the scroller's content. Nothing runs while the page is idle: one timer after the last
 * scroll, then one short animation.
 *
 * - Only scrolling the user caused shows a bar: a scroll within `INTENT_WINDOW_MS` of a wheel,
 *   touch, scrolling key or pointer press, or one that continues a bar already shown (a fling, a drag).
 *   A feed following new messages on its own shows nothing.
 * - One bar at a time: showing a bar hides the last one at once, so nested scrollers (a pane in
 *   the side column) never show two bars side by side, even when scrolling passes from one to
 *   the other.
 * - The mouse over a scroller's scroll bar holds it shown until the mouse leaves it.
 */
export function installScrollbarVisibility(doc: Document = document): () => void {
  let shown: Element | null = null;
  let hovered: Element | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let fade: Animation | null = null;
  let lastIntentAt = Number.NEGATIVE_INFINITY;

  const hideNow = (element: Element) => {
    fade?.cancel();
    fade = null;
    element.removeAttribute(SHOWN_ATTRIBUTE);
    if (shown === element) shown = null;
  };

  const show = (element: Element) => {
    clearTimeout(hideTimer);
    if (shown && shown !== element) hideNow(shown);
    fade?.cancel();
    fade = null;
    shown = element;
    element.setAttribute(SHOWN_ATTRIBUTE, "");
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      const element = shown;
      if (!element || element === hovered) return;
      // `fill: forwards` keeps it transparent until the attribute goes, so it never flashes back.
      const animation = element.animate(
        { [THUMB_PROPERTY]: "transparent" },
        { duration: FADE_MS, easing: "ease-out", fill: "forwards" },
      );
      animation.onfinish = () => {
        if (fade === animation) hideNow(element);
      };
      fade = animation;
    }, HIDE_DELAY_MS);
  };

  const onIntent = () => {
    lastIntentAt = performance.now();
  };

  // Typing isn't scrolling: a feed that follows the composer as it grows must not flash its bar.
  const onKeyDown = (event: KeyboardEvent) => {
    if (SCROLL_KEYS.has(event.key) && !(event.key === " " && isEditable(event.target))) onIntent();
  };

  const onScroll = (event: Event) => {
    const element = event.target === doc ? doc.scrollingElement : event.target;
    if (!(element instanceof Element)) return;
    if (element !== shown && performance.now() - lastIntentAt > INTENT_WINDOW_MS) return;
    show(element);
    if (element !== hovered) scheduleHide();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const target = event.target instanceof Element && isOverScrollbar(event.target, event) ? event.target : null;
    if (target === hovered) return;
    hovered = target;
    if (target) show(target);
    else if (shown) scheduleHide();
  };

  const onPointerOut = (event: PointerEvent) => {
    // Leaving the window over a scroll bar fires no move outside it.
    if (event.relatedTarget || !hovered) return;
    hovered = null;
    if (shown) scheduleHide();
  };

  const listen = { capture: true, passive: true } as const;
  for (const type of INTENT_EVENTS) doc.addEventListener(type, onIntent, listen);
  doc.addEventListener("keydown", onKeyDown, listen);
  doc.addEventListener("scroll", onScroll, listen);
  doc.addEventListener("pointermove", onPointerMove, listen);
  doc.addEventListener("pointerout", onPointerOut, listen);
  return () => {
    for (const type of INTENT_EVENTS) doc.removeEventListener(type, onIntent, listen);
    doc.removeEventListener("keydown", onKeyDown, listen);
    doc.removeEventListener("scroll", onScroll, listen);
    doc.removeEventListener("pointermove", onPointerMove, listen);
    doc.removeEventListener("pointerout", onPointerOut, listen);
    clearTimeout(hideTimer);
    if (shown) hideNow(shown);
  };
}

const SHOWN_ATTRIBUTE = "data-scrollbar-shown";
const THUMB_PROPERTY = "--cc-scrollbar-thumb";
export const HIDE_DELAY_MS = 900;
const FADE_MS = 400;
/** Long enough to cover a smooth-scrolled key press; a programmatic scroll this soon after still shows. */
export const INTENT_WINDOW_MS = 600;
const INTENT_EVENTS = ["wheel", "touchstart", "touchmove", "pointerdown"] as const;
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

function isEditable(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
  );
}

/**
 * Whether the pointer is over the element's own vertical or horizontal scroll bar (or its far
 * border). `offsetX`/`offsetY` count from the padding edge in the element's own units, so the
 * app's zoom (a scale transform) doesn't matter.
 */
function isOverScrollbar(element: Element, event: PointerEvent): boolean {
  const vertical = element.scrollHeight > element.clientHeight && event.offsetX >= element.clientWidth;
  const horizontal = element.scrollWidth > element.clientWidth && event.offsetY >= element.clientHeight;
  return vertical || horizontal;
}
