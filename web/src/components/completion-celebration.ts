/**
 * Small celebrations for things that just got done: completing a personal to-do, a quest
 * finishing, a change landing, the last prompt waiting on the user being answered. Each is
 * drawn in its own layer above the page and takes no taps, so nothing waits on it and the
 * page underneath stays usable. They play once for a real event, never for history, and
 * not at all with reduced motion.
 */
import { useEffect, useRef } from "react";

/** Where to celebrate, measured when the event happens. */
export interface CelebrationAnchor {
  /** Center of the celebrated element, on screen. */
  x: number;
  y: number;
  /** The app's zoom there, so the celebration matches the size of what it marks. */
  scale: number;
  /** A copy of a completed to-do's row, laid over its place while the celebration plays. */
  ghost: HTMLElement | null;
}

/** How recent an event must be when it first shows to count as happening now, not history. */
export const ARRIVAL_WINDOW_MS = 20_000;

const CONFETTI_COLORS = ["#10b981", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa"];
const SUCCESS = "#10b981";
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const STAR_SVG =
  '<svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor"><path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z"/></svg>';

/**
 * Measures where to celebrate: on `target` (a to-do's status circle, a button, a label),
 * with a copy of `row` when a completed to-do is about to leave its list. Returns null when
 * `target` is not laid out.
 */
export function celebrationAnchor(target: Element | null | undefined, row?: Element | null): CelebrationAnchor | null {
  if (!(target instanceof HTMLElement) || target.offsetWidth === 0) return null;
  const rect = target.getBoundingClientRect();
  const scale = rect.width / target.offsetWidth || 1;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    scale,
    ghost: row instanceof HTMLElement ? copyRow(row, target, scale) : null,
  };
}

/**
 * Completing a to-do: the completed row stays in place for a moment, checked and struck
 * through, then slides off to the right while confetti bursts from its check. Without the
 * copy, the celebration would land on the next row, which the list has already moved up.
 * Safe to call many times in a row.
 */
export function playCompletionCelebration(anchor: CelebrationAnchor | null): void {
  const layer = openLayer(anchor);
  if (!layer || !anchor) return;
  const duration = 900;
  const ghost = anchor.ghost;
  if (ghost) document.body.insertBefore(ghost, layer);
  // The check rides on the copied row, so it leaves with it.
  popCheck(ghost?.querySelector<HTMLElement>("[data-completion-mark]") ?? layer, duration);
  burstConfetti(layer, duration);
  ghost?.animate([{ translate: "0 0" }, { translate: "0 0", offset: 0.5 }, { translate: "100% 0" }], {
    duration,
    easing: "ease-in",
    fill: "both",
  });
  closeLayer(duration, layer, ghost);
}

/** A green check pops with a ring rippling out: a change landed, a prompt list emptied. */
export function playCheckPop(anchor: CelebrationAnchor | null): void {
  const layer = openLayer(anchor);
  if (!layer) return;
  const duration = 800;
  const ring = piece(layer, 20);
  Object.assign(ring.style, { borderRadius: "9999px", border: `2px solid ${SUCCESS}` });
  ring.animate(
    [
      { transform: "scale(0.8)", opacity: 0.8 },
      { transform: "scale(2.6)", opacity: 0 },
    ],
    { duration: duration * 0.7, easing: "ease-out", fill: "both" },
  );
  popCheck(layer, duration);
  closeLayer(duration, layer);
}

