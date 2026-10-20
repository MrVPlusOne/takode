/**
 * Small celebrations for things that just got done: completing a personal to-do, a quest
 * finishing, a change landing, the last prompt waiting on the user being answered. Each is
 * drawn in its own layer above the page and takes no taps, so nothing waits on it and the
 * page underneath stays usable. They play once for a real event, never for history, and
 * not at all with reduced motion.
 *
 * Each is a small firework: pieces shoot up in a fountain and fall back. Every play draws its
 * own colors, count, angles and speeds, so no two look alike, and the fountain leans away from
 * screen edges the celebrated element is close to, so nothing flies off screen.
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

const SUCCESS = "#10b981";
const PALETTE = ["#10b981", "#fbbf24", "#38bdf8", "#f472b6", "#a78bfa", "#fb923c", "#34d399", "#f87171"];
const CHECK_SVG =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="white" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
const STAR_SVG =
  '<svg viewBox="0 0 10 10" width="10" height="10" fill="currentColor"><path d="M5 0 L6 4 L10 5 L6 6 L5 10 L4 6 L0 5 L4 4 Z"/></svg>';

type Shape = "dot" | "rect" | "strip" | "star";

/** One kind of fountain. Speed and gravity are in pixels per whole flight, before the app's zoom. */
interface Fountain {
  /** Typical number of pieces; each play varies it. */
  count: number;
  shapes: Shape[];
  /** Launch speed and pull back down: a piece peaks at speed² / (2 × gravity). */
  speed: number;
  gravity: number;
  /** Each piece's size at six even points of its flight. */
  scales: number[];
}

/** A to-do's confetti: peaks about 70 pixels out and falls back to where it started. */
const CONFETTI: Fountain = {
  count: 18,
  shapes: ["dot", "rect", "strip", "star"],
  speed: 280,
  gravity: 560,
  scales: [0.6, 1, 1, 0.95, 0.9, 0.8],
};
/** Sparks around a check pop. */
const SPARKS: Fountain = {
  count: 9,
  shapes: ["dot", "star"],
  speed: 150,
  gravity: 300,
  scales: [0.6, 1, 1, 0.95, 0.9, 0.8],
};
/** Stars that rise from a finished quest's label and twinkle out. */
const STARS: Fountain = { count: 7, shapes: ["star"], speed: 120, gravity: 160, scales: [0.4, 1.2, 0.8, 1.2, 0.8, 0] };

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
 * through, then slides off to the right while confetti shoots from its check. Without the
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
  launchFountain(layer, anchor, CONFETTI, duration);
  ghost?.animate([{ translate: "0 0" }, { translate: "0 0", offset: 0.5 }, { translate: "100% 0" }], {
    duration,
    easing: "ease-in",
    fill: "both",
  });
  closeLayer(duration, layer, ghost);
}

/** A green check pops with a ring rippling out and a few sparks: a change landed, a prompt list emptied. */
export function playCheckPop(anchor: CelebrationAnchor | null): void {
  const layer = openLayer(anchor);
  if (!layer || !anchor) return;
  const duration = 800;
  const ring = piece(layer, 20);
  Object.assign(ring.style, { borderRadius: "9999px", border: `2px solid ${SUCCESS}` });
  ring.animate(
    [
      { transform: "scale(0.8)", opacity: 0.8 },
      { transform: `scale(${between(2.2, 3)})`, opacity: 0 },
    ],
    { duration: duration * 0.7, easing: "ease-out", fill: "both" },
  );
  launchFountain(layer, anchor, SPARKS, duration);
  popCheck(layer, duration);
  closeLayer(duration, layer);
}

