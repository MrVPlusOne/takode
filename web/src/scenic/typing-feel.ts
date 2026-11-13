/**
 * Typing feel: the caret comes alive while you type. The text box draws its text and caret itself,
 * exactly as without a feel: nothing here renders text, hides the caret or touches the text's
 * position or weight. Each style only colours the native caret or draws light around it.
 *
 * No added latency: the work for a key runs after the frame showing that key has been painted
 * (only a caret light is dimmed as the key lands, so it doesn't glow a frame over the new
 * character, and comes back in two steps after it), and the settling, which waits for a pause
 * in typing, is a few discrete steps rather than an animation. An animation keeps the page drawing
 * a frame on every display tick, so a key typed meanwhile waits for the next tick (about 8 ms on
 * average, measured); between steps the page draws nothing, so a key is drawn at once, as with no
 * feel. The forge's sparks are the one longer motion: a burst lasts 80 ms, starts after the key's
 * frame and comes at most every 180 ms, so it is over before the next key at ordinary typing speed
 * (very fast typing pays about a frame on some keys).
 * Every input counts the same, IME composition (pinyin) included, so it works the same for
 * Chinese. Everything settles 1.2 s after the last key, so an idle box draws nothing, and nothing
 * plays with reduced motion.
 */
import { scenicMotionAllowed } from "./scenic-styles.js";

export type TypingFeel = "vermilion" | "glow" | "forge" | "forge-quiet" | "edge";

/** The styles, in the order to offer them, with a short description of each. */
export const TYPING_FEELS: ReadonlyArray<{ id: TypingFeel; label: string; description: string }> = [
  {
    id: "vermilion",
    label: "Vermilion caret",
    description: "The caret turns seal vermilion while you type and goes back to ink when you pause.",
  },
  {
    id: "glow",
    label: "Glowing vermilion caret",
    description: "The vermilion caret line itself glows while you type, and cools when you pause.",
  },
  {
    id: "forge",
    label: "Forged caret",
    description:
      "The caret is iron in the forge: the faster you type, the hotter it glows, from dark red through orange to white-gold, throwing off a few sparks at speed.",
  },
  {
    id: "forge-quiet",
    label: "Forged caret, no sparks",
    description: "The forged caret's heat without the sparks, the only motion in these styles, to compare.",
  },
  {
    id: "edge",
    label: "Warm edge",
    description:
      "The caret stays as it is; the composer's edge glows softly while you type and settles when you pause.",
  },
];

/** A running typing feel. */
export interface TypingFeelHandle {
  /** Stops the feel and puts the box back as it was. */
  stop(): void;
}

/**
 * Gives `area` a typing feel. Marks are drawn in its parent element, which must be positioned; the
 * warm edge glows around the closest `[data-typing-frame]` (or the parent). Does nothing with
 * reduced motion.
 */
export function attachTypingFeel(area: HTMLTextAreaElement, feel: TypingFeel): TypingFeelHandle {
  if (!scenicMotionAllowed() || !area.parentElement) return { stop() {} };
  const box = new TypingBox(area, area.parentElement);
  const parts: Part[] = [];
  if (feel === "vermilion") parts.push(vermilionCaret(box));
  if (feel === "glow") parts.push(glowingCaret(box, () => box.vermilion));
  if (feel === "forge" || feel === "forge-quiet") {
    parts.push(glowingCaret(box, forgeColour, (warmth) => forgeColour(warmth * 0.75)));
  }
  if (feel === "forge") parts.push(sparks(box));
  if (feel === "edge") parts.push(warmEdge(box));
  box.onType((warmth) => {
    const steps = parts.map((part) => part(warmth));
    box.settle((cooled) => {
      for (const step of steps) step(cooled);
    });
  });
  return { stop: () => box.stop() };
}

/** How warm the typing is: each key adds one, and it cools by half every this many ms. */
const COOL_MS = 700;
/** Warmth that counts as fully warm. */
const FULL_HEAT = 6;
/** How long a feel takes to settle after the last key, and in how many steps after the hold. */
const SETTLE_MS = 1200;
const SETTLE_STEPS = 8;
/** Typing faster than this keeps a style hot without any frames of its own between keys. */
const HOLD_MS = 300;

