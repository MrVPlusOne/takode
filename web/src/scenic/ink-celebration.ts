/**
 * Ink & Paper's celebration for a quest finishing, played in the pane that holds the quest's
 * completion card (the main conversation or a side-column chat). Three ink fireworks burst in the
 * painting under the messages, so they show only where the painting does and never cross text;
 * as the last one fades, a vermilion seal reading 圆满 is pressed beside the card where it covers no
 * writing. Gone within about four and a half seconds; nothing keeps running.
 */
import { type ImageSize, layoutScene } from "./ink-alive/ink-alive-layout.js";
import { SEAL_GLYPHS } from "./ink-seal-glyphs.js";

/** Plays the celebration for the completion card holding `anchor` (its label). */
export function playInkCelebration(anchor: Element | null, dark: boolean): void {
  const scene = sceneFor(anchor);
  if (!scene) return;
  // Where the living painting's cliffs are, so the bursts open in its sky and mist. Its layers are
  // usually cached; a slow load starts the fireworks without it.
  const backdrop = scene.feed?.closest('[data-testid="main-chat"]') ? visible('[data-testid="scenic-backdrop"]') : null;
  const living = backdrop?.querySelector("canvas") ? backdrop : null;
  const timeout = new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 500));
  void Promise.race([living ? cliffMap(rectOf(living)) : Promise.resolve(null), timeout]).then((cliffs) => {
    fireworks(scene, dark, cliffs);
    seal(scene, dark, SEAL_DELAY);
  });
}

// ─── Where it plays ───────────────────────────────────────────────────────────

export type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
export type Point = { x: number; y: number };

interface Scene {
  /** The pane the card is in: the main conversation or a side-column chat. */
  pane: Rect;
  /** The conversation's scrolling feed: where the painting can show between messages. */
  feed: HTMLElement | null;
  /** The part of the pane the feed shows. */
  region: Rect;
  /** The completion card, or the region's lower middle when it is not laid out. */
  card: Rect;
  cardElement: HTMLElement | null;
  /** The message column. */
  column: Rect;
}

function sceneFor(anchor: Element | null): Scene | null {
  const ownFeed = anchor?.closest<HTMLElement>('[data-testid="message-feed-scroll-container"]') ?? null;
  // A feed outside the app's panes (the Playground's) is its own pane.
  const paneElement =
    anchor?.closest('[data-testid="side-item-body"], [data-testid="main-chat"]') ??
    ownFeed ??
    visible('[data-testid="main-chat"]');
  if (!paneElement) return null;
  const pane = rectOf(paneElement);
  const feed = ownFeed ?? visibleIn(paneElement, '[data-testid="message-feed-scroll-container"]');
  const region = feed ? intersect(rectOf(feed), pane) : pane;
  const found = anchor?.closest<HTMLElement>('[data-testid="quest-completion-summary"]') ?? null;
  const cardElement = found && found.offsetWidth > 0 ? found : null;
  const card = cardElement
    ? rectOf(cardElement)
    : box(region.left + region.width / 2 - 160, region.bottom - 160, 320, 90);
  const columnElement =
    anchor?.closest("[data-feed-content-root]") ?? visibleIn(paneElement, "[data-feed-content-root]");
  const column = columnElement ? rectOf(columnElement) : region;
  return { pane, feed, region, card, cardElement, column };
}

// ─── Fireworks (烟花) ─────────────────────────────────────────────────────────

const LAUNCH_MS = 480;
const BLOOM_MS = 1600;
const STAGGER_MS = 380;
const FIREWORKS_MS = 2 * STAGGER_MS + LAUNCH_MS + BLOOM_MS;
/** The seal is pressed as the last burst fades, so the two read as one sequence. */
const SEAL_DELAY = 2 * STAGGER_MS + LAUNCH_MS + BLOOM_MS * 0.55;

/**
 * Three chrysanthemum fireworks, vermilion, gold and indigo by day (gold, vermilion and jade at
 * night), each petal a tapered brush stroke over a wash of colour, then sparks falling like a
 * willow. They are drawn under the messages, aimed where the most painting shows: open sky and
 * mist beside a wide column, the gaps and margins around the card in a narrow pane.
 */