/** A few stars rise from the anchor and twinkle out: a quest finished. */
export function playSparkle(anchor: CelebrationAnchor | null): void {
  const layer = openLayer(anchor);
  if (!layer || !anchor) return;
  const duration = 900;
  launchFountain(layer, anchor, STARS, duration);
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

/**
 * Shoots `fountain`'s pieces up from the anchor, leaning away from close screen edges, and
 * lets them fall back. About one play in three splits into two jets.
 */
function launchFountain(layer: HTMLElement, anchor: CelebrationAnchor, fountain: Fountain, duration: number): void {
  const side = openSide(anchor);
  const up = Math.atan2(side.y * 0.8 - 0.6, side.x * 0.8) + between(-0.25, 0.25);
  const jets = Math.random() < 0.35 ? [up - 0.4, up + 0.4] : [up];
  const colors = colorMix();
  const count = Math.round(fountain.count * between(0.8, 1.2));
  const speed = fountain.speed * between(0.85, 1.15);
  for (let index = 0; index < count; index++) {
    const angle = jets[index % jets.length]! + between(-0.35, 0.35);
    const velocity = speed * between(0.65, 1.1);
    const path: Array<[number, number]> = [];
    for (let step = 0; step <= 5; step++) {
      const t = step / 5;
      path.push([Math.cos(angle) * velocity * t, Math.sin(angle) * velocity * t + 0.5 * fountain.gravity * t * t]);
    }
    flyPiece(layer, pick(fountain.shapes), pick(colors), keepOnScreen(anchor, path), fountain.scales, {
      spin: between(-360, 360),
      duration: duration - between(40, 160),
      delay: between(0, 60),
    });
  }
}

/**
 * Which way there is room: a vector pointing away from the screen edges the anchor is within
 * 150 pixels of, from length 0 in open space up to 1 right at an edge.
 */
function openSide(anchor: CelebrationAnchor): { x: number; y: number } {
  const reach = 150;
  const push = (distance: number) => Math.max(0, 1 - distance / reach);
  const x = push(anchor.x) - push(window.innerWidth - anchor.x);
  const y = push(anchor.y) - push(window.innerHeight - anchor.y);
  const length = Math.hypot(x, y);
  return length > 1 ? { x: x / length, y: y / length } : { x, y };
}

/** Shrinks a flight path, in layer pixels, so every point of it stays on screen. */
function keepOnScreen(anchor: CelebrationAnchor, path: Array<[number, number]>): Array<[number, number]> {
  const margin = 6;
  const limit = (from: number, travel: number, size: number) => {
    if (from + travel < margin) return (from - margin) / -travel;
    if (from + travel > size - margin) return (size - margin - from) / travel;
    return 1;
  };
  let factor = 1;
  for (const [dx, dy] of path) {
    factor = Math.min(
      factor,
      limit(anchor.x, dx * anchor.scale, window.innerWidth),
      limit(anchor.y, dy * anchor.scale, window.innerHeight),
    );
  }
  factor = Math.max(0, factor);
  return factor === 1 ? path : path.map(([dx, dy]) => [dx * factor, dy * factor]);
}

/** One piece following `path` at an even pace, fading out over its last 40%. */
function flyPiece(
  layer: HTMLElement,
  shape: Shape,
  color: string,
  path: Array<[number, number]>,
  scales: number[],
  { spin, duration, delay }: { spin: number; duration: number; delay: number },
): void {
  const bit = piece(layer, shape === "star" ? Math.round(between(8, 11)) : 6, shape === "star" ? STAR_SVG : "");
  bit.style.color = color;
  const sizes = { dot: ["5px", "5px", "9999px"], rect: ["4px", "7px", "1px"], strip: ["2.5px", "11px", "1px"] };
  if (shape !== "star") {
    const [width, height, borderRadius] = sizes[shape];
    Object.assign(bit.style, { background: color, width, height, borderRadius });
  }
  const last = path.length - 1;
  bit.animate(
    path.map(([dx, dy], index) => ({
      transform: `translate(${dx}px, ${dy}px) rotate(${(spin * index) / last}deg) scale(${scales[index] ?? 1})`,
      opacity: Math.min(1, (1 - index / last) / 0.4),
    })),
    // Linear timing over evenly spaced points of the arc moves each piece like a thrown one.
    { duration, delay, easing: "linear", fill: "both" },
  );
}

/** Four or five colors of the palette, in a new mix each play. */
function colorMix(): string[] {
  const colors = [...PALETTE];
  for (let index = colors.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [colors[index], colors[other]] = [colors[other]!, colors[index]!];
  }
  return colors.slice(0, 4 + Math.floor(Math.random() * 2));
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}
