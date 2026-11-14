// @vitest-environment jsdom
/**
 * Typing feel: the text box is never touched (its text, colour and weight stay its own, and its
 * caret stays the native one), the work for each key waits until after the frame that shows the
 * key, settling happens in discrete steps rather than animations (an animation would keep the page
 * drawing frames, delaying keys), every input counts, IME composition (Chinese) included, and
 * one installer gives every chat input the feel and marks it while composing. jsdom has no layout,
 * and time is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachTypingFeel,
  DAY_THROW_ATTRIBUTE,
  DAY_THROWS,
  installTypingFeel,
  type TypingFeelHandle,
} from "./typing-feel.js";

let handle: TypingFeelHandle = { stop() {} };
const animate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  animate.mockReset();
  animate.mockImplementation(
    () => ({ onfinish: null, oncancel: null, cancel() {}, pause() {}, play() {} }) as unknown as Animation,
  );
  Element.prototype.animate = animate as unknown as Element["animate"];
  window.matchMedia = ((query: string) => ({ matches: false, media: query })) as unknown as typeof window.matchMedia;
  document.body.innerHTML =
    '<div id="frame" data-typing-frame><div id="host" style="position:relative"><textarea></textarea></div></div>';
});

afterEach(() => {
  handle.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function box(): HTMLTextAreaElement {
  return document.querySelector("textarea")!;
}

/** An input as typing sends it; `composing` for text an IME (pinyin) is still composing. */
function input(area: HTMLTextAreaElement, text: string, composing = false) {
  area.value += text;
  area.selectionStart = area.selectionEnd = area.value.length;
  area.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: composing ? "insertCompositionText" : "insertText",
      data: text,
      isComposing: composing,
    }),
  );
}

/** Lets the frame showing the input paint, and the feel run after it. */
function paint() {
  vi.advanceTimersByTime(40);
}

/** Lets the feel settle after the last key. */
function pause() {
  vi.advanceTimersByTime(1300);
}

const marks = () => document.querySelectorAll("#host > div[aria-hidden], #frame > div[aria-hidden]");

