/**
 * Typing feel: the caret is iron in the forge. The faster you type, the hotter it glows, from dark
 * red through orange to white-gold, while the composer's edge glows warm and things fly out right
 * of the caret: sparks from the forge at night, plum petals by day. The text box draws its text and caret
 * itself, exactly as without a feel: nothing here renders text, hides the caret or touches the
 * text's position or weight. Each part only colours the native caret or draws around it.
 *
 * No added latency beyond the drifting: the work for a key runs after the frame showing that key
 * has been painted (only the caret light is dimmed as the key lands, so it doesn't glow a frame
 * over the new character, and comes back in two steps after it), and the settling, which waits for
 * a pause in typing, is a few discrete steps rather than an animation. An animation keeps the page
 * drawing a frame on every display tick, so a key typed meanwhile waits for the next tick (about
 * 8 ms on average, measured); between steps the page draws nothing, so a key is drawn at once, as
 * with no feel. The drifters are the one real motion, so while one is in the air a key waits for
 * the next tick (measured: about half a frame on the median).
 * Every input counts the same, IME composition (pinyin) included, so it works the same for Chinese.
 * Everything settles soon after the last key, so an idle box draws nothing, and nothing plays with
 * reduced motion.
 */
import { ballisticPath } from "../components/completion-celebration.js";
import { scenicMotionAllowed } from "./scenic-styles.js";

/** Marks a text box as a chat input, which gets the typing feel and the composing-text fix. */
export const CHAT_INPUT_ATTRIBUTE = "data-chat-input";
/** On a chat input while an input method (pinyin) is composing text not yet committed. */
export const COMPOSING_ATTRIBUTE = "data-composing";

/**
 * Gives every chat input (a text box marked with `data-chat-input`) its typing feel while it has
 * focus and a scenic background is on, and marks it `data-composing` while an input method is
 * composing, whatever the background (the stylesheet keeps composing pinyin readable at night).
 * One place for every chat input: the composers, side chats, comments and answers. Returns a stop
 * function.
 */
export function installTypingFeel(scenicOn: () => boolean): () => void {
  let running: { area: HTMLTextAreaElement; handle: TypingFeelHandle } | null = null;
  const chatInput = (target: EventTarget | null) =>
    target instanceof HTMLTextAreaElement && target.hasAttribute(CHAT_INPUT_ATTRIBUTE) ? target : null;
  const focused = (event: Event) => {
    const area = chatInput(event.target);
    if (!area || running?.area === area) return;
    running?.handle.stop();
    running = scenicOn() ? { area, handle: attachTypingFeel(area) } : null;
  };
  const left = (event: Event) => {
    if (!running || event.target !== running.area) return;
    running.handle.stop();
    running = null;
  };
  const composing = (event: Event) => {
    chatInput(event.target)?.toggleAttribute(COMPOSING_ATTRIBUTE, event.type !== "compositionend");
  };
  const listeners: Array<[string, (event: Event) => void]> = [
    ["focusin", focused],
    ["focusout", left],
    ["compositionstart", composing],
    ["compositionend", composing],
  ];
  for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
  return () => {
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
    running?.handle.stop();
    running = null;
  };
}

/** A running typing feel. */
export interface TypingFeelHandle {
  /** Stops the feel and puts the box back as it was. */
  stop(): void;
}

/**
 * Gives `area` the typing feel. Marks are drawn in its containing block (where its absolutely
 * positioned children would sit); the warm edge glows around the closest `[data-typing-frame]`,
 * and without one there is no edge. Does nothing with reduced motion.
 */