/** The text box being typed in: when keys land, where its caret is, its colours and its marks. */
class TypingBox {
  ink = "";
  vermilion = "";
  gold = "";
  readonly lineHeight: number;
  private heat = 0;
  private typedAt = 0;
  private lastGap = Number.POSITIVE_INFINITY;
  private readonly mirror = document.createElement("div");
  private readonly cleanups: Array<() => void> = [];
  /** The box width the mirror's style was copied at; copied again when it changes. */
  private mirrorWidth = -1;
  private settling: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly area: HTMLTextAreaElement,
    readonly host: HTMLElement,
  ) {
    const style = getComputedStyle(area);
    this.lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    this.readColours();
    // The theme can change while typing (night falls on "colour by day, ink at night").
    const theme = new MutationObserver(() => this.readColours());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.cleanups.push(() => theme.disconnect());
    Object.assign(this.mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px" });
    this.mirror.setAttribute("aria-hidden", "true");
    document.body.append(this.mirror);
    this.cleanups.push(() => this.mirror.remove());
  }

  /** The vermilion and gold of the scenic fireworks and seal, by day or by night. */
  private readColours(): void {
    const dark = document.documentElement.classList.contains("dark");
    this.ink = getComputedStyle(this.area).color;
    this.vermilion = dark ? "#ef6a4f" : "#c8382c";
    this.gold = dark ? "#f4c96a" : "#c48a24";
  }

  /**
   * Runs `play` with the warmth (0 to 1) after keys land: every input counts, IME composition
   * included. It runs at most once a frame, after that frame (the one showing the typed text) has
   * been painted, so it never delays the text.
   */
  onType(play: (warmth: number) => void): void {
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let scheduled = false;
    const typed = () => {
      const now = performance.now();
      this.heat = this.heat * 0.5 ** ((now - this.typedAt) / COOL_MS) + 1;
      this.lastGap = now - this.typedAt;
      this.typedAt = now;
      if (scheduled) return;
      scheduled = true;
      frame = requestAnimationFrame(() => {
        timer = setTimeout(() => {
          scheduled = false;
          play(Math.min(1, this.heat / FULL_HEAT));
        });
      });
    };
    this.area.addEventListener("input", typed);
    this.cleanups.push(() => {
      this.area.removeEventListener("input", typed);
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    });
  }

  /**
   * Runs `hide` the moment a key lands, before its frame: only for a light that would otherwise
   * stay one frame at the caret's old place. Keep it to a single opacity change on a mark's own
   * layer, which costs the frame nothing measurable.
   */
  onKey(hide: () => void): void {
    this.area.addEventListener("input", hide);
    this.cleanups.push(() => this.area.removeEventListener("input", hide));
  }

  /** How long before the last key the one before it landed, in ms. */
  gap(): number {
    return this.lastGap;
  }

  /** Runs `cleanup` when the feel stops. */
  later(cleanup: () => void): void {
    this.cleanups.push(cleanup);
  }

  /** Sets styles until the feel stops. */
  restyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
    const before = Object.fromEntries(Object.keys(style).map((key) => [key, element.style[key as never]]));
    Object.assign(element.style, style);
    this.cleanups.push(() => Object.assign(element.style, before));
  }

  /** Puts the box above its parent's other contents, so marks drawn there sit behind the text. */
  raise(): void {
    if (getComputedStyle(this.area).position === "static") this.restyle(this.area, { position: "relative" });
    this.restyle(this.area, { zIndex: "1" });
  }

  /** A mark drawn in `parent` (the host by default), removed when the feel stops. */
  mark(style: Partial<CSSStyleDeclaration>, parent: HTMLElement = this.host): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    // Its own layer: a mark only ever changes its opacity and position, which then need no repaint.
    Object.assign(
      element.style,
      { position: "absolute", pointerEvents: "none", zIndex: "0", willChange: "opacity, transform" },
      style,
    );
    parent.append(element);
    this.cleanups.push(() => element.remove());
    return element;
  }

  /**
   * Settles in discrete steps: `apply` gets how far it has cooled (0 hot, 1 settled), now and then
   * at each of a few steps, a single style change each time. Cooling waits for a pause in typing,
   * so while you type the only extra frame is the one after each key. A new key restarts it.
   */
  settle(apply: (cooled: number) => void): void {
    clearTimeout(this.settling);
    apply(0);
    let step = 1;
    const next = () => {
      apply(step / SETTLE_STEPS);
      step += 1;
      if (step <= SETTLE_STEPS) this.settling = setTimeout(next, (SETTLE_MS - HOLD_MS) / SETTLE_STEPS);
    };
    this.settling = setTimeout(next, HOLD_MS);
  }

  /**
   * Where the caret is drawn, relative to the host: a hidden copy of the box with the same box and
   * font, holding the text up to the caret, measures it (the usual way to find a caret).
   */
  caret(): { x: number; y: number } {
    if (this.area.offsetWidth !== this.mirrorWidth) {
      this.mirrorWidth = this.area.offsetWidth;
      copyTextStyle(this.area, this.mirror);
    }
    this.mirror.textContent = this.area.value.slice(0, this.area.selectionEnd);
    const end = document.createElement("span");
    end.textContent = "\u200b";
    this.mirror.append(end);
    const x = end.offsetLeft - this.area.scrollLeft;
    // An inline box's offsetTop is the top of its glyphs, not of its line; centre it on the line.
    const y = end.offsetTop + end.offsetHeight / 2 - this.lineHeight / 2 - this.area.scrollTop;
    const field = offsetIn(this.area, this.host);
    return { x: field.x + x, y: field.y + y };
  }

  stop(): void {
    clearTimeout(this.settling);
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

/**
 * One part of a style: given the warmth of a key, it sets itself up and returns how to draw itself
 * at each settling step, from 0 (just typed) to 1 (settled, as without a feel).
 */
type Part = (warmth: number) => (cooled: number) => void;

/**
 * The native caret turns full seal vermilion while you type: a 1 px caret can't carry a subtle
 * colour shift, so it is the full colour or its own.
 */
function vermilionCaret(box: TypingBox): Part {
  const { area } = box;
  const native = area.style.caretColor;
  box.restyle(area, { caretColor: native });
  return () => (cooled) => {
    area.style.caretColor = cooled < 0.6 ? box.vermilion : native;
  };
}

/**
 * The caret line itself glows: the native caret takes the colour, and a soft light the caret's
 * height hugs the line behind it, brighter the faster you type, cooling when you pause. `colour`
 * gives the colour for a warmth.
 */
function glowingCaret(
  box: TypingBox,
  colour: (warmth: number) => string,
  halo: (warmth: number) => string = colour,
): Part {
  const { area } = box;
  const native = area.style.caretColor;
  box.restyle(area, { caretColor: native });
  box.raise();
  const height = Number.parseFloat(getComputedStyle(area).fontSize) * 1.25;
  const line = box.mark({
    left: "0",
    top: "0",
    width: "2px",
    height: `${height}px`,
    borderRadius: "1px",
    opacity: "0",
  });
  // The light at a heat: a core the caret's colour and a halo around it, both cooling together.
  // Heat changes only the colour, never the size, and the halo leans a little right so it stays
  // off the last letter.
  const light = (heat: number) => {
    const lit = colour(heat);
    line.style.background = lit;
    line.style.boxShadow = `1px 0 2px 0.5px ${lit}, 1.5px 0 6px 1px color-mix(in srgb, ${halo(heat)} 45%, transparent)`;
  };
  let brighten: ReturnType<typeof setTimeout> | undefined;
  box.later(() => clearTimeout(brighten));
  // The light is placed after the key's frame; until then it would glow over the new character.
  box.onKey(() => {
    line.style.opacity = "0";
  });
  return (warmth) => {
    const { x, y } = box.caret();
    line.style.transform = `translate(${x - 0.5}px, ${y + (box.lineHeight - height) / 2}px)`;
    return (cooled) => {
      const heat = warmth * (1 - cooled);
      area.style.caretColor = cooled < 1 ? colour(heat) : native;
      light(heat);
      const opacity = (0.55 + 0.45 * warmth) * (1 - cooled);
      // After a key the light comes back in two steps, a soft pulse rather than a flicker. Steps,
      // not an animation, so the page draws just those two frames.
      clearTimeout(brighten);
      // Typing fast leaves no time for the extra step before the next key; the light then comes
      // straight back, and the brief dim reads as a beat.
      if (cooled === 0 && box.gap() > FAST_GAP_MS) {
        line.style.opacity = String(opacity * 0.45);
        brighten = setTimeout(() => {
          line.style.opacity = String(opacity);
        }, FADE_IN_MS);
      } else {
        line.style.opacity = String(opacity);
      }
    };
  };
}

/** A caret light comes back after a key at half strength, then in full this much later. */
const FADE_IN_MS = 30;
/** Keys closer together than this are fast typing, too fast for that extra step. */
const FAST_GAP_MS = 150;

/** Iron in the forge, by warmth: dark red, red, orange, then white-gold (gold on light paper). */
function forgeColour(warmth: number): string {
  const dark = document.documentElement.classList.contains("dark");
  const stops = dark ? ["#7a2414", "#d2441e", "#ff8a26", "#fff1c2"] : ["#6e1c10", "#c23a1e", "#e8721c", "#f0aa22"];
  const at = Math.min(1, Math.max(0, warmth)) * (stops.length - 1);
  const from = Math.min(stops.length - 2, Math.floor(at));
  const mix = Math.round((at - from) * 100);
  return `color-mix(in srgb, ${stops[from + 1]} ${mix}%, ${stops[from]})`;
}

/** Sparks only when typing this warm, a burst at most this often, and how long a burst lasts. */
const SPARK_WARMTH = 0.45;
const SPARK_EVERY_MS = 180;
const SPARK_MS = 80;

/**
 * At speed the forged caret throws off a few small sparks. They are the one motion in these
 * styles, so a burst is kept short enough to be over before the next key at typing speed: it starts
 * after the key's frame, lasts 80 ms and comes at most every 180 ms. Sparks are drawn once and
 * reused, on their own layers, so a burst changes nothing but their position and opacity.
 */
function sparks(box: TypingBox): Part {
  const { lineHeight } = box;
  const pool = Array.from({ length: 6 }, () =>
    box.mark({ left: "0", top: "0", width: "1.5px", height: "5px", borderRadius: "1px", opacity: "0" }),
  );
  let next = 0;
  let burstAt = Number.NEGATIVE_INFINITY;
  return (warmth) => {
    const now = performance.now();
    if (warmth >= SPARK_WARMTH && now - burstAt >= SPARK_EVERY_MS) {
      burstAt = now;
      const { x, y } = box.caret();
      const dark = document.documentElement.classList.contains("dark");
      const core = dark ? "#fff6d8" : "#ff7a10";
      const count = warmth > 0.8 ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const spark = pool[next]!;
        next = (next + 1) % pool.length;
        Object.assign(spark.style, { background: core, boxShadow: `0 0 2px 1px ${forgeColour(dark ? 0.85 : 0.7)}` });
        // A short streak flying out from the caret's top, drawn along its path.
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
        const reach = 9 + 8 * Math.random();
        const turn = `rotate(${angle + Math.PI / 2}rad)`;
        const start = { x: x - 0.75, y: y + lineHeight * 0.25 };
        const from = `translate(${start.x}px, ${start.y}px) ${turn}`;
        const to = `translate(${start.x + Math.cos(angle) * reach}px, ${start.y + Math.sin(angle) * reach}px) ${turn}`;
        spark.animate(
          [
            { transform: `${from} scale(1, 1)`, opacity: 1 },
            { transform: `${to} scale(0.7, 0.4)`, opacity: 0 },
          ],
          { duration: SPARK_MS, easing: "cubic-bezier(0.2, 0.7, 0.4, 1)" },
        );
      }
    }
    return () => {};
  };
}