function fireworks(scene: Scene, dark: boolean, cliffs: CliffMap | null): void {
  const layer = behindLayer(scene, FIREWORKS_MS + 100);
  if (!layer) return;
  const { element, origin } = layer;
  const canvas = document.createElement("canvas");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(origin.width * ratio);
  canvas.height = Math.round(origin.height * ratio);
  Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%" });
  element.appendChild(canvas);
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(ratio, ratio);

  const colors = dark ? ["#f4c96a", "#f0705a", "#9fdcc4", "#f3ecdc"] : ["#c8382c", "#c48a24", "#33507a", "#d65a6e"];
  const step = Math.max(10, Math.round(Math.sqrt((scene.region.width * scene.region.height) / 2400)));
  const open = openPoints(scene, step);
  const bursts = pickBursts({ ...scene, open, step, cliffs }).map((spot, index) =>
    makeBurst(spot.x - origin.left, spot.y - origin.top, spot.radius, colors, index * STAGGER_MS, index),
  );
  const bottom = scene.region.bottom - origin.top;
  // The clock is an animation, so the drawing pauses, slows and stops with the page's animations.
  const clock = element.animate([{ opacity: 1 }, { opacity: 1 }], { duration: FIREWORKS_MS });
  const draw = () => {
    if (!element.isConnected) return;
    const now = Number(clock.currentTime ?? 0);
    context.clearRect(0, 0, origin.width, origin.height);
    for (const burst of bursts) drawBurst(context, burst, now, bottom, dark);
    if (now < FIREWORKS_MS) requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/**
 * Where the three bursts go, from `open`, the points `step` apart where the painting shows (no
 * message sheet, label or bar covers it). Each burst is centred where most of its circle would
 * show. Beside a wide column they open in the painting's sky and mist rather than in front of its
 * cliffs (`cliffs`; without it, toward the column and high up, away from the cliffs framing the
 * pane's edges); in a narrow pane, near the card.
 */
export function pickBursts(input: {
  region: Rect;
  column: Rect;
  card: Rect;
  open: Point[];
  step: number;
  cliffs: CliffMap | null;
}): Array<Point & { radius: number }> {
  const { region, column, card, open, step, cliffs } = input;
  const margin = Math.max(0, Math.min(column.left - region.left, region.right - column.right));
  const wide = margin >= 150;
  const radius = wide ? clamp(margin * 0.5, 100, 150) : clamp(region.width * 0.36, 80, 150);
  const reach = (radius * 0.85) ** 2;
  const scored = open
    .filter((_, index) => index % 2 === 0)
    .map((spot) => {
      let seen = 0;
      for (const point of open) if ((point.x - spot.x) ** 2 + (point.y - spot.y) ** 2 <= reach) seen++;
      const fraction = seen / ((Math.PI * reach) / step ** 2);
      const high = (spot.y - region.top) / region.height;
      let weight: number;
      if (wide && cliffs) {
        weight = (1.1 - 0.4 * high) * (1 - cliffsAround(cliffs, spot, radius * 0.8)) ** 3;
      } else if (wide) {
        const side = spot.x < column.left ? spot.x - region.left : region.right - spot.x;
        weight = (1.25 - 0.7 * high) * (0.45 + 0.55 * Math.min(1, side / (margin * 0.65)));
      } else {
        const near = Math.hypot(spot.x - (card.left + card.width / 2), spot.y - card.top);
        weight = 1 / (1 + near / region.height);
      }
      return { ...spot, score: fraction * weight };
    })
    .sort((a, b) => b.score - a.score);
  const chosen: Array<Point & { radius: number }> = [];
  for (const spot of scored) {
    if (chosen.length === 3) break;
    if (chosen.some((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < radius * 1.3)) continue;
    chosen.push({ x: spot.x, y: spot.y, radius: radius * (0.85 + Math.random() * 0.25) });
  }
  // A feed with no painting showing at all still gets its bursts, hidden under the messages.
  while (chosen.length < 3) {
    chosen.push({
      x: region.left + region.width * (0.25 + chosen.length * 0.25),
      y: region.top + region.height * 0.3,
      radius,
    });
  }
  return chosen;
}

/** How much of the painting's cliffs is at a screen point, from 0 (sky, mist or water) to 1. */
export type CliffMap = (x: number, y: number) => number;

/** A burst's share of cliff: over its centre and two rings of points around it, out to `spread`. */
function cliffsAround(cliffs: CliffMap, at: Point, spread: number): number {
  let sum = cliffs(at.x, at.y) * 2;
  for (let index = 0; index < 8; index++) {
    const angle = (index / 8) * Math.PI * 2;
    for (const ring of [0.5, 1])
      sum += cliffs(at.x + Math.cos(angle) * spread * ring, at.y + Math.sin(angle) * spread * ring);
  }
  return sum / 18;
}

const cliffLayers = new Map<string, Promise<ImageData & { natural: ImageSize }>>();

/**
 * The living painting's cliffs in a pane at `pane`: its tall and near peaks laid out the way the
 * scene lays them out (`layoutScene`), read from their painted layers (ink on white). The lower
 * parts of the tall and far peaks sit in the sea of clouds, so they count as mist.
 */
async function cliffMap(pane: Rect): Promise<CliffMap | null> {
  try {
    const [midFar, mid, nearLayer] = await Promise.all(["ink-midfar", "ink-mid", "ink-near"].map(cliffLayer));
    const size = { width: 1, height: 1 };
    const layout = layoutScene(
      { width: pane.width, height: pane.height },
      { far: size, midFar: midFar!.natural, mid: mid!.natural, near: nearLayer!.natural, boat: size, crane: size },
      0,
      { sceneTime: 0, cranes: [], rings: [] },
    );
    const cloudTop = layout.horizon - pane.height * 0.22;
    // Any visible brushwork counts: the pale tops of the tall peaks are rock as much as their
    // dark faces.
    const rock = (ink: number) => clamp((ink - 0.04) / 0.16, 0, 1);
    return (x, y) => {
      const px = x - pane.left;
      const py = y - pane.top;
      const near = rock(inkIn(nearLayer!, layout.near, px, py));
      if (py >= cloudTop) return near;
      return Math.max(near, rock(inkIn(mid!, layout.mid, px, py)), rock(inkIn(midFar!, layout.midFar, px, py)));
    };
  } catch (error) {
    console.warn("[scenic] could not read the painting's layers for the celebration", error);
    return null;
  }
}

function cliffLayer(name: string): Promise<ImageData & { natural: ImageSize }> {
  let layer = cliffLayers.get(name);
  if (!layer) {
    layer = (async () => {
      const image = new Image();
      image.src = `/scenic/${name}.v1.webp`;
      await image.decode();
      // A small copy is plenty to tell rock from sky.
      const width = 240;
      const height = Math.max(1, Math.round((width * image.naturalHeight) / image.naturalWidth));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("no 2d canvas");
      context.drawImage(image, 0, 0, width, height);
      return Object.assign(context.getImageData(0, 0, width, height), {
        natural: { width: image.naturalWidth, height: image.naturalHeight },
      });
    })();
    layer.catch(() => cliffLayers.delete(name));
    cliffLayers.set(name, layer);
  }
  return layer;
}

/** The ink of a layer laid at `rect` (x, y, width, height; a negative width mirrors it) at pane point x, y. */
function inkIn(layer: ImageData, rect: number[], x: number, y: number): number {
  const u = (x - rect[0]!) / rect[2]!;
  const v = (y - rect[1]!) / rect[3]!;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return 0;
  const index = (Math.floor(v * layer.height) * layer.width + Math.floor(u * layer.width)) * 4;
  return 1 - layer.data[index]! / 255;
}

/**
 * Points of the feed, `step` apart, where the painting shows: nothing that has a background or
 * its own text is on top there.
 */
function openPoints(scene: Scene, step: number): Point[] {
  const { feed, region } = scene;
  const points: Point[] = [];
  if (!feed || typeof document.elementFromPoint !== "function") return points;
  for (let y = region.top + step / 2; y < region.bottom; y += step) {
    for (let x = region.left + step / 2; x < region.right; x += step) {
      const hit = document.elementFromPoint(x, y);
      if (hit && feed.contains(hit) && seeThrough(hit)) points.push({ x, y });
    }
  }
  return points;
}

const seeThroughCache = new WeakMap<Element, boolean>();

function seeThrough(element: Element): boolean {
  const cached = seeThroughCache.get(element);
  if (cached !== undefined) return cached;
  let open = !(element instanceof SVGElement) && !/^(IMG|CANVAS|VIDEO|BUTTON|INPUT|TEXTAREA)$/.test(element.tagName);
  if (open) {
    const style = getComputedStyle(element);
    const color = style.backgroundColor;
    open =
      style.backgroundImage === "none" &&
      (color === "transparent" || /rgba\(.*,\s*0\)$/.test(color)) &&
      ![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
  }
  seeThroughCache.set(element, open);
  return open;
}

interface Burst {
  x: number;
  y: number;
  radius: number;
  start: number;
  outer: string;
  inner: string;
  rays: Array<{ angle: number; reach: number; ring: number }>;
}

function makeBurst(x: number, y: number, radius: number, colors: string[], start: number, index: number): Burst {
  const outer = colors[index % colors.length]!;
  const inner = colors[(index + 1 + Math.floor(Math.random() * 2)) % colors.length]!;
  const count = 28 + Math.floor(Math.random() * 8);
  const turn = Math.random() * Math.PI * 2;
  const rays = [];
  for (let ray = 0; ray < count; ray++) {
    const angle = turn + (ray / count) * Math.PI * 2;
    rays.push({ angle: angle + (Math.random() - 0.5) * 0.12, reach: 0.82 + Math.random() * 0.22, ring: 1 });
    if (ray % 2 === 0) rays.push({ angle: angle + Math.PI / count, reach: 0.42 + Math.random() * 0.12, ring: 0 });
  }
  return { x, y, radius, start, outer, inner, rays };
}

function drawBurst(context: CanvasRenderingContext2D, burst: Burst, now: number, bottom: number, dark: boolean): void {
  const age = now - burst.start;
  if (age < 0) return;
  // The rocket rises straight up from below its burst, slowing as it nears the top.
  if (age < LAUNCH_MS) {
    const fromY = Math.min(bottom, burst.y + burst.radius * 2.4);
    const t = easeOut(age / LAUNCH_MS);
    const headY = fromY + (burst.y - fromY) * t;
    const tailY = fromY + (burst.y - fromY) * Math.max(0, t - 0.3);
    const sway = Math.sin(age / 60) * 1.2;
    const trail = context.createLinearGradient(burst.x, tailY, burst.x, headY);
    trail.addColorStop(0, withAlpha(burst.outer, 0));
    trail.addColorStop(1, withAlpha(burst.outer, 0.9));
    context.strokeStyle = trail;
    context.lineWidth = 2.4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(burst.x, tailY);
    context.lineTo(burst.x + sway, headY);
    context.stroke();
    dot(context, burst.x + sway, headY, 2.6, withAlpha(dark ? "#fff6dc" : burst.outer, 1));
    return;
  }
  const bloom = age - LAUNCH_MS;
  if (bloom > BLOOM_MS) return;
  const life = bloom / BLOOM_MS;
  const fade = life < 0.45 ? 1 : 1 - (life - 0.45) / 0.55;
  // A wash of colour spreading like ink in wet paper (a glow at night).
  const washRadius = Math.max(1, burst.radius * 1.3 * easeOut(Math.min(1, bloom / 700)));
  const wash = context.createRadialGradient(burst.x, burst.y, 0, burst.x, burst.y, washRadius);
  const washAlpha = (dark ? 0.16 : 0.11) * fade;
  wash.addColorStop(0, withAlpha(burst.inner, washAlpha * 1.3));
  wash.addColorStop(0.5, withAlpha(burst.outer, washAlpha * 0.7));
  wash.addColorStop(1, withAlpha(burst.outer, 0));
  context.fillStyle = wash;
  context.beginPath();
  context.arc(burst.x, burst.y, washRadius, 0, Math.PI * 2);
  context.fill();
  // Petal strokes: each runs out from the centre, the tail lagging the tip, then droops.
  const reach = easeOut(Math.min(1, bloom / 800));
  const lag = easeOut(clamp((bloom - 220) / 800, 0, 1));
  const droop = (bloom / 1000) ** 2 * burst.radius * 0.35;
  const scale = burst.radius / 100;
  for (const ray of burst.rays) {
    const color = ray.ring ? burst.outer : burst.inner;
    const length = burst.radius * ray.reach;
    const cos = Math.cos(ray.angle);
    const sin = Math.sin(ray.angle);
    const tipX = burst.x + cos * length * reach;
    const tipY = burst.y + sin * length * reach + droop;
    const tailX = burst.x + cos * length * lag * 0.92;
    const tailY = burst.y + sin * length * lag * 0.92 + droop * 0.6;
    const stroke = context.createLinearGradient(tailX, tailY, tipX, tipY);
    stroke.addColorStop(0, withAlpha(color, 0));
    stroke.addColorStop(1, withAlpha(color, 0.95 * fade));
    // A brush stroke: hair-thin where it starts, full where the brush presses at the tip.
    const width = (ray.ring ? 2.6 : 2) * (0.75 + 0.25 * Math.sin(ray.angle * 5)) * Math.max(1, scale * 0.9);
    const nx = -(tipY - tailY);
    const ny = tipX - tailX;
    const norm = Math.hypot(nx, ny) || 1;
    const px = (nx / norm) * width * 0.5;
    const py = (ny / norm) * width * 0.5;
    context.fillStyle = stroke;
    context.beginPath();
    context.moveTo(tailX, tailY);
    context.lineTo(tipX + px, tipY + py);
    context.lineTo(tipX - px, tipY - py);
    context.closePath();
    context.fill();
    dot(context, tipX, tipY, width * 0.5, withAlpha(color, 0.95 * fade));
    if (!ray.ring) continue;
    // A bead of colour at each tip, twinkling, then sparks raining down like a willow's branches.
    if (bloom > 350) {
      const twinkle = 0.55 + 0.45 * Math.sin(bloom / 45 + ray.angle * 7);
      dot(context, tipX, tipY + droop * 0.4, 1.8, withAlpha(dark ? "#fff3cf" : color, fade * twinkle));
    }
    if (bloom > 650) {
      const fall = (bloom - 650) / 1000;
      const sparkle = 0.5 + 0.5 * Math.sin(bloom / 38 + ray.angle * 11);
      const color2 = dark ? "#ffe9b0" : color;
      dot(context, tipX, tipY + fall * fall * burst.radius * 0.9, 1.2, withAlpha(color2, fade * sparkle * 0.9));
    }
  }
}

/**
 * A layer under the messages of the scene's feed, over the painting: placed just before the
 * nearest positioned box holding the feed, so the feed and everything on it paint after it. It
 * forms no stacking context and takes no taps, so menus and clicks are unaffected.
 */
function behindLayer(scene: Scene, life: number): { element: HTMLElement; origin: Rect } | null {
  let holder: HTMLElement | null = scene.feed;
  while (holder && (getComputedStyle(holder).position || "static") === "static") holder = holder.parentElement;
  if (!holder?.parentElement) return null;
  const origin = scene.region;
  const element = document.createElement("div");
  element.setAttribute("aria-hidden", "true");
  element.dataset.scenicMoment = "true";
  Object.assign(element.style, {
    position: "fixed",
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    height: `${origin.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
  });
  holder.parentElement.insertBefore(element, holder);
  // A transformed ancestor would place a fixed box relative to itself; move it back on screen.
  const placed = element.getBoundingClientRect();
  element.style.left = `${origin.left + (origin.left - placed.left)}px`;
  element.style.top = `${origin.top + (origin.top - placed.top)}px`;
  window.setTimeout(() => element.remove(), life);
  return { element, origin };
}

// ─── Seal (印章) ──────────────────────────────────────────────────────────────

/**
 * A vermilion seal reading 圆满 ("perfectly done") pressed across the card's right edge, the way a
 * seal is pressed across a scroll's mount, low on the card where no writing is, with a few flecks
 * of seal paste and gold leaf thrown outward. Skipped when there is no free spot.
 */
function seal(scene: Scene, dark: boolean, delay: number): void {
  // Without the card laid out there is no telling where its writing is.
  if (!scene.cardElement) return;
  const narrow = scene.region.width < 600;
  const width = narrow ? 34 : 40;
  const height = narrow ? 64 : 76;
  const spot = findSealSpot(scene.card, scene.pane, textRects(scene.cardElement), width, height);
  if (!spot) return;
  const hold = 2400;
  const life = delay + hold + 100;
  const layer = overLayer(scene, life);
  const { x: cx, y: cy } = spot;
  const stamp = document.createElement("div");
  Object.assign(stamp.style, { width: `${width}px`, height: `${height}px` });
  stamp.innerHTML = inkSealSvg(["圆", "满"], width, height, dark);
  place(stamp, scene.pane, cx - width / 2, cy - height / 2);
  layer.appendChild(stamp);
  stamp.animate(
    [
      { transform: "translateY(-14px) scale(1.6) rotate(-10deg)", opacity: 0 },
      { transform: "translateY(0) scale(0.94) rotate(-4deg)", opacity: 1, offset: 0.1 },
      { transform: "scale(1) rotate(-4deg)", opacity: 1, offset: 0.15 },
      { transform: "scale(1) rotate(-4deg)", opacity: 1, offset: 0.8 },
      { transform: "scale(1) rotate(-4deg)", opacity: 0 },
    ],
    { duration: hold, delay, easing: "ease-out", fill: "both" },
  );
  const impact = delay + hold * 0.1;
  // Flecks of paste and gold leaf fly outward, away from the card's writing.
  for (let index = 0; index < 8; index++) {
    const angle = (Math.random() - 0.5) * Math.PI * 0.8;
    const distance = 16 + Math.random() * 18;
    const size = 2 + Math.random() * 2.5;
    const fleck = document.createElement("div");
    Object.assign(fleck.style, {
      width: `${size}px`,
      height: `${size * (0.7 + Math.random() * 0.5)}px`,
      borderRadius: "50%",
      background: dark ? "#ef6a4f" : "#c8382c",
    });
    place(fleck, scene.pane, cx + width / 2 - 2, cy + (Math.random() - 0.5) * height * 0.6);
    layer.appendChild(fleck);
    const dx = Math.cos(angle) * distance;
    const dy = Math.sin(angle) * distance;
    fleck.animate(
      [
        { transform: "translate(0,0) scale(0.4)", opacity: 0 },
        { transform: `translate(${dx}px, ${dy}px) scale(1)`, opacity: 0.9, offset: 0.25 },
        { transform: `translate(${dx * 1.1}px, ${dy * 1.1}px)`, opacity: 0 },
      ],
      { duration: 1000, delay: impact, easing: "ease-out", fill: "both" },
    );
  }
  for (let index = 0; index < 7; index++) {
    goldLeaf(layer, scene.pane, cx + width / 2, cy - height / 4, dark, impact + 100 + index * 90);
  }
}

/**
 * The seal's centre: across the card's right edge, the way a seal straddles a scroll's mount, as
 * low as it fits with a gap around every piece of the card's text (`words`); further out when
 * long lines reach the edge, never past the pane. Null when nothing fits.
 */
export function findSealSpot(card: Rect, pane: Rect, words: Rect[], width: number, height: number): Point | null {
  const gap = 6;
  const clear = (x: number, y: number) =>
    words.every(
      (word) =>
        x + width / 2 + gap <= word.left ||
        x - width / 2 - gap >= word.right ||
        y + height / 2 + gap <= word.top ||
        y - height / 2 - gap >= word.bottom,
    );
  for (const shift of [0, 0.25, 0.5]) {
    const x = card.right + width * shift + (shift ? 2 : 0);
    if (x + width / 2 > pane.right - 2) continue;
    for (let y = card.bottom - height / 2 - 6; y >= card.top + height / 2; y -= 6) {
      if (clear(x, y)) return { x, y };
    }
  }
  return null;
}

/** The on-screen boxes of every piece of text in `element`. */
function textRects(element: HTMLElement | null): Rect[] {
  if (!element) return [];
  const rects: Rect[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node && rects.length < 2000; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) rects.push(box(rect.left, rect.top, rect.width, rect.height));
  }
  return rects;
}

/**
 * A seal as SVG markup: `characters` (one, or two read top to bottom) in paper colour carved out of
 * a vermilion block (白文), with a worn, slightly uneven edge. Drawn from outlines, not a font.
 */
export function inkSealSvg(
  characters: ReadonlyArray<keyof typeof SEAL_GLYPHS>,
  width: number,
  height: number,
  dark: boolean,
): string {
  const id = `seal-${Math.random().toString(36).slice(2, 8)}`;
  const red = dark ? "#d8503c" : "#bf3326";
  const tall = 80 + characters.length * 480;
  const glyphs = characters
    .map(
      (character, index) =>
        `<path d="${SEAL_GLYPHS[character]}" transform="translate(50 ${50 + index * 480}) scale(0.46)" fill="#fbf3e2"/>`,
    )
    .join("");
  return (
    `<svg viewBox="0 0 560 ${tall}" width="${width}" height="${height}"><defs>` +
    `<filter id="${id}-r" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="10"/></filter>` +
    `<filter id="${id}-w"><feTurbulence type="fractalNoise" baseFrequency="0.22" numOctaves="2" seed="3"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -12 8.2"/><feComposite in="SourceGraphic" operator="in"/></filter>` +
    `</defs><g filter="url(#${id}-r)"><g filter="url(#${id}-w)"><rect x="18" y="18" width="524" height="${tall - 36}" rx="34" fill="${red}"/>` +
    glyphs +
    `</g></g></svg>`
  );
}

/** A fleck of gold leaf turning as it floats up and outward, then fades. */
function goldLeaf(layer: HTMLElement, origin: Rect, x: number, y: number, dark: boolean, delay: number): void {
  const leaf = document.createElement("div");
  const size = 3 + Math.random() * 3;
  Object.assign(leaf.style, {
    width: `${size}px`,
    height: `${size}px`,
    background: dark ? "#f6d27a" : "#d4a63a",
    clipPath: "polygon(10% 0, 100% 20%, 80% 100%, 0 70%)",
  });
  place(leaf, origin, x, y);
  layer.appendChild(leaf);
  const dx = 6 + Math.random() * 26;
  const dy = -(30 + Math.random() * 40);
  leaf.animate(
    [
      { transform: "translate(0,0) rotate(0deg) scaleX(1)", opacity: 0 },
      { transform: `translate(${dx * 0.3}px, ${dy * 0.3}px) rotate(120deg) scaleX(0.3)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) rotate(260deg) scaleX(1)`, opacity: 0.9, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) rotate(400deg) scaleX(0.4)`, opacity: 0 },
    ],
    { duration: 1600 + Math.random() * 400, delay, easing: "ease-out", fill: "both" },
  );
}

/** A layer over the pane, clipped to it, that takes no taps; removed after `life` ms. */
function overLayer(scene: Scene, life: number): HTMLElement {
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  layer.dataset.scenicMoment = "true";
  Object.assign(layer.style, {
    position: "fixed",
    left: `${scene.pane.left}px`,
    top: `${scene.pane.top}px`,
    width: `${scene.pane.width}px`,
    height: `${scene.pane.height}px`,
    overflow: "hidden",
    pointerEvents: "none",
    zIndex: "1400",
  });
  document.body.appendChild(layer);
  window.setTimeout(() => layer.remove(), life);
  return layer;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Places `element` at screen point `x, y` (its top-left) inside a layer whose box is `origin`. */
function place(element: HTMLElement, origin: Rect, x: number, y: number): void {
  element.style.position = "absolute";
  element.style.left = `${x - origin.left}px`;
  element.style.top = `${y - origin.top}px`;
}

function visible(selector: string): HTMLElement | null {
  return visibleIn(document, selector);
}

function visibleIn(root: ParentNode, selector: string): HTMLElement | null {
  for (const element of root.querySelectorAll<HTMLElement>(selector)) if (element.offsetWidth > 0) return element;
  return null;
}

function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return box(rect.left, rect.top, rect.width, rect.height);
}

function box(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function intersect(a: Rect, b: Rect): Rect {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  return box(
    left,
    top,
    Math.max(0, Math.min(a.right, b.right) - left),
    Math.max(0, Math.min(a.bottom, b.bottom) - top),
  );
}

function dot(context: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(x, y, radius, 0, Math.PI * 2);
  context.fill();
}

/** `#rrggbb` with an alpha. */
function withAlpha(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16},${(value >> 8) & 255},${value & 255},${clamp(alpha, 0, 1).toFixed(3)})`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}