/** A few stars twinkle around the anchor: a quest finished. */
export function playSparkle(anchor: CelebrationAnchor | null): void {
  const layer = openLayer(anchor);
  if (!layer) return;
  const duration = 900;
  const count = 6;
  for (let index = 0; index < count; index++) {
    // A wide ellipse, so the stars frame a line of text rather than a point.
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
    const dx = Math.cos(angle) * (34 + (index % 2) * 10);
    const dy = Math.sin(angle) * (14 + (index % 2) * 4);
    const star = piece(layer, 10, STAR_SVG);
    star.style.color = index % 2 ? "#fbbf24" : "#34d399";
    star.animate(
      [
        { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(0) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) scale(1.1) rotate(45deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.1}px, ${dy * 1.1}px) scale(0) rotate(90deg)`, opacity: 0 },
      ],
      { duration: duration - 120, delay: (index % 3) * 60, easing: "ease-out", fill: "both" },
    );
  }
  closeLayer(duration, layer);
}

/**
 * Plays `play` once for the event `key` when it first shows while it is still news: `at`
 * (when it happened) is within {@link ARRIVAL_WINDOW_MS}. Each key is considered once per page,
 * so remounts, window slides and older events never replay it.
 */
export function usePlayOnArrival(key: string | null, at: number | undefined, play: () => void): void {
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    if (!key || considered.has(key)) return;
    considered.add(key);
    if (at !== undefined && Math.abs(Date.now() - at) <= ARRIVAL_WINDOW_MS) playRef.current();
  }, [key, at]);
}

const considered = new Set<string>();

/** Test hook: forget which events were already considered. */
export function _resetArrivalsForTest(): void {
  considered.clear();
}

/** The layer pieces are drawn in, centered on `anchor`, or null when nothing should play. */
function openLayer(anchor: CelebrationAnchor | null): HTMLElement | null {
  if (!anchor || typeof document === "undefined") return null;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return null;
  const layer = document.createElement("div");
  if (typeof layer.animate !== "function") return null;
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.celebration = "true";
  Object.assign(layer.style, {
    position: "fixed",
    left: `${anchor.x}px`,
    top: `${anchor.y}px`,
    width: "0",
    height: "0",
    zIndex: "70",
    pointerEvents: "none",
    transform: `scale(${anchor.scale})`,
  });
  document.body.appendChild(layer);
  return layer;
}

/** Removes the celebration on a timer rather than the finish event, which a hidden page may never deliver. */
function closeLayer(duration: number, ...elements: Array<HTMLElement | null>): void {
  window.setTimeout(() => {
    for (const element of elements) element?.remove();
  }, duration + 50);
}

/**
 * A copy of the completed row at its place on screen, struck through, with its circle left
 * empty for the check that pops there. It is laid in the page's top layer, so it copies the
 * text styles the row inherits.
 */
function copyRow(row: HTMLElement, check: HTMLElement, scale: number): HTMLElement {
  const rect = row.getBoundingClientRect();
  const inherited = getComputedStyle(row);
  const ghost = row.cloneNode(true) as HTMLElement;
  for (const element of [
    ghost,
    ...ghost.querySelectorAll<HTMLElement>("[id],[data-testid],[data-todo-id],[aria-label]"),
  ]) {
    element.removeAttribute("id");
    element.removeAttribute("aria-label");
    element.removeAttribute("data-testid");
    element.removeAttribute("data-todo-id");
  }
  ghost.setAttribute("aria-hidden", "true");
  ghost.setAttribute("inert", "");
  ghost.dataset.completionGhost = "true";
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${row.offsetWidth}px`,
    height: `${row.offsetHeight}px`,
    margin: "0",
    zIndex: "69",
    pointerEvents: "none",
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    transition: "none",
    fontFamily: inherited.fontFamily,
    fontSize: inherited.fontSize,
    lineHeight: inherited.lineHeight,
    color: inherited.color,
    textDecoration: "line-through",
  });
  // The circle stays empty for the check that pops over it; the text reads as done.
  const index = [...row.querySelectorAll("*")].indexOf(check);
  const copiedCheck = index >= 0 ? ghost.querySelectorAll<HTMLElement>("*")[index] : undefined;
  if (copiedCheck) copiedCheck.style.visibility = "hidden";
  for (const text of ghost.querySelectorAll<HTMLElement>('[role="button"]')) text.style.opacity = "0.55";
  const checkRect = check.getBoundingClientRect();
  const mark = document.createElement("div");
  mark.dataset.completionMark = "true";
  Object.assign(mark.style, {
    position: "absolute",
    left: `${(checkRect.left + checkRect.width / 2 - rect.left) / scale}px`,
    top: `${(checkRect.top + checkRect.height / 2 - rect.top) / scale}px`,
    width: "0",
    height: "0",
  });
  ghost.appendChild(mark);
  return ghost;
}

/** A centered piece of the celebration, `size` pixels square. */
function piece(parent: HTMLElement, size: number, html = ""): HTMLElement {
  const element = document.createElement("div");
  Object.assign(element.style, {
    position: "absolute",
    left: `${-size / 2}px`,
    top: `${-size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  });
  element.innerHTML = html;
  parent.appendChild(element);
  return element;
}

function popCheck(parent: HTMLElement, duration: number): void {
  const check = piece(parent, 20, CHECK_SVG);
  Object.assign(check.style, { borderRadius: "9999px", background: SUCCESS });
  check.animate(
    [
      { transform: "scale(0.4)", opacity: 1 },
      { transform: "scale(1.25)", opacity: 1, offset: 0.3 },
      { transform: "scale(1)", opacity: 1, offset: 0.5 },
      { transform: "scale(1)", opacity: 1, offset: 0.75 },
      { transform: "scale(0.9)", opacity: 0 },
    ],
    { duration, easing: "ease-out", fill: "both" },
  );
}

/** Colored bits burst out and fall a little. */
function burstConfetti(layer: HTMLElement, duration: number): void {
  const count = 14;
  for (let index = 0; index < count; index++) {
    const angle = (index / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
    const distance = 26 + Math.random() * 18;
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    const spin = (Math.random() - 0.5) * 540;
    const round = index % 3 === 0;
    const bit = piece(layer, 6);
    Object.assign(bit.style, {
      background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
      borderRadius: round ? "9999px" : "1px",
      width: round ? "5px" : "4px",
      height: round ? "5px" : "7px",
    });
    bit.animate(
      [
        { transform: "translate(0, 0) rotate(0deg) scale(0.6)", opacity: 1 },
        { transform: `translate(${dx}px, ${dy}px) rotate(${spin / 2}deg) scale(1)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx * 1.15}px, ${dy + 16}px) rotate(${spin}deg) scale(0.9)`, opacity: 0 },
      ],
      { duration: duration - 100 + Math.random() * 100, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)", fill: "both" },
    );
  }
}
