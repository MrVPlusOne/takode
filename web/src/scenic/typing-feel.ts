/**
 * Typing feel: the caret is iron in the forge. The faster you type, the hotter it glows, from dark
 * red through orange to white-gold, while the composer's edge glows warm and every key throws a
 * small burst out right of the caret: sparks from the forge at night, and by day a flake of gold
 * leaf drifting out on the air and falling. The text box draws its text and caret itself, exactly
 * as without a feel: nothing here renders text, hides the caret or touches the text's position or
 * weight. Each part only colours the native caret or draws around it.
 *
 * No added latency beyond the bursts: the work for a key runs after the frame showing that key has
 * been painted (only the caret light is dimmed as the key lands, so it doesn't glow a frame over
 * the new character, and comes back in two steps after it), and the settling, which waits for a
 * pause in typing, is a few discrete steps rather than an animation. An animation keeps the page
 * drawing a frame on every display tick, so a key typed meanwhile waits for the next tick (about
 * 8 ms on average, measured); between steps the page draws nothing, so a key is drawn at once, as
 * with no feel. The thrown bursts are the one real motion, so while one is in the air a key waits
 * for the next tick. Every input counts the same, IME composition (pinyin) included, so it works
 * the same for Chinese. Everything settles soon after the last key, so an idle box draws nothing,
 * and nothing plays with reduced motion.
 */
