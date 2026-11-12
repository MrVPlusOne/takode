/**
 * Typing feel: ink-like feedback while typing in a text box, in a few clearly different styles to
 * try side by side. Typed text always appears at once and nothing changes layout: each style draws
 * short-lived marks around the text, or (brush flick and wet ink) draws the text itself in a layer
 * behind the box, which stays in place with its own text made transparent. Everything settles
 * within about a second of the last key, so an idle box draws nothing, and nothing plays with
 * reduced motion.
 */
import { inkBlot } from "./ink-motion.js";
import { scenicMotionAllowed } from "./scenic-styles.js";

export type TypingFeel = "flick" | "wet" | "wash" | "flourish" | "brush";

/** The styles, in the order to offer them, with a short description of each. */
export const TYPING_FEELS: ReadonlyArray<{ id: TypingFeel; label: string; description: string }> = [
  {
    id: "flick",
    label: "Brush flick",
    description: "Each character lands with a small drop and leaves a tiny brush flick at its foot.",
  },
  {
    id: "wet",
    label: "Wet ink",
    description: "The word you're writing is wet, heavier ink, and dries to normal once you finish it or pause.",
  },
  {
    id: "wash",
    label: "Ink wash",
    description: "A soft wash of ink builds behind the line while you type fast and fades when you pause.",
  },
  {
    id: "flourish",
    label: "Word flourish",
    description: "Finishing a word sweeps a tapered brush stroke under it.",
  },
  {
    id: "brush",
    label: "Brush caret",
    description: "The caret is a brush tip that leans as it writes and trails a little ink.",
  },
];

/** A running typing feel. */
export interface TypingFeelHandle {
  /** Call after changing the box's text in code (not by typing), so the feel keeps up. */
  sync(): void;
  /** Stops the feel and puts the box back as it was. */
  stop(): void;
}

/**
 * Gives `area` a typing feel. Its parent element must be positioned: the feel draws there. Returns
 * a handle; with reduced motion it does nothing.
 */
export function attachTypingFeel(area: HTMLTextAreaElement, feel: TypingFeel): TypingFeelHandle {
  if (!scenicMotionAllowed() || !area.parentElement) return { sync() {}, stop() {} };
  const box = new TypingBox(area, area.parentElement);
  if (feel === "flick") return withTextLayer(box, { decorate: flickDecorations });
  if (feel === "wet") return withTextLayer(box, { decorate: wetDecorations, pause: dryAll });
  if (feel === "wash") return washFeel(box);
  if (feel === "flourish") return flourishFeel(box);
  return brushCaretFeel(box);
}

/** A change to the text: `inserted` characters replaced `removed` ones at `at`. */
export interface Edit {
  at: number;
  removed: number;
  inserted: number;
}

/** A span of text drawn specially by the text layer, from `at` (ms) on. */
export interface Decoration {
  start: number;
  end: number;
  kind: "land" | "wet" | "dry";
  at: number;
}

