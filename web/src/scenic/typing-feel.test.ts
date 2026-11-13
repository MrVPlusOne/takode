// @vitest-environment jsdom
/**
 * Typing feel: the text box is never touched (its text, colour and weight stay its own, and its
 * caret stays the native one), the work for each key waits until after the frame that shows the
 * key, settling happens in discrete steps rather than animations (an animation would keep the page
 * drawing frames, delaying keys), and every input counts, IME composition (Chinese) included.
 * jsdom has no layout, and time is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachTypingFeel, type TypingFeelHandle } from "./typing-feel.js";

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
    handle = attachTypingFeel(area, "petals");
    input(area, "a");
    // Nothing changes while the key is handled, so the text paints as fast as without a feel.
    expect(area.style.caretColor).toBe("");
    paint();
    expect(area.style.caretColor).not.toBe("");
    pause();
    expect(area.style.caretColor).toBe("");
  });

  it("settles in steps, never with an animation that would keep the page drawing frames", () => {
    // (The forge's sparks are the one exception, and only at speed; see below.)
    const area = box();
    for (const feel of ["petals", "rest"] as const) {
      handle = attachTypingFeel(area, feel);
      input(area, "a");
      paint();
      const afterKey = animate.mock.calls.length;
      pause();
      // Nothing animates while it cools.
      expect(animate.mock.calls.length).toBe(afterKey);
      handle.stop();
    }
    expect(animate).not.toHaveBeenCalled();
  });

  it("sends petals or fireflies out right of the caret while typing warm, at most one every 320 ms", () => {
    const area = box();
    for (const feel of ["petals"] as const) {
      animate.mockClear();
      handle = attachTypingFeel(area, feel);
      // Slow typing sends nothing.
      for (let i = 0; i < 3; i++) {
        input(area, "a");
        paint();
        vi.advanceTimersByTime(1500);
      }
      expect(animate).not.toHaveBeenCalled();
      // Typing a key every 60 ms for 1.2 s does, a few at a time.
      for (let i = 0; i < 20; i++) {
        input(area, "a");
        paint();
        vi.advanceTimersByTime(20);
      }
      const flights = animate.mock.calls.map((call) => call as [Keyframe[], KeyframeAnimationOptions]);
      expect(flights.length).toBeGreaterThan(0);
      expect(flights.length).toBeLessThanOrEqual(5);
      for (const [keyframes] of flights) {
        // Every drifter ends up right of where it started, away from the next character.
        const x = (frame: Keyframe) => Number(/translate\(([-\d.]+)px/.exec(String(frame.transform))![1]);
        expect(x(keyframes.at(-1)!)).toBeGreaterThan(x(keyframes[0]!));
      }
      handle.stop();
      pause();
    }
  });

  it("sends nothing while typing for the pause variant, a few when typing pauses, and sends them away on the next key", () => {
    const area = box();
    const cancelled = vi.fn();
    animate.mockImplementation(() => ({ onfinish: null, oncancel: null, cancel: cancelled }) as unknown as Animation);
    handle = attachTypingFeel(area, "rest");
    for (let i = 0; i < 20; i++) {
      input(area, "a");
      paint();
      vi.advanceTimersByTime(20);
    }
    expect(animate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(animate.mock.calls.length).toBeGreaterThanOrEqual(2);
    // They leave one after another rather than in a clump.
    const delays = animate.mock.calls.map((call) => (call[1] as KeyframeAnimationOptions).delay as number);
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(100);
    input(area, "b");
    expect(cancelled).toHaveBeenCalled();
  });

  it("counts Chinese typed through an IME, while composing and on commit", () => {
    const area = box();
    handle = attachTypingFeel(area, "petals");
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
    handle = attachTypingFeel(area, "petals");
    const frames = vi.spyOn(window, "requestAnimationFrame");
    input(area, "a");
    input(area, "b");
    input(area, "c");
    expect(frames).toHaveBeenCalledTimes(1);
  });

  it("never touches the text: its colour and weight stay the box's own and its caret stays visible", () => {
    const area = box();
    for (const feel of ["petals", "rest"] as const) {
      handle = attachTypingFeel(area, feel);
      input(area, "字");
      paint();
      expect(area.style.color).toBe("");
      expect(area.style.fontWeight).toBe("");
      expect(area.style.caretColor).not.toBe("transparent");
      handle.stop();
      expect(area.style.caretColor).toBe("");
    }
  });

  it("lights the caret and the composer's edge, and cleans up", () => {
    const area = box();
    handle = attachTypingFeel(area, "petals");
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
    handle = attachTypingFeel(area, "petals");
    input(area, "a");
    paint();
    expect(area.style.caretColor).toBe("");
    expect(marks()).toHaveLength(0);
  });
});