describe("typing feel", () => {
  it("warms the native caret only after the typed text has been painted, then settles back", () => {
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "a");
    // Nothing changes while the key is handled, so the text paints as fast as without a feel.
    expect(area.style.caretColor).toBe("");
    paint();
    expect(area.style.caretColor).not.toBe("");
    pause();
    expect(area.style.caretColor).toBe("");
  });

  it("settles in steps, never with an animation that would keep the page drawing frames", () => {
    // (Each key's thrown burst is the one motion; see below.)
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    const afterKey = animate.mock.calls.length;
    pause();
    // Nothing animates while it cools.
    expect(animate.mock.calls.length).toBe(afterKey);
    handle.stop();
  });

  it("throws one small burst right of the caret for every typed key, and keeps the air uncrowded", () => {
    // Counts flights in the air: each starts in the air until cancelled (none finish in jsdom).
    let inAir = 0;
    animate.mockImplementation(() => {
      inAir += 1;
      return {
        onfinish: null,
        cancel() {
          inAir -= 1;
        },
      } as unknown as Animation;
    });
    const area = box();
    handle = attachTypingFeel(area);
    // Each key, typed slowly, throws its own burst; a deletion throws nothing.
    for (let i = 0; i < 3; i++) {
      const before = animate.mock.calls.length;
      input(area, "a");
      paint();
      expect(animate.mock.calls.length - before).toBeGreaterThanOrEqual(1);
      expect(animate.mock.calls.length - before).toBeLessThanOrEqual(3);
      vi.advanceTimersByTime(1500);
    }
    const thrown = animate.mock.calls.length;
    area.value = area.value.slice(0, -1);
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    paint();
    expect(animate.mock.calls.length).toBe(thrown);
    for (const call of animate.mock.calls) {
      // Every thrown thing ends up right of where it started, away from the next character.
      const keyframes = call[0] as Keyframe[];
      const x = (frame: Keyframe) => Number(/translate\(([-\d.]+)px/.exec(String(frame.transform))![1]);
      expect(x(keyframes.at(-1)!)).toBeGreaterThan(x(keyframes[0]!));
    }
    // Fast typing fills the air. Past twelve the oldest is retired (cancelled), so every key still
    // throws and no more than twelve are ever in the air.
    for (let i = 0; i < 20; i++) {
      const before = animate.mock.calls.length;
      input(area, "a");
      paint();
      expect(animate.mock.calls.length - before).toBeGreaterThanOrEqual(1);
      expect(inAir).toBeLessThanOrEqual(12);
    }
  });

  it("throws the day choice a chat input names, blown out along the line far enough that fast typing never catches it", () => {
    for (const { id } of DAY_THROWS) {
      animate.mockClear();
      const area = box();
      area.setAttribute(DAY_THROW_ATTRIBUTE, id);
      area.value = "";
      // jsdom has no "normal" line height to measure, so give the box a real one.
      Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
      handle = attachTypingFeel(area);
      input(area, "a");
      paint();
      expect(animate.mock.calls.length).toBeGreaterThanOrEqual(1);
      for (const [keyframes, options] of animate.mock.calls as Array<[Keyframe[], KeyframeAnimationOptions]>) {
        const at = (frame: Keyframe) =>
          /translate\(([-\d.]+)px, ([-\d.]+)px/.exec(String(frame.transform))!.slice(1).map(Number);
        const [startX, startY] = at(keyframes[0]!);
        const [endX, endY] = at(keyframes.at(-1)!);
        // Far out to the right, and still near its line: below it are the composer's buttons.
        expect(endX! - startX!).toBeGreaterThanOrEqual(70);
        expect(Math.abs(endY! - startY!)).toBeLessThanOrEqual(20);
        // Blown out fast, then drifting, rather than at an even pace.
        expect(options.easing).toMatch(/^cubic-bezier/);
      }
      handle.stop();
    }
  });

  it("fades thrown things out before they leave the text box", () => {
    const area = box();
    Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
    // A narrow box (jsdom has no layout, so give it a size): the day's things fly past its right edge.
    Object.defineProperty(area, "offsetWidth", { configurable: true, value: 30 });
    Object.defineProperty(area, "offsetHeight", { configurable: true, value: 40 });
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    expect(animate.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const [keyframes] of animate.mock.calls as Array<[Keyframe[]]>) {
      for (const frame of keyframes) {
        const x = Number(/translate\(([-\d.]+)px/.exec(String(frame.transform))![1]);
        // Past the right edge (30 px), nothing shows.
        if (x > 30) expect(frame.opacity).toBe(0);
      }
    }
  });

  it("counts Chinese typed through an IME, while composing and on commit", () => {
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "ni", true);
    paint();
    expect(area.style.caretColor).not.toBe("");
    pause();
    input(area, "你好");
    paint();
    expect(area.style.caretColor).not.toBe("");
  });

  it("does the work once a frame however many keys land in it", () => {
    const area = box();
    handle = attachTypingFeel(area);
    const frames = vi.spyOn(window, "requestAnimationFrame");
    input(area, "a");
    input(area, "b");
    input(area, "c");
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it("never touches the text: its colour and weight stay the box's own and its caret stays visible", () => {
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "字");
    paint();
    expect(area.style.color).toBe("");
    expect(area.style.fontWeight).toBe("");
    expect(area.style.caretColor).not.toBe("transparent");
    handle.stop();
    expect(area.style.caretColor).toBe("");
  });

  it("lights the caret and the composer's edge, and cleans up", () => {
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    const light = document.querySelector<HTMLElement>("#host > div[aria-hidden]")!;
    expect(Number(light.style.opacity)).toBeGreaterThan(0);
    expect(Number(document.querySelector<HTMLElement>("#frame > div[aria-hidden]")!.style.opacity)).toBeGreaterThan(0);
    handle.stop();
    expect(marks()).toHaveLength(0);
  });

  it("does nothing with reduced motion", () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as unknown as typeof window.matchMedia;
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    expect(area.style.caretColor).toBe("");
    expect(marks()).toHaveLength(0);
  });
  it("sends nothing out while typing mid-paragraph, where it would cross the text after the caret", () => {
    const area = box();
    handle = attachTypingFeel(area);
    area.value = " and the rest of the line";
    for (let i = 0; i < 20; i++) {
      // Type at the start, so the text stays after the caret.
      area.value = `a${area.value}`;
      area.selectionStart = area.selectionEnd = i + 1;
      area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "a" }));
      paint();
      vi.advanceTimersByTime(20);
    }
    expect(animate).not.toHaveBeenCalled();
  });

  it("throws forge sparks right of the caret at night", () => {
    document.documentElement.classList.add("dark");
    const area = box();
    handle = attachTypingFeel(area);
    for (let i = 0; i < 20; i++) {
      input(area, "a");
      paint();
      vi.advanceTimersByTime(20);
    }
    const flights = animate.mock.calls.map((call) => call as [Keyframe[], KeyframeAnimationOptions]);
    // Bursts of two to four sparks.
    expect(flights.length).toBeGreaterThanOrEqual(2);
    for (const [keyframes] of flights) {
      const x = (frame: Keyframe) => Number(/translate\(([-\d.]+)px/.exec(String(frame.transform))![1]);
      expect(x(keyframes.at(-1)!)).toBeGreaterThan(x(keyframes[0]!));
    }
    document.documentElement.classList.remove("dark");
  });

  it("gives chat inputs the feel while they have focus and a scenic background is on", () => {
    let scenic = true;
    const uninstall = installTypingFeel(() => scenic);
    const area = box();
    area.setAttribute("data-chat-input", "");
    area.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input(area, "a");
    paint();
    expect(area.style.caretColor).not.toBe("");
    // Leaving the box stops it and puts the box back.
    area.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(area.style.caretColor).toBe("");
    // With no scenic background, focus brings no feel.
    scenic = false;
    area.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input(area, "b");
    paint();
    expect(area.style.caretColor).toBe("");
    uninstall();
  });

  it("leaves other text boxes alone", () => {
    const uninstall = installTypingFeel(() => true);
    const area = box();
    area.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    input(area, "a");
    paint();
    expect(area.style.caretColor).toBe("");
    uninstall();
  });

  it("marks a chat input while an input method is composing, whatever the background", () => {
    const uninstall = installTypingFeel(() => false);
    const area = box();
    area.setAttribute("data-chat-input", "");
    area.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(area.hasAttribute("data-composing")).toBe(true);
    area.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    expect(area.hasAttribute("data-composing")).toBe(false);
    uninstall();
  });
});