export function attachTypingFeel(area: HTMLTextAreaElement): TypingFeelHandle {
  const host = area.offsetParent instanceof HTMLElement ? area.offsetParent : area.parentElement;
  if (!scenicMotionAllowed() || !host) return { stop() {} };
  const box = new TypingBox(area, host);
  const frame = area.closest<HTMLElement>("[data-typing-frame]");
  const parts: Part[] = [glowingCaret(box, forgeColour), drift(box), ...(frame ? [warmEdge(box, frame)] : [])];
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
  /** Whether an IME (pinyin) is composing text that isn't committed yet. */
  composing = false;
  private readonly mirror = document.createElement("div");
  private readonly cleanups: Array<() => void> = [];
  /** Whether marks are drawn behind the box's text (it has no background of its own). */
  private readonly behind: boolean;
  /** The box width the mirror's style was copied at; copied again when it changes. */
  private mirrorWidth = -1;
  private settling: ReturnType<typeof setTimeout> | undefined;

  constructor(
    readonly area: HTMLTextAreaElement,
    readonly host: HTMLElement,
  ) {
    const style = getComputedStyle(area);
    this.lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    // Marks sit behind the text when the box is see-through; a box with its own background would
    // hide them, so then they sit just above it.
    this.behind = /^(transparent|rgba\(.*,\s*0\))$/.test(style.backgroundColor);
    this.readColours();
    // The theme can change while typing (night falls on "colour by day, ink at night").
    const theme = new MutationObserver(() => this.readColours());
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.cleanups.push(() => theme.disconnect());
    Object.assign(this.mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px" });
    this.mirror.setAttribute("aria-hidden", "true");
    document.body.append(this.mirror);
    this.cleanups.push(() => this.mirror.remove());
    const composing = (event: Event) => {
      this.composing = event.type !== "compositionend";
    };
    for (const type of ["compositionstart", "compositionend"]) area.addEventListener(type, composing);
    this.cleanups.push(() => {
      for (const type of ["compositionstart", "compositionend"]) area.removeEventListener(type, composing);
    });
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

  /** Where the box's top edge is, relative to the host. */
  top(): number {
    return offsetIn(this.area, this.host).y;
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
    if (!this.behind) return;
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
      {
        position: "absolute",
        pointerEvents: "none",
        zIndex: this.behind ? "0" : "2",
        willChange: "opacity, transform",
      },
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
   * Where the caret is drawn, relative to the host, and on which line of the text (0 the first): a
   * hidden copy of the box with the same box and font, holding the text up to the caret, measures
   * it (the usual way to find a caret).
   */
  caret(): { x: number; y: number; line: number } {
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
    const top = end.offsetTop + end.offsetHeight / 2 - this.lineHeight / 2;
    const line = Math.max(
      0,
      Math.round((top - Number.parseFloat(this.mirror.style.paddingTop || "0")) / this.lineHeight),
    );
    const field = offsetIn(this.area, this.host);
    return { x: field.x + x, y: field.y + top - this.area.scrollTop, line };
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
 * The caret line itself glows: the native caret takes the colour, and a light behind it hugs the
 * line, reaching a little above and below it but hardly sideways, so it never covers the letters
 * on either side, mid-paragraph included. Brighter the faster you type, cooling when you pause.
 * `colour` gives the colour for a warmth.
 */
function glowingCaret(box: TypingBox, colour: (warmth: number) => string): Part {
  const { area } = box;
  const native = area.style.caretColor;
  box.restyle(area, { caretColor: native });
  box.raise();
  const height = Number.parseFloat(getComputedStyle(area).fontSize) * 1.25 + 2 * GLOW_REACH;
  const line = box.mark({
    left: "0",
    top: "0",
    width: "2px",
    height: `${height}px`,
    borderRadius: "1px",
    opacity: "0",
  });
  // The light at a heat: the caret's colour along the line, fading out above and below it, with
  // only a hairline of glow at its sides.
  const light = (heat: number) => {
    const lit = colour(heat);
    line.style.background = `linear-gradient(to bottom, transparent, ${lit} 25%, ${lit} 75%, transparent)`;
    line.style.boxShadow = `0 0 1px 0 ${lit}`;
  };
  let brighten: ReturnType<typeof setTimeout> | undefined;
  box.later(() => clearTimeout(brighten));
  // The light is placed after the key's frame; until then it would glow over the new character.
  box.onKey(() => {
    line.style.opacity = "0";
  });
  return (warmth) => {
    const { x, y } = box.caret();
    line.style.transform = `translate(${x - 1}px, ${y + (box.lineHeight - height) / 2}px)`;
    return (cooled) => {
      const heat = warmth * (1 - cooled);
      area.style.caretColor = cooled < 1 ? colour(heat) : native;
      light(heat);
      // While pinyin is being composed, the browser may highlight it; the caret's light would add to
      // that highlight right where the pinyin ends, so it stays off until the text is committed.
      const opacity = box.composing ? 0 : (0.55 + 0.45 * warmth) * (1 - cooled);
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

/** How far the caret's light reaches above and below the caret, in px. */
const GLOW_REACH = 4;

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

/** Drifting starts when typing is this warm, and one more drifts out at most this often. */
const DRIFT_WARMTH = 0.25;
const DRIFT_EVERY_MS = 320;

/** How a kind of drifter looks and moves. Ranges are [least, most]; each one picks within them. */
interface Drifter {
  /** Width and height in px, and how it is drawn. */
  size: [number, number];
  style: (box: TypingBox) => Partial<CSSStyleDeclaration>;
  /** Flight time in ms, and how far it goes right and down (negative is up), in px. */
  life: [number, number];
  right: [number, number];
  down: [number, number];
  /** Side-to-side wander, in px, and how many times it wanders over its flight. */
  sway: number;
  waves: number;
  /** Opacity, scale, blur (px) and turn (degrees) at six even points of its flight. */
  opacity: number[];
  scale: number[];
  blur?: number[];
  turn?: [number, number];
}

/**
 * Plum petals by day: small pink petals blown out to the right, fast at first so they stay ahead of
 * fast typing, turning as they settle below the line.
 */
const PETAL: Drifter = {
  size: [8.5, 5.6],
  style: () => ({
    borderRadius: "60% 40% 60% 40%",
    background: "linear-gradient(135deg, #f7cbd4, #e696a9)",
  }),
  life: [700, 950],
  right: [44, 70],
  down: [8, 16],
  sway: 2,
  waves: 1,
  opacity: [0, 0.95, 0.9, 0.8, 0.5, 0],
  scale: [0.8, 1, 1, 1, 0.95, 0.9],
  turn: [-160, 160],
};

/** At night a burst of sparks comes at most this often, so each strike of the hammer stays distinct. */
const STRIKE_EVERY_MS = 400;

/** How the night's forge sparks fly. Ranges are [least, most]; each spark picks within them. */
const SPARKS = {
  /** Sparks in a burst, warm and at full heat. */
  count: [2, 4],
  /** Flight time in ms: long enough to see the arc, short of a slow drift. */
  life: [320, 460],
  /** Launch angle in radians, 0 straight right, negative up; flatter on a later line of a message. */
  angle: [-1.0, -0.35],
  lowAngle: [-0.3, 0.1],
  /** Distance thrown and pull down over a whole flight, in px (see `ballisticPath`). */
  speed: [42, 70],
  gravity: 60,
} as const;

/**
 * What flies out right of the caret, so it never covers the next character: at night sparks from
 * the forge on falling arcs (round embers and a thin streak, white-gold cooling to red), by day plum
 * petals blown out to the right. Once typing is warm, one more flight starts at most every 320 ms
 * by day, and a burst at most every 400 ms at night.
 * When there is text after the caret (typing mid-paragraph) nothing flies, since it would cross
 * that text; the caret's glow and the edge still answer each key. On a later line of a message the
 * sparks fly flat or fall, so they never cross the line above, and everything fades out before the
 * top of the text box. Marks are drawn once and reused on their own layers, and move by transform,
 * opacity and filter alone, which the compositor runs.
 */
function drift(box: TypingBox): Part {
  const { lineHeight } = box;
  const pool = Array.from({ length: 10 }, () => box.mark({ left: "0", top: "0", opacity: "0" }));
  let next = 0;
  let driftAt = Number.NEGATIVE_INFINITY;
  const take = () => {
    const mark = pool[next]!;
    next = (next + 1) % pool.length;
    return mark;
  };
  const release = (warmth: number) => {
    const { area } = box;
    if (/\S/.test(area.value.slice(area.selectionEnd))) return;
    const { x, y, line } = box.caret();
    const ceiling = box.top();
    if (!document.documentElement.classList.contains("dark")) {
      const mark = take();
      const [width, height] = PETAL.size;
      Object.assign(mark.style, { width: `${width}px`, height: `${height}px`, ...PETAL.style(box) });
      mark.animate(path(PETAL, x + 5, y + lineHeight / 2 - height / 2, ceiling), {
        duration: between(...PETAL.life),
        easing: "linear",
      });
      return;
    }
    const count = Math.round(SPARKS.count[0] + (SPARKS.count[1] - SPARKS.count[0]) * warmth);
    const start = { x: x + 6, y: y + lineHeight * 0.45 };
    for (let i = 0; i < count; i++) {
      // The first spark of a burst is a thin streak drawn along its flight; the rest are embers.
      const streak = i === 0;
      const mark = take();
      Object.assign(mark.style, {
        width: streak ? "6px" : "2.5px",
        height: streak ? "1.4px" : "2.5px",
        borderRadius: streak ? "1px" : "50%",
        background: "#ffa640",
        boxShadow: `0 0 2px 0.5px ${forgeColour(0.65)}`,
      });
      const [low, high] = line > 0 ? SPARKS.lowAngle : SPARKS.angle;
      const angle = between(low, high);
      const speed = between(...SPARKS.speed);
      mark.animate(sparkPath(start, angle, speed, ceiling), {
        duration: between(...SPARKS.life),
        easing: "linear",
      });
    }
  };
  return (warmth) => {
    if (warmth < DRIFT_WARMTH) return () => {};
    const now = performance.now();
    const every = document.documentElement.classList.contains("dark") ? STRIKE_EVERY_MS : DRIFT_EVERY_MS;
    if (now - driftAt >= every) {
      driftAt = now;
      release(warmth);
    }
    return () => {};
  };
}

/**
 * A spark's flight from `start` as keyframes, on the arc the completion celebration's sparks fly:
 * drawn along its path, white-gold cooling through orange to red, fading out at the end and before
 * `ceiling` (the top of the text box).
 */
function sparkPath(start: { x: number; y: number }, angle: number, speed: number, ceiling: number): Keyframe[] {
  const cooling = [
    "brightness(1.35) saturate(0.85)",
    "brightness(1.2)",
    "brightness(1)",
    "brightness(0.85) saturate(1.3)",
  ];
  const flight = ballisticPath(angle, speed, SPARKS.gravity);
  return flight.map(([dx, dy], step) => {
    const t = step / (flight.length - 1);
    const heading = Math.atan2(Math.sin(angle) * speed + SPARKS.gravity * t, Math.cos(angle) * speed);
    const at = start.y + dy;
    // Sparks show up already flying, a little out from the caret, rather than as a flash at it.
    const fade = t === 0 ? 0 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
    return {
      transform: `translate(${start.x + dx}px, ${at}px) rotate(${heading}rad) scale(${1 - 0.35 * t})`,
      opacity: fade * Math.min(1, Math.max(0, (at - ceiling) / CEILING_FADE)),
      filter: cooling[Math.min(cooling.length - 1, Math.floor(t * cooling.length))],
    };
  });
}

/** Drifters fade out over this many px before the top of the text box. */
const CEILING_FADE = 6;

/**
 * A drifter's flight from (x, y) as keyframes: out to the right, wandering side to side, faded out
 * above `ceiling` (the top of the text box).
 */
function path(kind: Drifter, x: number, y: number, ceiling: number): Keyframe[] {
  const right = between(...kind.right);
  const down = between(...kind.down);
  const phase = Math.random() * Math.PI * 2;
  const turn = kind.turn ? between(...kind.turn) : 0;
  return kind.opacity.map((opacity, step) => {
    const t = step / (kind.opacity.length - 1);
    // Fast at first, then drifting: an ease-out along the way.
    const along = t * (2 - t);
    const wander = kind.sway * Math.sin(phase + t * kind.waves * Math.PI * 2);
    const at = y + down * along + wander;
    return {
      transform: `translate(${x + right * along}px, ${at}px) rotate(${turn * t}deg) scale(${kind.scale[step]})`,
      // Fades out as it nears the top of the text box, so it never drifts over what is above it.
      opacity: opacity * Math.min(1, Math.max(0, (at - ceiling) / CEILING_FADE)),
      filter: kind.blur ? `blur(${kind.blur[step]}px)` : "none",
    };
  });
}

function between(least: number, most: number): number {
  return least + Math.random() * (most - least);
}

/** Warm edge: the composer's edge glows softly while you type, brighter the faster, then settles. */
function warmEdge(box: TypingBox, frame: HTMLElement): Part {
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
