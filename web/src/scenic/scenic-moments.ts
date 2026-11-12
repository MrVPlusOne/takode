/**
 * Scenic background fanfares for the two moments worth a show: a quest finishing and a change
 * landing. Each style plays its own, in light or dark colours, drawn in layers that take no taps
 * and are removed on a timer. Ink & Paper's quest finishing plays in the completion card's own
 * pane, under its messages (`ink-celebration.ts`); the other styles play over the conversation.
 * A quest finishing also lifts the scene's reading veil for a moment. Nothing plays when the
 * setting is Off, with reduced motion, or where the browser cannot animate elements.
 */
import { useStore } from "../store.js";
import { inkSealSvg, playInkCelebration } from "./ink-celebration.js";
import { SCENIC_REVEAL_EVENT, type ScenicStyle, getScenicStyle, scenicMotionAllowed } from "./scenic-styles.js";

export type ScenicMoment = { kind: "quest-complete"; questId: string; title: string } | { kind: "landed" };

/** Plays the active style's fanfare for `moment`, starting from `anchor` (the card or badge). */
export function playScenicMoment(moment: ScenicMoment, anchor: Element | null): void {
  const style = getScenicStyle();
  if (!style || !scenicMotionAllowed() || typeof document.body.animate !== "function") return;
  const at = centerOf(anchor);
  const dark = useStore.getState().darkMode;
  if (moment.kind === "landed") {
    LANDINGS[style](at, dark);
    return;
  }
  window.dispatchEvent(new Event(SCENIC_REVEAL_EVENT));
  if (style === "ink") playInkCelebration(anchor, dark);
  else COMPLETIONS[style](moment.title, at, dark);
}

type Point = { x: number; y: number };

// ─── Colours ──────────────────────────────────────────────────────────────────

interface CardLook {
  paper: string;
  edge: string;
  heading: string;
  text: string;
}

const CARDS: Record<Exclude<ScenicStyle, "ink">, [CardLook, CardLook]> = {
  meadow: [
    { paper: "rgba(255,253,246,0.84)", edge: "rgba(120,160,110,0.35)", heading: "#3f7d4a", text: "#3d4a41" },
    { paper: "rgba(24,34,56,0.82)", edge: "rgba(233,220,154,0.35)", heading: "#efe1a0", text: "#dfe5ef" },
  ],
  seaside: [
    { paper: "rgba(255,255,255,0.82)", edge: "rgba(80,160,175,0.35)", heading: "#227b88", text: "#2a4450" },
    { paper: "rgba(17,36,52,0.82)", edge: "rgba(143,227,214,0.35)", heading: "#9be7dc", text: "#dbeaf0" },
  ],
};

const LEAVES = ["#8bbd6d", "#a9cf7f", "#6fa860", "#c9dc8a", "#f2d27a", "#f6c3d0"];

// ─── Quest complete ───────────────────────────────────────────────────────────

// Ink & Paper's is its own module (`ink-celebration.ts`): fireworks under the messages and a seal.
const COMPLETIONS: Record<Exclude<ScenicStyle, "ink">, (title: string, at: Point, dark: boolean) => void> = {
  meadow(title, at, dark) {
    const layer = openLayer(3600);
    const area = stage();
    const card = titleCard(layer, area, CARDS.meadow[dark ? 1 : 0], title, dark ? EMBLEMS.firefly : EMBLEMS.sprig);
    bloom(layer, at, dark ? "rgba(240,230,160,0.45)" : "rgba(255,236,180,0.85)", 260);
    sweep(layer, area, dark ? "rgba(240,232,170,0.18)" : "rgba(255,240,196,0.55)");
    if (dark) {
      for (let index = 0; index < 26; index++) firefly(layer, around(card, 1.1), index * 40);
    } else {
      gust(layer, area, card, LEAVES, 42);
    }
  },
  seaside(title, at, dark) {
    const layer = openLayer(3600);
    const area = stage();
    const card = titleCard(layer, area, CARDS.seaside[dark ? 1 : 0], title, EMBLEMS.wave(dark));
    bloom(layer, at, dark ? "rgba(140,230,220,0.3)" : "rgba(220,245,248,0.95)", 220);
    sweep(layer, area, dark ? "rgba(170,230,240,0.16)" : "rgba(255,250,232,0.55)");
    for (let index = 0; index < 22; index++) bubble(layer, at, dark, index * 45);
    for (let index = 0; index < 10; index++) glint(layer, around(card, 1.15), dark, 300 + index * 120);
  },
};