import { ballisticPath } from "../components/completion-celebration.js";
import { splitTrailingTranscriptionTag } from "../../shared/transcription-tag.js";
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
  const parts: Part[] = [
    glowingCaret(box, forgeColour),
    throwing(box, frame),
    ...(frame ? [warmEdge(box, frame)] : []),
  ];
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
  vermilion = "";
  readonly lineHeight: number;
  private heat = 0;
  private typedAt = 0;
  private lastGap = Number.POSITIVE_INFINITY;
  /** Keys that typed something since the last time a feel took them. */
  private keys = 0;
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

  /** The vermilion of the scenic seal, by day or by night. */
  private readColours(): void {
    const dark = document.documentElement.classList.contains("dark");
    this.vermilion = dark ? "#ef6a4f" : "#c8382c";
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
    const typed = (event: Event) => {
      if ((event as InputEvent).inputType?.startsWith("insert")) this.keys += 1;
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

  /** How many keys typed something since the last call: each one gets its own throw. */
  takeKeys(): number {
    const keys = this.keys;
    this.keys = 0;
    return keys;
  }

  /**
   * Where thrown things have room, relative to the host: from the box's top down to its bottom and
   * right edges, or, in a `frame` (the composer's card), down to the card's own bottom and right,
   * around its buttons.
   */
  space(frame: HTMLElement | null): Space {
    const { x, y } = offsetIn(this.area, this.host);
    if (!frame) return { top: y, bottom: y + this.area.offsetHeight, right: x + this.area.offsetWidth, avoid: [] };
    const at = offsetIn(frame, this.host);
    const avoid = [...frame.querySelectorAll<HTMLElement>("button, a, input, select, [role=button]")]
      .filter((element) => element.offsetWidth)
      .map((element) => {
        const { x: left, y: top } = offsetIn(element, this.host);
        return { left, top, right: left + element.offsetWidth, bottom: top + element.offsetHeight };
      });
    return { top: y, bottom: at.y + frame.offsetHeight - 4, right: at.x + frame.offsetWidth - 6, avoid };
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
    return this.at(this.area.selectionEnd);
  }

  /**
   * What comes after the caret: whether its own line goes on (typing mid-line), and if not, the
   * top of the next line below with text, relative to the host. The "[transcribed]" tag that
   * dictation leaves on the last line is Takode's label, not the user's text, so it doesn't count:
   * typing after dictating, before the tag, throws as usual.
   */
  ahead(): { midLine: boolean; nextText: number | null } {
    const { value, selectionEnd } = this.area;
    const rest = splitTrailingTranscriptionTag(value.slice(selectionEnd)).text;
    const lineEnd = rest.indexOf("\n");
    const midLine = /\S/.test(lineEnd < 0 ? rest : rest.slice(0, lineEnd));
    const next = lineEnd < 0 ? -1 : rest.slice(lineEnd).search(/\S/);
    if (midLine || next < 0) return { midLine, nextText: null };
    return { midLine, nextText: this.at(selectionEnd + lineEnd + next).y };
  }

  /** Where the text at `index` is drawn (its line's top), as for the caret. */
  private at(index: number): { x: number; y: number; line: number } {
    if (this.area.offsetWidth !== this.mirrorWidth) {
      this.mirrorWidth = this.area.offsetWidth;
      copyTextStyle(this.area, this.mirror);
    }
    this.mirror.textContent = this.area.value.slice(0, index);
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

/** At most this many thrown things are in the air at once, so fast typing doesn't make a cloud. */
const MAX_IN_AIR = 12;

/** How a kind of thrown thing looks and moves. Ranges are [least, most]; each throw picks within them. */
interface Kind {
  /** How many leave together in one key's burst. */
  burst: [number, number];
  /** Width and height in px, and how it is drawn. */
  size: [number, number];
  style: Partial<CSSStyleDeclaration>;
  /** Flight time in ms. */
  life: [number, number];
  /** Its path: thrown on an arc, or carried out on the air and drifting down. */
  path: Thrown | Drifting;
  /** Opacity and scale at even points of the flight. */
  opacity: number[];
  scale: number[];
  /** Turning over the flight, in degrees, and how many times it flips like a leaf. */
  spin?: [number, number];
  flips?: number;
  /** Filters at even points of the flight (sparks cool from white-gold to red). */
  filter?: string[];
}

/** Thrown on the arc the completion celebration's sparks fly (`ballisticPath`). */
interface Thrown {
  /** Launch angle in radians, 0 straight right and negative up, and flatter on a later line. */
  angle: [number, number];
  lowAngle?: [number, number];
  /** Distance thrown and pull down over a whole flight, in px. */
  speed: [number, number];
  gravity: number;
  /** Flung fast and slowed by the air (`FLUNG`), rather than flying at an even pace. */
  flung?: boolean;
  /** Drawn along its path, like a streak. */
  along?: boolean;
}

/**
 * Carried out sideways on the air, slowing, then sinking and swaying from side to side as it
 * settles, like a leaf. It sinks as far as the box has room below the line, at most `sink`.
 */
interface Drifting {
  reach: [number, number];
  sink: [number, number];
  /** Side-to-side sway in px, and how many times it swings over the flight. */
  sway: number;
  swings: number;
}

const ARC_OPACITY = [0, 1, 1, 0.95, 0.6, 0];

/**
 * At night, sparks from the forge: round embers, a third of them thin streaks, cooling as they fly
 * and burning out fast. One in six instead shrinks into a small red ember that floats on farther.
 */
function spark(index: number): Kind {
  const streak = index % 3 === 0;
  if (index % 6 === 5) {
    return {
      burst: [2, 3],
      size: [2.4, 2.4],
      // A soft red glow, so it reads as an ember.
      style: { borderRadius: "50%", background: "#ff9a3a", boxShadow: "0 0 3px 1.5px rgba(255, 70, 30, 0.55)" },
      life: [700, 1000],
      path: { angle: [-0.5, -0.1], lowAngle: [-0.2, 0.12], speed: [80, 110], gravity: 20, flung: true },
      opacity: [0, 1, 1, 0.9, 0.7, 0],
      scale: [1, 0.85, 0.7, 0.6, 0.5, 0.45],
      filter: [
        "brightness(1.3)",
        "brightness(1.15)",
        "brightness(1) saturate(1.3) hue-rotate(-8deg)",
        "brightness(0.85) saturate(1.6) hue-rotate(-18deg)",
      ],
    };
  }
  return {
    burst: [2, 3],
    size: streak ? [6, 1.4] : [2.5, 2.5],
    style: {
      borderRadius: streak ? "1px" : "50%",
      background: "#ffa640",
      boxShadow: `0 0 2px 0.5px ${forgeColour(0.65)}`,
    },
    life: [260, 380],
    path: { angle: [-1.0, -0.35], lowAngle: [-0.3, 0.1], speed: [42, 70], gravity: 60, along: streak },
    opacity: ARC_OPACITY,
    scale: [1, 1, 0.9, 0.85, 0.75, 0.65],
    filter: ["brightness(1.35) saturate(0.85)", "brightness(1.2)", "brightness(1)", "brightness(0.85) saturate(1.3)"],
  };
}

/** By day, one flake of gold leaf a key, drifting out on the air and settling under the line. */
const GOLD_LEAF: Kind = {
  burst: [1, 1],
  size: [8.5, 6.5],
  style: {
    clipPath: "polygon(8% 30%, 40% 0%, 92% 12%, 100% 62%, 62% 100%, 0% 78%)",
    background: "linear-gradient(135deg, #f8e391, #cf9a2e 55%, #f4d77a)",
  },
  life: [1500, 2000],
  path: { reach: [60, 120], sink: [28, 40], sway: 6, swings: 1.5 },
  opacity: [0, 1, 1, 0.95, 0.8, 0],
  scale: [0.8, 1, 1, 1, 1, 0.9],
  spin: [-40, 40],
  flips: 1,
};

/**
 * Every key that types something throws one small burst out right of the caret, so typing and
 * effect match one to one: sparks from the forge at night, a flake of gold leaf by day, all of a
 * burst leaving together. It never covers the next character, and nothing is thrown when the
 * caret's line goes on after it (typing mid-line), since it would cross that text; the caret's
 * glow and the edge still answer each key. On a later line of a message sparks fly flat or fall,
 * so they never cross the line above. Everything fades out before the edges of its room: the text
 * box, or in the composer the card around it, where leaves can fall into the empty strip beside
 * the buttons but fade out around each button, and above any text on a later line. At most twelve
 * are in the air; when all are, the oldest is retired, so every key still throws. Marks are drawn
 * once and reused on their own layers, and fly by transform, opacity and filter alone, which the
 * compositor runs.
 */
function throwing(box: TypingBox, frame: HTMLElement | null): Part {
  const { lineHeight } = box;
  const pool = Array.from({ length: MAX_IN_AIR }, () => box.mark({ left: "0", top: "0", opacity: "0" }));
  // Marks in the air, oldest first, and those of them told to hurry.
  const flying = new Map<HTMLElement, Animation>();
  const hurried = new Set<HTMLElement>();
  // Each mark is drawn once for the time of day and after that only moves, so a throw paints
  // nothing new.
  let drawnFor: boolean | undefined;
  let kinds: Kind[] = [];
  return () => {
    const keys = box.takeKeys();
    if (!keys) return () => {};
    const { midLine, nextText } = box.ahead();
    if (midLine) return () => {};
    const { x, y, line } = box.caret();
    const space = box.space(frame);
    // Text on a later line (typing at the end of an earlier line): things fade out above it.
    if (nextText !== null) space.bottom = Math.min(space.bottom, nextText);
    const dark = document.documentElement.classList.contains("dark");
    if (dark !== drawnFor) {
      drawnFor = dark;
      kinds = pool.map((mark, index) => {
        const kind = dark ? spark(index) : GOLD_LEAF;
        const [width, height] = kind.size;
        Object.assign(mark.style, { width: `${width}px`, height: `${height}px`, ...kind.style });
        return kind;
      });
    }
    for (let key = 0; key < keys; key++) {
      // Each key throws one small burst, all of it leaving together; keys that landed in the same
      // frame leave a beat apart.
      const size = Math.round(between(kinds[0]!.burst[0], kinds[0]!.burst[1] + 0.49));
      for (let i = 0; i < size; i++) {
        const free = pool.filter((candidate) => !flying.has(candidate));
        // With every mark in the air, the oldest is retired so this key still throws.
        if (!free.length) {
          const [oldest, flight] = flying.entries().next().value!;
          flight.cancel();
          flying.delete(oldest);
          free.push(oldest);
        }
        const mark = free[Math.floor(Math.random() * free.length)]!;
        const kind = kinds[pool.indexOf(mark)]!;
        const start = { x: x + 6, y: y + lineHeight * 0.45 - kind.size[1] / 2 };
        const { path } = kind;
        const drifts = "reach" in path;
        const flight = mark.animate(keyframes(kind, start, line > 0, space), {
          duration: between(...kind.life),
          delay: key * 40,
          easing: !drifts && path.flung ? FLUNG : "linear",
          fill: "backwards",
        });
        flying.set(mark, flight);
        hurried.delete(mark);
        flight.onfinish = () => flying.delete(mark);
      }
    }
    // Only the newest few leaves drift at their calm pace; older ones hurry to settle, so typing on
    // keeps a few in the air rather than a band of them, and the last ones drift on when you pause.
    const drifting = [...flying].filter(([mark]) => "reach" in kinds[pool.indexOf(mark)]!.path);
    for (const [mark, flight] of drifting.slice(0, -CALM_DRIFTS)) {
      if (hurried.has(mark)) continue;
      hurried.add(mark);
      flight.updatePlaybackRate(HURRY);
    }
    return () => {};
  };
}

/**
 * A flung throw's pace: it covers over half its path in the first fifth of its life, so it stays
 * ahead of the next characters even in fast typing, then drifts.
 */
const FLUNG = "cubic-bezier(0.2, 0.8, 0.4, 1)";

/** How many leaves drift at their calm pace at once, and how much faster the older ones settle. */
const CALM_DRIFTS = 3;
const HURRY = 3;

/** A box in host px. */
interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Where thrown things have room: edges they fade out before, and buttons they fade out around. */
interface Space {
  top: number;
  bottom: number;
  right: number;
  avoid: Rect[];
}

/** Things fade out over this many px before an edge, and from this far around a button. */
const EDGE_FADE = 6;
const BUTTON_CLEARANCE = 4;

/** Keyframes for a drift; enough that its sway reads as a curve. */
const DRIFT_STEPS = 16;

/**
 * A thrown thing's flight from `start` as keyframes: on its arc or drift, turning, flipping or
 * drawn along its path by kind, and faded out before the edges of its space and around its
 * buttons, so it never crosses a banner above the box or a button of the composer.
 */
function keyframes(kind: Kind, start: { x: number; y: number }, low: boolean, space: Space): Keyframe[] {
  const [width, height] = kind.size;
  const room = (px: number) => Math.min(1, Math.max(0, px / EDGE_FADE));
  const spin = kind.spin ? between(...kind.spin) : 0;
  const { path } = kind;
  const points =
    "reach" in path
      ? drift(path, Math.min(between(...path.sink), Math.max(0, space.bottom - start.y - height - 2)))
      : arc(path, low);
  return points.map(([dx, dy, heading], step) => {
    const t = step / (points.length - 1);
    const left = start.x + dx;
    const at = start.y + dy;
    // A leaf or flake flips by narrowing and widening.
    const flip = kind.flips ? Math.cos(t * kind.flips * Math.PI * 2) : 1;
    const scale = sample(kind.scale, t);
    return {
      transform: `translate(${left}px, ${at}px) rotate(${heading ?? `${spin * t}deg`}) scale(${scale * flip}, ${scale})`,
      opacity:
        sample(kind.opacity, t) *
        room(at - space.top) *
        room(space.bottom - at - height) *
        room(space.right - left - width) *
        Math.min(
          1,
          ...space.avoid.map((button) =>
            room(gap({ left, top: at, right: left + width, bottom: at + height }, button) - BUTTON_CLEARANCE),
          ),
        ),
      filter: kind.filter ? kind.filter[Math.min(kind.filter.length - 1, Math.floor(t * kind.filter.length))] : "none",
    };
  });
}

/** Points of an arc, with the heading of a thing drawn along its path. */
function arc(path: Thrown, low: boolean): Array<[number, number, string?]> {
  const [least, most] = low && path.lowAngle ? path.lowAngle : path.angle;
  const angle = between(least, most);
  const speed = between(...path.speed);
  const points = ballisticPath(angle, speed, path.gravity);
  return points.map(([dx, dy], step) => {
    const t = step / (points.length - 1);
    const heading = Math.atan2(Math.sin(angle) * speed + path.gravity * t, Math.cos(angle) * speed);
    return [dx, dy, path.along ? `${heading}rad` : undefined];
  });
}

/**
 * Points of a drift: carried out fast and slowing, sinking `sink` px more and more as it slows,
 * and swaying wider as it settles, tilting the way it swings.
 */
function drift(path: Drifting, sink: number): Array<[number, number, string]> {
  const reach = between(...path.reach);
  const tilt = between(-15, 15);
  return Array.from({ length: DRIFT_STEPS + 1 }, (_, step) => {
    const t = step / DRIFT_STEPS;
    const swing = 2 * Math.PI * path.swings * t;
    const dx = reach * (1 - (1 - t) ** 3) + path.sway * Math.sin(swing) * t;
    // It starts sinking at once, so it leaves the line, then keeps sinking slowly as it settles.
    const dy = sink * (0.4 * (1 - (1 - t) ** 3) + 0.6 * t ** 1.6);
    return [dx, dy, `${tilt * t + 20 * Math.cos(swing) * t}deg`];
  });
}

/** How far apart two boxes are, 0 when they overlap. */
function gap(a: Rect, b: Rect): number {
  return Math.max(0, b.left - a.right, a.left - b.right, b.top - a.bottom, a.top - b.bottom);
}

/** The value at `t` (0 to 1) of values given at even points, between its neighbours. */
function sample(values: number[], t: number): number {
  const at = t * (values.length - 1);
  const from = Math.min(values.length - 2, Math.floor(at));
  return values[from]! + (values[from + 1]! - values[from]!) * (at - from);
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
