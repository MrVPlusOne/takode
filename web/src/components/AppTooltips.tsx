import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Every button's tooltip, drawn by Takode instead of the browser (Jiayi, Nov 2: every button should
 * say what it does on hover). Browsers show a `title` only after a long, uneven delay, in the
 * system's style, and not at all for a button named only by `aria-label`. One listener on the page
 * shows a tooltip for whatever the mouse rests on:
 *
 * - an element's `title` (the browser's own tooltip is held back while ours shows);
 * - else, for a button or link with no text of its own (an icon), its `aria-label`.
 *
 * So components keep naming buttons the usual way (`title`, `aria-label`) and get the same tooltip,
 * placed beside the element so it never covers it. Mouse only: touch keeps the accessible labels.
 * An element that shows a hover card of its own opts out with `data-tooltip="off"`.
 */
export function AppTooltips() {
  const [tip, setTip] = useState<ShownTip | null>(null);
  useEffect(() => installTooltips(setTip), []);
  if (!tip) return null;
  return createPortal(
    <div
      role="tooltip"
      className="pointer-events-none fixed z-[1000] max-w-[min(20rem,calc(100vw-16px))] rounded-md border border-cc-border bg-cc-card px-2 py-1 text-[12px] leading-snug text-cc-fg shadow-lg"
      style={{ left: tip.left, top: tip.top, visibility: tip.measured ? "visible" : "hidden" }}
      ref={(element) => {
        if (!element || tip.measured) return;
        const box = element.getBoundingClientRect();
        setTip({
          ...tip,
          ...placeTooltip(tip.anchor, { width: box.width, height: box.height }, viewportSize()),
          measured: true,
        });
      }}
      data-testid="app-tooltip"
    >
      {tip.text}
    </div>,
    document.body,
  );
}

/** How long the mouse rests on an element before its tooltip shows. */
export const TOOLTIP_DELAY_MS = 400;
/** Space between an element and its tooltip, and the tooltip's margin from the window's edges. */
const GAP_PX = 6;

interface ShownTip {
  text: string;
  anchor: Rect;
  left: number;
  top: number;
  /** Placed once its size is known; until then it is drawn hidden to be measured. */
  measured: boolean;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The element whose tooltip shows for a pointer over `target`, with its text, or null: the nearest
 * element with a `title` (or one whose title Takode is holding back), else the nearest button or
 * link with no text of its own that has an `aria-label`.
 */
export function tooltipFor(target: Element | null): { element: Element; text: string } | null {
  // An element with a hover card of its own (a session link) keeps the browser's behavior.
  if (target?.closest('[data-tooltip="off"]')) return null;
  const titled = target?.closest("[title], [data-cc-title]");
  const text = titled?.getAttribute("title") || titled?.getAttribute("data-cc-title");
  if (titled && text?.trim()) return { element: titled, text: text.trim() };
  const control = target?.closest('button, a, [role="button"], [role="menuitem"], [role="tab"]');
  const label = control?.getAttribute("aria-label")?.trim();
  if (control && label && !control.textContent?.trim()) return { element: control, text: label };
  return null;
}

/**
 * Where a tooltip of `size` goes for an element at `anchor`: centred under it, or above it when
 * there is no room below, kept inside the window. It never overlaps the element.
 */
export function placeTooltip(
  anchor: Rect,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const centred = (anchor.left + anchor.right) / 2 - size.width / 2;
  const left = Math.min(Math.max(GAP_PX, centred), viewport.width - size.width - GAP_PX);
  const below = anchor.bottom + GAP_PX;
  const top = below + size.height <= viewport.height - GAP_PX ? below : anchor.top - GAP_PX - size.height;
  return { left: Math.max(GAP_PX, left), top: Math.max(GAP_PX, top) };
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** Listens on the page and calls `show` with the tooltip to draw, or null; returns the cleanup. */
function installTooltips(show: (tip: ShownTip | null) => void): () => void {
  let current: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const release = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    // The title goes back unless React gave the element a new one meanwhile.
    if (current?.hasAttribute("data-cc-title")) {
      const held = current.getAttribute("data-cc-title") ?? "";
      current.removeAttribute("data-cc-title");
      if (!current.hasAttribute("title")) current.setAttribute("title", held);
    }
    current = null;
    show(null);
  };
  const onOver = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    const found = tooltipFor(event.target instanceof Element ? event.target : null);
    if (found?.element === current) return;
    release();
    if (!found) return;
    current = found.element;
    // Holds back the browser's own tooltip, which would show over ours a moment later.
    const title = current.getAttribute("title");
    if (title !== null) {
      current.setAttribute("data-cc-title", title);
      current.removeAttribute("title");
    }
    const element = current;
    timer = setTimeout(() => {
      if (current !== element || !element.isConnected) return;
      const box = element.getBoundingClientRect();
      const anchor = { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      // Measured first at the window's corner, where its width isn't squeezed by the edge.
      show({ text: found.text, anchor, left: 0, top: 0, measured: false });
    }, TOOLTIP_DELAY_MS);
  };
  const onOut = (event: PointerEvent) => {
    if (!current) return;
    const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (next && current.contains(next)) return;
    release();
  };
  document.addEventListener("pointerover", onOver, true);
  document.addEventListener("pointerout", onOut, true);
  // Pressing, typing or scrolling ends a tooltip: it would no longer describe what is under the mouse.
  document.addEventListener("pointerdown", release, true);
  document.addEventListener("keydown", release, true);
  document.addEventListener("scroll", release, true);
  window.addEventListener("blur", release);
  return () => {
    release();
    document.removeEventListener("pointerover", onOver, true);
    document.removeEventListener("pointerout", onOut, true);
    document.removeEventListener("pointerdown", release, true);
    document.removeEventListener("keydown", release, true);
    document.removeEventListener("scroll", release, true);
    window.removeEventListener("blur", release);
  };
}
