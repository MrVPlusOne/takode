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
import { attachTypingFeel, installTypingFeel, type TypingFeelHandle } from "./typing-feel.js";

let handle: TypingFeelHandle = { stop() {} };
const animate = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  animate.mockReset();
  animate.mockImplementation(
    () =>
      ({
        onfinish: null,
        oncancel: null,
        cancel() {},
        pause() {},
        play() {},
        updatePlaybackRate() {},
      }) as unknown as Animation,
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
        updatePlaybackRate() {},
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

  it("drifts gold leaf out by day like a falling leaf, where fast typing doesn't reach it", () => {
    const at = (frame: Keyframe) =>
      /translate\(([-\d.]+)px, ([-\d.]+)px/.exec(String(frame.transform))!.slice(1).map(Number) as [number, number];
    const area = box();
    // jsdom has no layout: give the box a line height, and its card room below the line.
    Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
    Object.defineProperty(document.getElementById("frame")!, "offsetHeight", { configurable: true, value: 64 });
    Object.defineProperty(document.getElementById("frame")!, "offsetWidth", { configurable: true, value: 400 });
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    expect(animate.mock.calls.length).toBe(1);
    const frames = animate.mock.calls[0]![0] as Keyframe[];
    const [startX, startY] = at(frames[0]!);
    const [endX, endY] = at(frames.at(-1)!);
    // Carried out sideways fast, sinking from the start but mostly as it slows, and never past the
    // bottom of its card (64 px tall, less a margin).
    const [quarterX, quarterY] = at(frames[Math.round((frames.length - 1) / 4)]!);
    expect(endX).toBeGreaterThan(startX + 20);
    expect(quarterX - startX).toBeGreaterThan((endX - startX) / 2);
    expect(quarterY).toBeGreaterThan(startY);
    expect(quarterY - startY).toBeLessThan((endY - startY) / 2);
    expect(endY).toBeGreaterThan(startY + 5);
    expect(endY).toBeLessThan(60);
  });

  it("keeps only the newest few leaves drifting calmly and hurries the older ones to settle", () => {
    const area = box();
    Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
    const hurried: number[] = [];
    animate.mockImplementation(() => {
      const index = animate.mock.calls.length - 1;
      return { onfinish: null, cancel() {}, updatePlaybackRate: () => hurried.push(index) } as unknown as Animation;
    });
    handle = attachTypingFeel(area);
    for (let i = 0; i < 6; i++) {
      input(area, "a");
      paint();
    }
    // Six leaves, one a key: the three oldest are told to hurry, once each; the newest three drift on.
    expect(animate.mock.calls.length).toBe(6);
    expect(hurried).toEqual([0, 1, 2]);
  });

  it("lets leaves fall into the composer card below the box, fading out around its buttons", () => {
    const area = box();
    Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
    const frame = document.getElementById("frame")!;
    const button = document.createElement("button");
    frame.append(button);
    // jsdom has no layout: a one-line box 24 px tall in a card 90 px tall, with a button below the
    // box from 30 to 60 px down, right where leaves fall.
    const size = (element: HTMLElement, width: number, height: number) => {
      Object.defineProperty(element, "offsetWidth", { configurable: true, value: width });
      Object.defineProperty(element, "offsetHeight", { configurable: true, value: height });
    };
    size(area, 300, 24);
    size(frame, 400, 90);
    size(button, 400, 30);
    button.getBoundingClientRect = () =>
      ({ left: 0, top: 30, right: 400, bottom: 60, width: 400, height: 30 }) as DOMRect;
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    const keyframes = animate.mock.calls[0]![0] as Keyframe[];
    const at = (frame: Keyframe) => Number(/translate\([-\d.]+px, ([-\d.]+)px/.exec(String(frame.transform))![1]);
    // It falls below the box (24 px) into the card...
    expect(Math.max(...keyframes.map(at))).toBeGreaterThan(24);
    for (const step of keyframes) {
      // ...but never shows over the button, nor within a few px of it.
      if (at(step) + 5.4 > 26) expect(step.opacity).toBe(0);
    }
  });

  it("gives the gold leaf the day by default", () => {
    const area = box();
    Object.assign(area.style, { fontSize: "14px", lineHeight: "20px" });
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    // One flake a key, drifting (its time is in its keyframes, so it runs at an even pace).
    expect(animate.mock.calls.length).toBe(1);
    expect((animate.mock.calls[0]![1] as KeyframeAnimationOptions).easing).toBe("linear");
    expect((animate.mock.calls[0]![0] as Keyframe[]).length).toBeGreaterThan(6);
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
  it("keeps throwing after dictation, while typing before the [transcribed] tag on the last line", () => {
    // Dictation leaves its tag on its own last line. Typing on after it, the caret sits before the
    // tag; that used to count as mid-paragraph, so nothing was thrown until the draft changed.
    const area = box();
    handle = attachTypingFeel(area);
    const tag = "\n[transcribed]";
    let body = "Dictated words";
    for (let i = 0; i < 3; i++) {
      body += "a";
      area.value = body + tag;
      area.selectionStart = area.selectionEnd = body.length;
      area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "a" }));
      paint();
      vi.advanceTimersByTime(1500);
    }
    expect(animate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  // The caret's place is measured in a hidden copy of the box (the mirror). Where the copy wraps
  // its text differently from the box, the caret's light and the throws appear a few characters
  // away from the real caret, and two carets show (seen in a scrolled comment box). jsdom has no
  // layout, so these check that the copy is set up to wrap exactly as the box does.
  const mirror = () =>
    [...document.body.children].find((element) => element.matches("div[aria-hidden]")) as HTMLElement;

  it("measures the caret with the text after it, so a word the caret is inside wraps as a whole", () => {
    // With only the text up to the caret, a long word cut at the caret could fit at the end of a
    // line in the copy while the box moves the whole word to the next line.
    const area = box();
    handle = attachTypingFeel(area);
    area.value = "again, with a supercalifragilistic word";
    area.selectionStart = area.selectionEnd = "again, with a supercalifr".length;
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "r" }));
    paint();
    expect(mirror().textContent).toBe(area.value);
    // The caret is an empty span, which adds no break opportunity inside the word.
    const caret = mirror().querySelector("span")!;
    expect(caret.textContent).toBe("");
    expect(caret.previousSibling?.textContent).toBe("again, with a supercalifr");
  });

  it("leaves the box's scroll bar out of the width its copy wraps text in", () => {
    // A scrolled box has a scroll bar (Takode styles them, so they take room on a Mac too) that
    // narrows its text; the copy has none and wrapped wider lines, a character or a word more each.
    const area = box();
    area.style.cssText = "box-sizing: border-box; padding: 8px 12px; border: 1px solid";
    Object.defineProperty(area, "offsetWidth", { configurable: true, get: () => 300 });
    // 300 wide, less two 1 px borders and a 6 px scroll bar.
    Object.defineProperty(area, "clientWidth", { configurable: true, get: () => 292 });
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    expect(mirror().style.paddingRight).toBe("18px");
  });

  it("throws at the end of an earlier line, with text on the lines below", () => {
    // Only the caret's own line decides: adding to the end of a line above other text still throws
    // (the things fade out before the next line's text instead).
    const area = box();
    handle = attachTypingFeel(area);
    area.value = "First line\nSecond line";
    area.selectionStart = area.selectionEnd = "First line".length;
    area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: "e" }));
    paint();
    expect(animate).toHaveBeenCalled();
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

  it("lets a few night sparks shrink into small red embers that float on farther", () => {
    document.documentElement.classList.add("dark");
    // Picks the last free mark of the pool each time, which is one that floats on as an ember.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const area = box();
    handle = attachTypingFeel(area);
    input(area, "a");
    paint();
    const [keyframes, options] = animate.mock.calls[0] as [Keyframe[], KeyframeAnimationOptions];
    // It lives far longer than a spark's third of a second, and cools to red.
    expect(Number(options.duration)).toBeGreaterThan(600);
    expect(String(keyframes.at(-1)!.filter)).toContain("hue-rotate");
    document.documentElement.classList.remove("dark");
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
