/**
 * Visual feedback for closing the tab on screen: a copy of its quest strip slides away to
 * the left while the next tab's strip is already in place underneath. Sliding left uncovers
 * the next strip's close button first, and the copy takes no pointer events, so several
 * tabs can be closed in a row without waiting. Nothing plays with reduced motion.
 */

const SLIDE_MS = 200;

/**
 * Copies `strip` over its own place and slides the copy away. Call before the close
 * re-renders. `host` must outlive the strip (it may unmount when Main opens next) and share
 * its inherited text styles, so the copy looks exactly like the strip.
 */
export function playStripClose(strip: HTMLElement | null | undefined, host: HTMLElement | null | undefined): void {
  if (!host || !strip || typeof strip.animate !== "function") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  if (strip.offsetWidth === 0 || strip.offsetHeight === 0) return;
  const ghost = strip.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("data-testid");
  ghost.setAttribute("aria-hidden", "true");
  // Neither its copied buttons nor the copy itself can take a tap or focus.
  ghost.setAttribute("inert", "");
  ghost.dataset.stripCloseGhost = "true";
  // Offsets rather than screen coordinates: the host is inside the strip's offset parent,
  // so the copy lands on the strip even where the app is zoomed.
  Object.assign(ghost.style, {
    position: "absolute",
    left: `${strip.offsetLeft}px`,
    top: `${strip.offsetTop}px`,
    width: `${strip.offsetWidth}px`,
    height: `${strip.offsetHeight}px`,
    margin: "0",
    zIndex: "30",
    pointerEvents: "none",
    background: "var(--color-cc-bg)",
  });
  host.appendChild(ghost);
  ghost.animate([{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }], {
    duration: SLIDE_MS,
    easing: "cubic-bezier(0.4, 0, 1, 1)",
    fill: "forwards",
  });
  // A timer rather than the finish event, which a hidden page may never deliver.
  window.setTimeout(() => ghost.remove(), SLIDE_MS + 50);
}
