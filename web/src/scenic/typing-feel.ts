/**
 * Typing feel: the caret comes alive while you type. The text box draws its text and caret itself,
 * exactly as without a feel: nothing here renders text, hides the caret or touches the text's
 * position or weight. Each style only colours the native caret or draws a mark beside it.
 *
 * No added latency: the work for a key runs after the frame showing that key has been painted, and
 * the settling, which waits for a pause in typing, is a few discrete steps rather than an
 * animation. An animation keeps the page drawing a frame on every display tick, so a key typed
 * meanwhile waits for the next tick (about 8 ms on average, measured); between steps the page draws
 * nothing, so a key is drawn at once, as with no feel. Every input counts the same, IME composition (pinyin) included, so it works
 * the same for Chinese. Everything settles 1.2 s after the last key, so an idle box draws nothing,
 * and nothing plays with reduced motion.
 */
import { scenicMotionAllowed } from "./scenic-styles.js";

export type TypingFeel = "vermilion" | "glow" | "dot" | "dot-edge" | "edge";

/** The styles, in the order to offer them, with a short description of each. */
export const TYPING_FEELS: ReadonlyArray<{ id: TypingFeel; label: string; description: string }> = [
  {
    id: "vermilion",
    label: "Vermilion caret",
    description: "The caret turns seal vermilion while you type and goes back to ink when you pause.",
  },
  {
    id: "glow",
    label: "Glowing caret",
    description:
      "The vermilion caret has a small warm glow just ahead of it that brightens with each key and fades when you pause.",
  },
  {
    id: "dot",
    label: "Ink dot",
    description: "Each key re-inks a small vermilion dot at the foot of the caret; it fades when you pause.",
  },
  {
    id: "dot-edge",
    label: "Ink dot and warm edge",
    description: "The ink dot at the caret, and the composer's edge glows softly while you type.",
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
  if (feel === "vermilion" || feel === "glow") parts.push(vermilionCaret(box));
  if (feel === "glow") parts.push(glow(box));
  if (feel === "dot" || feel === "dot-edge") parts.push(inkDot(box));
  if (feel === "dot-edge" || feel === "edge") parts.push(warmEdge(box));
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
 * A small warm glow just ahead of the caret, so it never tints the last character: vermilion by day,
 * with a bright gold core at night so it reads as light on dark paper.
 */
function glow(box: TypingBox): Part {
  const { lineHeight } = box;
  const size = 16;
  box.raise();
  const mark = box.mark({
    left: "0",
    top: "0",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    opacity: "0",
  });
  return (warmth) => {
    const { x, y } = box.caret();
    const dark = document.documentElement.classList.contains("dark");
    Object.assign(mark.style, {
      transform: `translate(${x + 1}px, ${y + lineHeight / 2 - size / 2}px)`,
      background: dark
        ? `radial-gradient(closest-side, #fff4cf, ${box.gold} 35%, color-mix(in srgb, ${box.vermilion} 55%, transparent) 70%, transparent)`
        : `radial-gradient(closest-side, ${box.vermilion}, color-mix(in srgb, ${box.vermilion} 45%, transparent) 55%, transparent)`,
    });
    const peak = (dark ? 0.6 : 0.45) + 0.35 * warmth;
    return (cooled) => {
      mark.style.opacity = String(peak * (1 - cooled));
    };
  };
}

/** A small vermilion ink dot at the foot of the caret, just under the baseline, re-inked by each key. */
function inkDot(box: TypingBox): Part {
  const { lineHeight } = box;
  const size = 4;
  box.raise();
  const dot = box.mark({
    left: "0",
    top: "0",
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "50%",
    opacity: "0",
  });
  return () => {
    const { x, y } = box.caret();
    Object.assign(dot.style, {
      transform: `translate(${x - size / 2}px, ${y + lineHeight * 0.84}px)`,
      background: box.vermilion,
    });
    return (cooled) => {
      dot.style.opacity = String(1 - cooled);
    };
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