/** Warm edge: the composer's edge glows softly while you type, brighter the faster, then settles. */
function warmEdge(box: TypingBox): Part {
  const frame = box.area.closest<HTMLElement>("[data-typing-frame]") ?? box.host;
  if (getComputedStyle(frame).position === "static") box.restyle(frame, { position: "relative" });
  const edge = box.mark({ inset: "-1px", borderRadius: getComputedStyle(frame).borderRadius, opacity: "0" }, frame);
  return (warmth) => {
    edge.style.boxShadow = `0 0 0 1px color-mix(in srgb, ${box.vermilion} 55%, transparent), 0 0 14px color-mix(in srgb, ${box.vermilion} 35%, transparent)`;
    return (cooled) => {
      edge.style.opacity = String((0.35 + 0.6 * warmth) * (1 - cooled));
    };
  };
}

const TEXT_STYLE = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderStyle",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontVariant",
  "letterSpacing",
  "wordSpacing",
  "lineHeight",
  "textAlign",
  "textIndent",
  "textTransform",
  "tabSize",
] as const;

/** Gives `copy` the box and text metrics of `area`, so text wraps and sits exactly as there. */
function copyTextStyle(area: HTMLTextAreaElement, copy: HTMLElement): void {
  const style = getComputedStyle(area);
  for (const property of TEXT_STYLE) copy.style[property] = style[property];
  Object.assign(copy.style, { whiteSpace: area.wrap === "off" ? "pre" : "pre-wrap", overflowWrap: "break-word" });
}

/**
 * Where `element` sits in `host`'s padding box, in the CSS pixels absolute positioning uses. The
 * app's zoom setting scales the whole page with a transform, so screen distances are divided by
 * that scale.
 */
function offsetIn(element: HTMLElement, host: HTMLElement): { x: number; y: number } {
  const box = element.getBoundingClientRect();
  const hostBox = host.getBoundingClientRect();
  const scale = host.offsetWidth ? hostBox.width / host.offsetWidth : 1;
  return {
    x: (box.left - hostBox.left) / scale - host.clientLeft,
    y: (box.top - hostBox.top) / scale - host.clientTop,
  };
}