// ─── Landing ──────────────────────────────────────────────────────────────────

const LANDINGS: Record<ScenicStyle, (at: Point, dark: boolean) => void> = {
  meadow(at, dark) {
    const layer = openLayer(3000);
    bloom(layer, at, dark ? "rgba(240,230,160,0.35)" : "rgba(255,240,200,0.9)", 90);
    for (let index = 0; index < 14; index++) seed(layer, at, dark, index * 60);
  },
  seaside(at, dark) {
    const layer = openLayer(2600);
    for (let index = 0; index < 3; index++)
      ripple(layer, at, dark ? "rgba(143,227,214,0.8)" : "rgba(42,132,146,0.6)", index * 260);
    for (let index = 0; index < 8; index++) bubble(layer, at, dark, 200 + index * 90, 0.6);
  },
  ink(at, dark) {
    const layer = openLayer(2600);
    const ink = dark ? "rgba(236,231,219,0.7)" : "rgba(31,30,28,0.7)";
    const drop = add(layer, { ...box(at, 10), borderRadius: "50%", background: ink });
    drop.animate(
      [
        { transform: "translateY(-40px) scale(0.6)", opacity: 0 },
        { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.3 },
        { transform: "scale(1.6)", opacity: 0 },
      ],
      { duration: 700, easing: "ease-in", fill: "both" },
    );
    for (let index = 0; index < 2; index++) ripple(layer, at, ink, 220 + index * 240, 1.2);
    const seal = add(layer, { width: "26px", height: "26px", opacity: "0" });
    seal.innerHTML = inkSealSvg(["済"], 26, 26, dark);
    Object.assign(seal.style, { left: `${at.x + 22}px`, top: `${at.y - 13}px` });
    stamp(seal, 520, 1900);
  },
};

// ─── Pieces ───────────────────────────────────────────────────────────────────

const EMBLEMS = {
  sprig:
    '<svg viewBox="0 0 40 40" width="34" height="34"><path d="M20 36 C20 26 20 18 22 8" stroke="#6b9a5b" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M21 22 C12 22 8 16 8 11 C15 11 20 15 21 22Z" fill="#8bbd6d"/><path d="M21 16 C28 15 32 10 32 5 C25 5 21 10 21 16Z" fill="#a9cf7f"/><circle cx="29" cy="25" r="2.4" fill="#f2c94c"/></svg>',
  firefly:
    '<svg viewBox="0 0 40 40" width="34" height="34"><defs><radialGradient id="ff"><stop offset="0" stop-color="#fffbe0"/><stop offset="0.35" stop-color="#e9f08c" stop-opacity="0.8"/><stop offset="1" stop-color="#e9f08c" stop-opacity="0"/></radialGradient></defs><circle cx="20" cy="20" r="18" fill="url(#ff)"/></svg>',
  wave(dark: boolean) {
    const color = dark ? "#8fe3d6" : "#2a8492";
    return `<svg viewBox="0 0 40 40" width="34" height="34" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round"><path d="M5 18 Q11 10 17 18 T29 18 T41 18"/><path d="M5 26 Q11 18 17 26 T29 26 T41 26" opacity="0.55"/><circle cx="29" cy="9" r="3.4" fill="${dark ? "#f3e7b8" : "#f2b766"}" stroke="none"/></svg>`;
  },
};

/**
 * The quest's title on a paper card in the conversation pane's upper part. Returns the card,
 * so pieces can play around it.
 */