const LAND_MS = 200;
/** How long a landed character keeps its flick. */
const FLICK_MS = 300;
const DRY_MS = 900;
/** Wet ink dries this long after the last key. */
const PAUSE_MS = 1000;
const WORD_CHAR = /[\p{L}\p{N}_'’-]/u;

/** The box being typed in, with what every style needs: its edits, caret positions and marks. */
class TypingBox {
  /** The text's colour: the ink every mark is drawn in. */
  ink: string;
  readonly lineHeight: number;
  private value: string;
  private readonly cleanups: Array<() => void> = [];
  private readonly inkListeners: Array<() => void> = [];

  constructor(
    readonly area: HTMLTextAreaElement,
    readonly host: HTMLElement,
  ) {
    const style = getComputedStyle(area);
    this.ink = style.color;
    // The theme can change while typing (night falls on "colour by day, ink at night"); the ink
    // follows it, read with any colour the feel set on the box put aside.
    const theme = new MutationObserver(() => {
      const set = area.style.color;
      area.style.color = "";
      this.ink = getComputedStyle(area).color;
      area.style.color = set;
      for (const listener of this.inkListeners) listener();
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    this.cleanups.push(() => theme.disconnect());
    this.lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4;
    this.value = area.value;
  }

  /** Runs `onEdit` for each change to the text, typed or (through `sync`) made in code. */
  watch(onEdit: (edit: Edit, typed: boolean) => void): () => void {
    const changed = (typed: boolean) => {
      const edit = editBetween(this.value, this.area.value, this.area.selectionEnd);
      this.value = this.area.value;
      if (edit.removed || edit.inserted) onEdit(edit, typed);
    };
    const onInput = (event: Event) => {
      // An IME is still composing; react to the text it commits.
      if (!(event as InputEvent).isComposing) changed(true);
    };
    this.listen(this.area, "input", onInput);
    return () => changed(false);
  }

  /** Runs `listener` whenever the ink changes with the theme. */
  onInk(listener: () => void): void {
    this.inkListeners.push(listener);
  }

  listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  /** Sets styles on the box until the feel stops. */
  restyle(element: HTMLElement, style: Partial<CSSStyleDeclaration>): void {
    const before = Object.fromEntries(Object.keys(style).map((key) => [key, element.style[key as never]]));
    Object.assign(element.style, style);
    this.cleanups.push(() => Object.assign(element.style, before));
  }

  /** A mark drawn in the host, removed when its animation ends (or when the feel stops). */
  mark(style: Partial<CSSStyleDeclaration>, keyframes?: Keyframe[], options?: KeyframeAnimationOptions): HTMLElement {
    const element = document.createElement("div");
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, { position: "absolute", pointerEvents: "none", zIndex: "0" }, style);
    this.host.append(element);
    if (keyframes) {
      const animation = element.animate(keyframes, options);
      animation.onfinish = animation.oncancel = () => element.remove();
    } else {
      this.cleanups.push(() => element.remove());
    }
    return element;
  }

  /** Puts the box above the marks so they sit behind its text. */
  raise(): void {
    if (getComputedStyle(this.area).position === "static") this.restyle(this.area, { position: "relative" });
    this.restyle(this.area, { zIndex: "1" });
  }

  /**
   * Where the text at `index` is drawn, relative to the host: a hidden copy of the box with the
   * same box and font measures it, the usual way to find a caret.
   */
  pointAt(index: number): { x: number; y: number } {
    const mirror = document.createElement("div");
    copyTextStyle(this.area, mirror);
    Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px" });
    mirror.textContent = this.area.value.slice(0, index);
    const caret = document.createElement("span");
    caret.textContent = "\u200b";
    mirror.append(caret);
    document.body.append(mirror);
    const x = caret.offsetLeft - this.area.scrollLeft;
    // An inline box's offsetTop is the top of its glyphs, not of its line; centre it on the line.
    const y = caret.offsetTop + caret.offsetHeight / 2 - this.lineHeight / 2 - this.area.scrollTop;
    mirror.remove();
    const field = offsetIn(this.area, this.host);
    return { x: field.x + x, y: field.y + y };
  }

  stop(): void {
    for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
  }
}

/** How a text-layer feel decorates the text. */
interface LayerStyle {
  /** The decorations after an edit, given those still showing (already moved with the text). */
  decorate(decorations: Decoration[], edit: Edit, typed: boolean, text: string): Decoration[];
  /** The decorations once the box has been quiet for a moment. */
  pause?(decorations: Decoration[]): Decoration[];
}

/**
 * The feels that draw the text themselves: the box's own text turns transparent (its caret and
 * selection stay) and a layer behind it draws the same text, with `style` choosing the spans drawn
 * specially after each edit.
 */
function withTextLayer(box: TypingBox, style: LayerStyle): TypingFeelHandle {
  const { area, host } = box;
  const layer = document.createElement("div");
  layer.setAttribute("aria-hidden", "true");
  copyTextStyle(area, layer);
  Object.assign(layer.style, { position: "absolute", pointerEvents: "none", overflow: "hidden", color: box.ink });
  host.insertBefore(layer, area);
  box.raise();
  box.restyle(area, { color: "transparent", caretColor: box.ink });
  area.setAttribute("data-typing-feel-layer", "");

  const place = () => {
    const at = offsetIn(area, host);
    Object.assign(layer.style, {
      left: `${at.x}px`,
      top: `${at.y}px`,
      width: `${area.offsetWidth}px`,
      height: `${area.offsetHeight}px`,
    });
    layer.scrollTop = area.scrollTop;
  };
  let decorations: Decoration[] = [];
  const draw = () => {
    const now = performance.now();
    decorations = decorations.filter((d) => d.kind === "wet" || now - d.at < (d.kind === "land" ? FLICK_MS : DRY_MS));
    layer.replaceChildren(...textWithDecorations(area.value, decorations, box.ink, now), "\u200b");
    place();
  };
  // The only thing that runs between keys: one timer for the pause, when a style has one.
  let pause: ReturnType<typeof setTimeout> | undefined;
  const sync = box.watch((edit, typed) => {
    decorations = style.decorate(shiftDecorations(decorations, edit), edit, typed, area.value);
    draw();
    clearTimeout(pause);
    const settle = style.pause;
    if (settle) {
      pause = setTimeout(() => {
        decorations = settle(decorations);
        draw();
      }, PAUSE_MS);
    }
  });
  box.listen(area, "scroll", () => {
    layer.scrollTop = area.scrollTop;
  });
  box.onInk(() => {
    Object.assign(layer.style, { color: box.ink });
    area.style.caretColor = box.ink;
    draw();
  });
  const resize = new ResizeObserver(place);
  resize.observe(area);
  draw();
  return {
    sync,
    stop() {
      clearTimeout(pause);
      resize.disconnect();
      layer.remove();
      area.removeAttribute("data-typing-feel-layer");
      box.stop();
    },
  };
}

/** Brush flick: each typed character lands from a little above and leaves a flick at its foot. */
function flickDecorations(decorations: Decoration[], edit: Edit, typed: boolean): Decoration[] {
  if (!typed || edit.removed || edit.inserted > 2) return decorations;
  return [...decorations, { start: edit.at, end: edit.at + edit.inserted, kind: "land", at: performance.now() }];
}

/** Wet ink: the word being written stays wet (heavier) and dries once the caret leaves it. */
function wetDecorations(decorations: Decoration[], edit: Edit, typed: boolean, text: string): Decoration[] {
  const end = edit.at + edit.inserted;
  if (!typed || edit.removed || !WORD_CHAR.test(text[end - 1] ?? "")) return dryAll(decorations);
  let start = end - 1;
  while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start -= 1;
  const wet = decorations.find((d) => d.kind === "wet" && d.start === start);
  const others = dryAll(decorations.filter((d) => d !== wet));
  return [...others, { start, end, kind: "wet", at: wet?.at ?? performance.now() }];
}

/** Wet words start drying now. */
function dryAll(decorations: Decoration[]): Decoration[] {
  const now = performance.now();
  return decorations.map((d) => (d.kind === "wet" ? { ...d, kind: "dry" as const, at: now } : d));
}

/** The text as nodes, with each decoration as a span drawn and animated by its kind. */
function textWithDecorations(text: string, decorations: Decoration[], ink: string, now: number): Node[] {
  const nodes: Node[] = [];
  let cursor = 0;
  for (const d of [...decorations].sort((a, b) => a.start - b.start)) {
    if (d.start < cursor || d.end > text.length || d.start >= d.end) continue;
    nodes.push(document.createTextNode(text.slice(cursor, d.start)));
    const span = document.createElement("span");
    span.textContent = text.slice(d.start, d.end);
    const heavy = `0.35px 0 0 ${ink}, -0.35px 0 0 ${ink}`;
    if (d.kind === "wet") span.style.textShadow = heavy;
    if (d.kind === "land") {
      span.style.position = "relative";
      seek(span.animate(LAND, { duration: LAND_MS, easing: "ease-out" }), now - d.at);
      flick(span, ink, now - d.at);
    }
    if (d.kind === "dry") {
      seek(span.animate([{ textShadow: heavy }, { textShadow: `0 0 0 ${ink}, 0 0 0 ${ink}` }], DRY_MS), now - d.at);
    }
    nodes.push(span);
    cursor = d.end;
  }
  nodes.push(document.createTextNode(text.slice(cursor)));
  return nodes;
}

const LAND: Keyframe[] = [
  { top: "-0.32em", opacity: 0.3 },
  { top: "0.06em", opacity: 1, offset: 0.65 },
  { top: "0", opacity: 1 },
];

/** A tiny tapered brush flick at the foot of a character that just landed. */
function flick(span: HTMLElement, ink: string, elapsed: number): void {
  const mark = document.createElement("span");
  Object.assign(mark.style, {
    position: "absolute",
    right: "-4px",
    bottom: "0.12em",
    width: "8px",
    height: "1.6px",
    borderRadius: "1px 50% 50% 1px",
    background: `linear-gradient(90deg, ${ink}, transparent)`,
    transformOrigin: "0 50%",
    opacity: "0",
  });
  span.append(mark);
  seek(
    mark.animate(
      [
        { transform: "rotate(-30deg) scaleX(0)", opacity: 0.9, offset: 0.25 },
        { transform: "rotate(-30deg) scaleX(1)", opacity: 0.75, offset: 0.55 },
        { transform: "rotate(-30deg) scaleX(1)", opacity: 0 },
      ],
      { duration: FLICK_MS, fill: "backwards" },
    ),
    elapsed,
  );
}

/** Restarts an animation that was already running before its element was redrawn. */
function seek(animation: Animation, elapsed: number): void {
  animation.currentTime = Math.max(0, elapsed);
}

/** How much of its box the ink blot fills across. */
const BLOT_FILL = 0.64;

/** Ink wash: momentum from fast typing builds a soft wash behind the line, fading when you pause. */
function washFeel(box: TypingBox): TypingFeelHandle {
  box.raise();
  const tint = () => `linear-gradient(90deg, transparent, ${box.ink} 30%, ${box.ink})`;
  const wash = box.mark({
    background: tint(),
    maskImage: inkBlot(),
    maskSize: "100% 100%",
    opacity: "0",
    transition: "width 90ms ease-out, left 90ms ease-out",
  });
  box.onInk(() => {
    wash.style.background = tint();
  });
  let momentum = 0;
  let last = 0;
  let fade: Animation | undefined;
  const sync = box.watch((edit, typed) => {
    if (!typed || !edit.inserted) return;
    const now = performance.now();
    momentum = momentum * Math.exp(-(now - last) / 600) + 1;
    last = now;
    const caret = box.pointAt(edit.at + edit.inserted);
    // The wash covers the line from its start to just past the caret. The blot fills about 64% of
    // its box, so the box is that much larger around the line.
    const start = offsetIn(box.area, box.host).x + Number.parseFloat(getComputedStyle(box.area).paddingLeft) - 8;
    const width = Math.max(24, caret.x - start + 14) / BLOT_FILL;
    const height = (box.lineHeight + 8) / BLOT_FILL;
    const middle = (start + caret.x + 14) / 2;
    const left = middle - width / 2;
    // Its fibres must not reach past the composer's sides.
    const right = left + width - box.host.clientWidth;
    Object.assign(wash.style, {
      left: `${left}px`,
      top: `${caret.y + box.lineHeight / 2 - height / 2}px`,
      width: `${width}px`,
      height: `${height}px`,
      clipPath: `inset(0 ${Math.max(0, right)}px 0 ${Math.max(0, -left)}px)`,
    });
    const from = Number(getComputedStyle(wash).opacity) || 0;
    const peak = Math.min(0.18, 0.035 * momentum);
    fade?.cancel();
    fade = wash.animate(
      [{ opacity: from }, { opacity: peak, offset: 0.06 }, { opacity: peak * 0.8, offset: 0.3 }, { opacity: 0 }],
      { duration: 1300, easing: "ease-out" },
    );
  });
  return { sync, stop: () => box.stop() };
}

/** Word flourish: a finished word gets a tapered brush stroke swept under it. */
function flourishFeel(box: TypingBox): TypingFeelHandle {
  box.raise();
  const sync = box.watch((edit, typed) => {
    if (!typed || edit.removed || edit.inserted !== 1) return;
    const text = box.area.value;
    if (WORD_CHAR.test(text[edit.at]!) || !WORD_CHAR.test(text[edit.at - 1] ?? "")) return;
    let start = edit.at - 1;
    while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start -= 1;
    if (edit.at - start < 2) return;
    const from = box.pointAt(start);
    const to = box.pointAt(edit.at);
    // A word broken over two lines gets no stroke.
    if (Math.abs(from.y - to.y) > 1) return;
    box.mark(
      {
        left: `${from.x}px`,
        top: `${from.y + box.lineHeight * 0.86}px`,
        width: `${to.x - from.x + 4}px`,
        height: "3px",
        borderRadius: "1.5px 50% 50% 1.5px",
        background: `linear-gradient(90deg, ${box.ink}, ${box.ink} 55%, transparent)`,
        transform: "rotate(-0.6deg)",
      },
      [
        { clipPath: "inset(0 100% 0 0)", opacity: 0.5 },
        { clipPath: "inset(0 0 0 0)", opacity: 0.5, offset: 0.3 },
        { clipPath: "inset(0 0 0 0)", opacity: 0 },
      ],
      { duration: 750, easing: "ease-out" },
    );
  });
  return { sync, stop: () => box.stop() };
}

/** Brush caret: the caret is a brush tip that leans as it writes and leaves a short ink trail. */
function brushCaretFeel(box: TypingBox): TypingFeelHandle {
  const { area } = box;
  box.raise();
  box.restyle(area, { caretColor: "transparent" });
  const height = box.lineHeight * 0.8;
  const tint = () => `linear-gradient(${box.ink} 70%, color-mix(in srgb, ${box.ink} 45%, transparent))`;
  const tip = box.mark({
    width: "3px",
    height: `${height}px`,
    borderRadius: "1.5px 1.5px 50% 50% / 1.5px 1.5px 4px 4px",
    background: tint(),
    transformOrigin: "50% 100%",
    zIndex: "2",
    display: "none",
  });
  box.onInk(() => {
    tip.style.background = tint();
  });
  let at = { x: 0, y: 0 };
  const place = () => {
    const shown = document.activeElement === area && area.selectionStart === area.selectionEnd;
    tip.style.display = shown ? "block" : "none";
    if (!shown) return;
    at = box.pointAt(area.selectionEnd);
    Object.assign(tip.style, { left: `${at.x - 1}px`, top: `${at.y + (box.lineHeight - height) / 2}px` });
  };
  const sync = box.watch((edit, typed) => {
    const from = at;
    place();
    if (!typed || !edit.inserted || edit.removed || Math.abs(from.y - at.y) > 1 || at.x <= from.x) return;
    tip.animate([{ transform: "skewX(-16deg) scaleY(1.05)" }, { transform: "none" }], {
      duration: 200,
      easing: "ease-out",
    });
    box.mark(
      {
        left: `${from.x}px`,
        top: `${at.y + box.lineHeight * 0.84}px`,
        width: `${at.x - from.x}px`,
        height: "1.5px",
        borderRadius: "1px",
        background: `linear-gradient(90deg, transparent, ${box.ink})`,
      },
      [{ opacity: 0.45 }, { opacity: 0 }],
      { duration: 320, easing: "ease-out" },
    );
  });
  for (const type of ["focus", "blur", "keyup", "mouseup", "select", "scroll"]) box.listen(area, type, place);
  box.listen(document, "selectionchange", place);
  place();
  return { sync, stop: () => box.stop() };
}

/**
 * The change from `before` to `after`. Typing puts the caret at the end of what it inserted, which
 * places an insertion exactly even in a run of the same letter; anything else falls back to the
 * longest common start and end.
 */
export function editBetween(before: string, after: string, caret: number): Edit {
  const grown = after.length - before.length;
  const at = caret - grown;
  if (grown > 0 && at >= 0 && after.slice(0, at) === before.slice(0, at) && after.slice(caret) === before.slice(at)) {
    return { at, removed: 0, inserted: grown };
  }
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let tail = 0;
  while (
    tail < before.length - start &&
    tail < after.length - start &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { at: start, removed: before.length - start - tail, inserted: after.length - start - tail };
}

/**
 * Decorations after an edit: those before it stay, those after it move with the text, a pure
 * insertion inside one grows it, and any that lost text are dropped.
 */
export function shiftDecorations(decorations: Decoration[], edit: Edit): Decoration[] {
  const delta = edit.inserted - edit.removed;
  const removedEnd = edit.at + edit.removed;
  return decorations.flatMap((d) => {
    if (d.end <= edit.at) return [d];
    if (d.start >= removedEnd && (edit.removed || d.start > edit.at)) {
      return [{ ...d, start: d.start + delta, end: d.end + delta }];
    }
    if (!edit.removed && d.start < edit.at) return [{ ...d, end: d.end + delta }];
    return [];
  });
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
  Object.assign(copy.style, {
    borderColor: "transparent",
    whiteSpace: area.wrap === "off" ? "pre" : "pre-wrap",
    overflowWrap: "break-word",
  });
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
