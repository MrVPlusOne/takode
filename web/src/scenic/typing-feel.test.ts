// @vitest-environment jsdom
/**
 * Typing feel: how edits are read from the text box (an insertion is placed by the caret, even in a
 * run of the same letter), how decorated spans follow the text, and what each style draws while
 * typing. jsdom has no Web Animations or layout, so `animate` is recorded instead of played.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachTypingFeel,
  type Decoration,
  editBetween,
  shiftDecorations,
  type TypingFeelHandle,
} from "./typing-feel.js";

let animated: Element[] = [];
let handle: TypingFeelHandle = { sync() {}, stop() {} };

beforeEach(() => {
  animated = [];
  Element.prototype.animate = vi.fn(function (this: Element) {
    animated.push(this);
    return { onfinish: null, oncancel: null, currentTime: 0, cancel() {} } as unknown as Animation;
  }) as unknown as Element["animate"];
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  document.body.innerHTML = '<div id="host" style="position:relative"><textarea></textarea></div>';
});

afterEach(() => {
  handle.stop();
  vi.restoreAllMocks();
});

function box(): HTMLTextAreaElement {
  return document.querySelector("textarea")!;
}

/** Types `text` at the caret, as a key press does. */
function type(area: HTMLTextAreaElement, text: string) {
  const at = area.selectionEnd;
  area.value = area.value.slice(0, at) + text + area.value.slice(at);
  area.selectionStart = area.selectionEnd = at + text.length;
  area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
}

function layer(): HTMLElement {
  return document.querySelector<HTMLElement>("#host > div[aria-hidden]")!;
}

describe("reading edits", () => {
  it("places an insertion by the caret, even in a run of the same letter", () => {
    // Typing "a" after the first "a" of "aa": a plain text diff would put it at the end.
    expect(editBetween("aa", "aaa", 2)).toEqual({ at: 1, removed: 0, inserted: 1 });
  });

  it("falls back to the common start and end for other changes", () => {
    expect(editBetween("hello world", "hello there world", 6)).toEqual({ at: 6, removed: 0, inserted: 6 });
    expect(editBetween("hello world", "help world", 0)).toEqual({ at: 3, removed: 2, inserted: 1 });
  });
});

describe("decorated spans", () => {
  const wet: Decoration = { start: 4, end: 7, kind: "wet", at: 0 };

  it("move with the text, grow with typing inside them, and drop when their text is removed", () => {
    expect(shiftDecorations([wet], { at: 0, removed: 0, inserted: 2 })).toEqual([{ ...wet, start: 6, end: 9 }]);
    expect(shiftDecorations([wet], { at: 5, removed: 0, inserted: 1 })).toEqual([{ ...wet, end: 8 }]);
    // Typing right after a span starts a new one rather than growing it.
    expect(shiftDecorations([wet], { at: 7, removed: 0, inserted: 1 })).toEqual([wet]);
    expect(shiftDecorations([wet], { at: 5, removed: 1, inserted: 0 })).toEqual([]);
  });
});

describe("styles", () => {
  it("brush flick draws the text behind a transparent box and lands each typed character", () => {
    const area = box();
    handle = attachTypingFeel(area, "flick");
    expect(area.style.color).toBe("transparent");
    type(area, "Ink");
    type(area, "s");
    const spans = layer().querySelectorAll(":scope > span");
    expect([...spans].map((span) => span.firstChild?.textContent)).toContain("s");
    // The layer holds exactly the box's text.
    expect(layer().textContent?.replace(/\u200b/g, "")).toBe("Inks");
  });

  it("wet ink keeps the word being written heavy, and it dries when the word ends", () => {
    const area = box();
    handle = attachTypingFeel(area, "wet");
    type(area, "ink");
    const wet = () => [...layer().querySelectorAll("span")].find((span) => span.style.textShadow);
    expect(wet()?.textContent).toBe("ink");
    type(area, " ");
    expect(wet()).toBeUndefined();
  });

  it("word flourish sweeps a stroke under a finished word, once per word", () => {
    const area = box();
    handle = attachTypingFeel(area, "flourish");
    type(area, "brush");
    expect(animated).toHaveLength(0);
    type(area, " ");
    expect(animated).toHaveLength(1);
  });

  it("stopping puts the box back as it was", () => {
    const area = box();
    area.style.color = "red";
    handle = attachTypingFeel(area, "wet");
    handle.stop();
    expect(area.style.color).toBe("red");
    expect(area.hasAttribute("data-typing-feel-layer")).toBe(false);
    expect(layer()).toBeNull();
  });

  it("does nothing with reduced motion", () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia;
    const area = box();
    handle = attachTypingFeel(area, "flick");
    type(area, "a");
    expect(area.style.color).toBe("");
    expect(layer()).toBeNull();
  });
});