function titleCard(layer: HTMLElement, area: Area, look: CardLook, title: string, emblem: string): HTMLElement {
  const width = Math.min(420, area.width * 0.86);
  const top = Math.max(area.top + 70, window.innerHeight * 0.2);
  const card = add(layer, {
    left: `${area.left + (area.width - width) / 2}px`,
    top: `${top}px`,
    width: `${width}px`,
    padding: "20px 26px 22px",
    textAlign: "center",
    borderRadius: "18px",
    background: look.paper,
    backdropFilter: "blur(16px) saturate(1.2)",
    border: `1px solid ${look.edge}`,
    boxShadow: "0 18px 50px -18px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.06)",
  });
  card.innerHTML =
    (emblem
      ? `<div style="display:flex;justify-content:center;margin-bottom:6px;transform:scale(1.25)">${emblem}</div>`
      : "") +
    `<div style="font-size:24px;font-weight:600;line-height:1.2;color:${look.heading}">Quest complete</div>` +
    `<div style="margin:10px auto 8px;width:120px;height:1px;background:linear-gradient(90deg,transparent,${look.heading},transparent);opacity:0.45"></div>` +
    `<div style="font-size:14.5px;line-height:1.45;color:${look.text}">${escapeHtml(title)}</div>`;
  card.animate(
    [
      { transform: "translateY(14px) scale(0.97)", opacity: 0 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.14 },
      { transform: "translateY(0) scale(1)", opacity: 1, offset: 0.84 },
      { transform: "translateY(-8px) scale(1)", opacity: 0 },
    ],
    { duration: 3400, easing: "ease-out", fill: "both" },
  );
  return card;
}

/** A soft light swelling from `at` and fading. */
function bloom(layer: HTMLElement, at: Point, color: string, size: number): void {
  const glow = add(layer, {
    ...box(at, size),
    borderRadius: "50%",
    background: `radial-gradient(closest-side, ${color}, transparent)`,
  });
  glow.animate(
    [
      { transform: "scale(0.3)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.3 },
      { transform: "scale(1.4)", opacity: 0 },
    ],
    { duration: 1400, easing: "ease-out", fill: "both" },
  );
}

/** A wide band of soft light passing across the pane, like sun breaking through. */
function sweep(layer: HTMLElement, area: Area, color: string): void {
  const band = add(layer, {
    left: `${area.left}px`,
    top: `${area.top}px`,
    width: `${area.width}px`,
    height: `${window.innerHeight - area.top}px`,
    background: `linear-gradient(105deg, transparent 30%, ${color} 50%, transparent 70%)`,
    backgroundSize: "300% 100%",
  });
  band.animate(
    [
      { backgroundPosition: "100% 0", opacity: 0 },
      { backgroundPosition: "60% 0", opacity: 1, offset: 0.3 },
      { backgroundPosition: "0% 0", opacity: 0 },
    ],
    { duration: 2200, easing: "ease-in-out", fill: "both" },
  );
}

/** Leaves and petals carried across the pane by a breeze, passing the card. */
function gust(layer: HTMLElement, area: Area, card: HTMLElement, colors: string[], count: number): void {
  const rect = card.getBoundingClientRect();
  for (let index = 0; index < count; index++) {
    const color = colors[index % colors.length]!;
    const petal = color.startsWith("#f6") || color.startsWith("#f2d");
    const piece = add(layer, { left: `${area.left - 30}px`, top: "0", width: "16px", height: "16px" });
    piece.innerHTML = petal ? petalSvg(color) : leafSvg(color);
    const baseY = rect.top - 40 + Math.random() * (rect.height + 140);
    const amplitude = 18 + Math.random() * 36;
    const travel = area.width + 60;
    const spin = (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 420);
    const frames: Keyframe[] = [];
    for (let step = 0; step <= 8; step++) {
      const t = step / 8;
      frames.push({
        transform: `translate(${travel * t}px, ${baseY + Math.sin(t * Math.PI * 2 + index) * amplitude + t * 30}px) rotate(${spin * t}deg) scaleY(${0.4 + 0.6 * Math.abs(Math.cos(t * 6 + index))})`,
        opacity: t < 0.08 ? t / 0.08 : t > 0.9 ? (1 - t) / 0.1 : 1,
      });
    }
    piece.animate(frames, {
      duration: 2200 + Math.random() * 900,
      delay: Math.random() * 700,
      easing: "linear",
      fill: "both",
    });
  }
}

/** A dandelion seed floating up and away. */
function seed(layer: HTMLElement, at: Point, dark: boolean, delay: number): void {
  const color = dark ? "rgba(255,248,220,0.9)" : "rgba(255,255,255,0.95)";
  const stroke = dark ? "rgba(255,248,220,0.7)" : "rgba(150,150,140,0.55)";
  let rays = "";
  for (let index = 0; index < 9; index++) {
    const angle = (-Math.PI * (index + 1)) / 10;
    rays += `<line x1="10" y1="10" x2="${10 + Math.cos(angle) * 8}" y2="${10 + Math.sin(angle) * 8}"/>`;
  }
  const piece = add(layer, { left: `${at.x - 10}px`, top: `${at.y - 10}px`, width: "20px", height: "26px" });
  piece.innerHTML = `<svg viewBox="0 0 20 26" width="20" height="26"><g stroke="${stroke}" stroke-width="0.8">${rays}<line x1="10" y1="10" x2="10" y2="22"/></g><circle cx="10" cy="10" r="1.6" fill="${color}"/><ellipse cx="10" cy="23" rx="1.2" ry="2.2" fill="${dark ? "#d8cc9a" : "#b9a77a"}"/></svg>`;
  if (dark) piece.style.filter = "drop-shadow(0 0 4px rgba(255,240,180,0.7))";
  const dx = 40 + Math.random() * 140;
  const dy = -(90 + Math.random() * 120);
  const frames: Keyframe[] = [];
  for (let step = 0; step <= 6; step++) {
    const t = step / 6;
    frames.push({
      transform: `translate(${dx * t + Math.sin(t * 6 + delay) * 12}px, ${dy * t}px) rotate(${Math.sin(t * 5 + delay) * 20}deg)`,
      opacity: t < 0.1 ? t / 0.1 : t > 0.7 ? (1 - t) / 0.3 : 1,
    });
  }
  piece.animate(frames, { duration: 2200 + Math.random() * 500, delay, easing: "ease-out", fill: "both" });
}

/** A firefly rising with a soft pulse. */
function firefly(layer: HTMLElement, at: Point, delay: number): void {
  const piece = add(layer, {
    ...box(at, 8),
    borderRadius: "50%",
    background: "radial-gradient(circle, #fffbe0 20%, rgba(233,240,140,0.8) 45%, transparent 70%)",
    boxShadow: "0 0 14px 4px rgba(233,240,140,0.45)",
  });
  const dx = (Math.random() - 0.5) * 120;
  const dy = -(40 + Math.random() * 120);
  piece.animate(
    [
      { transform: "translate(0,0) scale(0.4)", opacity: 0 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) scale(1)`, opacity: 1, offset: 0.25 },
      { transform: `translate(${dx * 0.6}px, ${dy * 0.6}px) scale(0.7)`, opacity: 0.4, offset: 0.55 },
      { transform: `translate(${dx * 0.8}px, ${dy * 0.85}px) scale(1)`, opacity: 1, offset: 0.75 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 },
    ],
    { duration: 2400 + Math.random() * 600, delay, easing: "ease-in-out", fill: "both" },
  );
}

/** A bubble rising with a wobble. */
function bubble(layer: HTMLElement, at: Point, dark: boolean, delay: number, scale = 1): void {
  const size = (8 + Math.random() * 14) * scale;
  const piece = add(layer, {
    ...box({ x: at.x + (Math.random() - 0.5) * 60, y: at.y }, size),
    borderRadius: "50%",
    border: `1.2px solid ${dark ? "rgba(160,235,240,0.7)" : "rgba(42,132,146,0.6)"}`,
    background: dark
      ? "radial-gradient(circle at 32% 30%, rgba(220,250,255,0.7), rgba(120,210,220,0.1) 55%, transparent)"
      : "radial-gradient(circle at 32% 30%, #ffffff, rgba(200,236,240,0.35) 55%, transparent)",
  });
  const rise = 120 + Math.random() * 160;
  const frames: Keyframe[] = [];
  for (let step = 0; step <= 6; step++) {
    const t = step / 6;
    frames.push({
      transform: `translate(${Math.sin(t * 7 + delay) * 10}px, ${-rise * t}px) scale(${0.5 + t * 0.6})`,
      opacity: t < 0.1 ? t / 0.1 : t > 0.8 ? (1 - t) / 0.2 : 1,
    });
  }
  piece.animate(frames, { duration: 1800 + Math.random() * 700, delay, easing: "ease-out", fill: "both" });
}

/** A four-point sparkle popping in place. */
function glint(layer: HTMLElement, at: Point, dark: boolean, delay: number): void {
  const piece = add(layer, { ...box(at, 18) });
  const color = dark ? "#c9fbff" : "#ffffff";
  piece.innerHTML = `<svg viewBox="0 0 20 20" width="18" height="18"><path d="M10 0 Q10 10 20 10 Q10 10 10 20 Q10 10 0 10 Q10 10 10 0Z" fill="${color}"/></svg>`;
  piece.style.filter = `drop-shadow(0 0 4px ${dark ? "rgba(140,230,240,0.9)" : "rgba(255,220,150,0.9)"})`;
  piece.animate(
    [
      { transform: "scale(0) rotate(0deg)", opacity: 0 },
      { transform: "scale(1) rotate(45deg)", opacity: 1, offset: 0.4 },
      { transform: "scale(0) rotate(90deg)", opacity: 0 },
    ],
    { duration: 900, delay, easing: "ease-in-out", fill: "both" },
  );
}

/** A flattened ring spreading like a ripple on water. */
function ripple(layer: HTMLElement, at: Point, color: string, delay: number, thickness = 1.6): void {
  const ring = add(layer, {
    left: `${at.x - 20}px`,
    top: `${at.y - 8}px`,
    width: "40px",
    height: "16px",
    borderRadius: "50%",
    border: `${thickness}px solid ${color}`,
  });
  ring.animate(
    [
      { transform: "scale(0.3)", opacity: 0 },
      { transform: "scale(1)", opacity: 1, offset: 0.2 },
      { transform: "scale(4.5)", opacity: 0 },
    ],
    { duration: 1400, delay, easing: "ease-out", fill: "both" },
  );
}

function stamp(seal: HTMLElement, delay: number, hold = 2200): void {
  seal.animate(
    [
      { transform: "scale(1.8) rotate(-14deg)", opacity: 0 },
      { transform: "scale(0.92) rotate(-6deg)", opacity: 0.95, offset: 0.12 },
      { transform: "scale(1) rotate(-6deg)", opacity: 0.92, offset: 0.18 },
      { transform: "scale(1) rotate(-6deg)", opacity: 0.92, offset: 0.85 },
      { transform: "scale(1) rotate(-6deg)", opacity: 0 },
    ],
    { duration: hold, delay, easing: "ease-out", fill: "both" },
  );
}

function leafSvg(color: string): string {
  return `<svg viewBox="0 0 14 14" width="16" height="16"><path d="M1 7 Q7 1 13 7 Q7 13 1 7Z" fill="${color}"/><path d="M2 7 L12 7" stroke="rgba(255,255,255,0.5)" stroke-width="0.7"/></svg>`;
}

function petalSvg(color: string): string {
  return `<svg viewBox="0 0 14 14" width="16" height="16"><path d="M7 13 C1 10 2 3 6 2 L7 4 L8 2 C12 3 13 10 7 13Z" fill="${color}"/></svg>`;
}

/** A random point around the card's middle, up to `spread` times its half-size away. */
function around(card: HTMLElement, spread: number): Point {
  const rect = card.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2 + (Math.random() - 0.5) * rect.width * spread,
    y: rect.top + rect.height / 2 + (Math.random() - 0.5) * rect.height * spread,
  };
}

// ─── Layer helpers ────────────────────────────────────────────────────────────

type Area = { left: number; width: number; top: number };

/** A full-screen layer above everything, removed after `life` milliseconds. */
function openLayer(life: number): HTMLElement {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.scenicMoment = "true";
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "1400",
    pointerEvents: "none",
    overflow: "hidden",
  });
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), life);
  return layer;
}

function add(parent: HTMLElement, style: Partial<CSSStyleDeclaration>): HTMLElement {
  const element = document.createElement("div");
  element.style.position = "absolute";
  Object.assign(element.style, style);
  parent.appendChild(element);
  return element;
}

function box(at: Point, size: number): Partial<CSSStyleDeclaration> {
  return { left: `${at.x - size / 2}px`, top: `${at.y - size / 2}px`, width: `${size}px`, height: `${size}px` };
}

/** Where cards center: the conversation pane when there is one, else the screen. */
function stage(): Area {
  const pane = document.querySelector('[data-testid="main-chat"]')?.getBoundingClientRect();
  if (pane && pane.width > 0) return { left: pane.left, width: pane.width, top: pane.top };
  return { left: 0, width: window.innerWidth, top: 0 };
}

function centerOf(anchor: Element | null): Point {
  if (anchor instanceof HTMLElement && anchor.offsetWidth > 0) {
    const rect = anchor.getBoundingClientRect();
    return { x: rect.left + Math.min(rect.width / 2, 60), y: rect.top + rect.height / 2 };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
