// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDE_DELAY_MS, INTENT_WINDOW_MS, installScrollbarVisibility } from "./scrollbar-visibility.js";

// Validates the app-wide fading scroll bars: which scrolls show a bar, that it fades after the
// last scroll, that only one bar shows at a time (nested scrollers), and that hovering a bar holds
// it. jsdom has no layout or Web Animations, so scroller sizes and `animate` are stubbed.
let uninstall: () => void;
let now = 0;
let fades: FakeAnimation[] = [];

interface FakeAnimation {
  element: Element;
  keyframes: Keyframe;
  cancelled: boolean;
  cancel: () => void;
  onfinish: (() => void) | null;
}

/** A 100x100 scroller with a 6px vertical scroll bar over taller content. */
function scroller(id: string, parent: Element = document.body): HTMLElement {
  const element = document.createElement("div");
  element.id = id;
  parent.appendChild(element);
  for (const [key, value] of Object.entries({
    clientWidth: 94,
    clientHeight: 100,
    scrollWidth: 94,
    scrollHeight: 500,
  })) {
    Object.defineProperty(element, key, { value, configurable: true });
  }
  element.animate = ((keyframes: Keyframe) => {
    const animation: FakeAnimation = {
      element,
      keyframes,
      cancelled: false,
      onfinish: null,
      cancel: () => {
        animation.cancelled = true;
      },
    };
    fades.push(animation);
    return animation as unknown as Animation;
  }) as HTMLElement["animate"];
  return element;
}

function userScroll(element: Element) {
  element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 40 }));
  element.dispatchEvent(new Event("scroll"));
}

function mouseMove(target: Element, offsetX: number) {
  const event = new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" });
  Object.defineProperty(event, "offsetX", { value: offsetX });
  Object.defineProperty(event, "offsetY", { value: 10 });
  target.dispatchEvent(event);
}

const isShown = (element: Element) => element.hasAttribute("data-scrollbar-shown");

beforeEach(() => {
  vi.useFakeTimers();
  now = 1000;
  fades = [];
  vi.spyOn(performance, "now").mockImplementation(() => now);
  uninstall = installScrollbarVisibility();
});
afterEach(() => {
  uninstall();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("installScrollbarVisibility", () => {
  it("shows a bar while the user scrolls, then fades it out after the last scroll", () => {
    const feed = scroller("feed");
    userScroll(feed);
    expect(isShown(feed)).toBe(true);

    // A further scroll before the delay keeps it up.
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    userScroll(feed);
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    expect(fades).toHaveLength(0);

    vi.advanceTimersByTime(100);
    expect(fades).toHaveLength(1);
    expect(fades[0]!.keyframes).toEqual({ "--cc-scrollbar-thumb": "transparent" });
    // Still marked during the fade, so the fade starts from the shown colour.
    expect(isShown(feed)).toBe(true);
    fades[0]!.onfinish?.();
    expect(isShown(feed)).toBe(false);
  });

  it("ignores scrolling the user didn't cause, such as a feed following new messages", () => {
    const feed = scroller("feed");
    now += INTENT_WINDOW_MS + 1;
    feed.dispatchEvent(new Event("scroll"));
    expect(isShown(feed)).toBe(false);
  });

  it("counts scrolling keys as the user's scroll, but not typing in the composer", () => {
    const feed = scroller("feed");
    const composer = document.createElement("textarea");
    document.body.appendChild(composer);
    // Typing (a space included) while the feed follows the growing composer shows nothing.
    composer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " " }));
    composer.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
    feed.dispatchEvent(new Event("scroll"));
    expect(isShown(feed)).toBe(false);

    feed.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }));
    feed.dispatchEvent(new Event("scroll"));
    expect(isShown(feed)).toBe(true);
  });

  it("keeps a shown bar up while its scroll continues on its own, as after a fling", () => {
    const feed = scroller("feed");
    userScroll(feed);
    now += INTENT_WINDOW_MS + 1;
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    feed.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(HIDE_DELAY_MS - 100);
    expect(fades).toHaveLength(0);
    expect(isShown(feed)).toBe(true);
  });

  it("scrolling again during the fade cancels it", () => {
    const feed = scroller("feed");
    userScroll(feed);
    vi.advanceTimersByTime(HIDE_DELAY_MS);
    userScroll(feed);
    expect(fades[0]!.cancelled).toBe(true);
    // A late finish of the cancelled fade must not hide the bar again.
    fades[0]!.onfinish?.();
    expect(isShown(feed)).toBe(true);
  });

  it("shows one bar at a time, so a pane in a scrolling column never shows two side by side", () => {
    // The side column's Home pane scrolls inside the column, both bars at the right edge.
    const column = scroller("column");
    const pane = scroller("pane", column);
    userScroll(pane);
    expect(isShown(pane)).toBe(true);
    // At the pane's end the wheel moves the column: the pane's bar goes at once, without a fade.
    column.dispatchEvent(new Event("scroll"));
    expect(isShown(column)).toBe(true);
    expect(isShown(pane)).toBe(false);
  });

  it("holds a bar while the mouse is over it and fades it once the mouse leaves", () => {
    const feed = scroller("feed");
    // offsetX 96 is inside the 6px bar right of the 94px content box; 50 is over the content.
    mouseMove(feed, 96);
    expect(isShown(feed)).toBe(true);
    vi.advanceTimersByTime(HIDE_DELAY_MS * 3);
    expect(fades).toHaveLength(0);

    mouseMove(feed, 50);
    vi.advanceTimersByTime(HIDE_DELAY_MS);
    expect(fades).toHaveLength(1);
  });

  it("does not hold a bar for an element that doesn't scroll", () => {
    const box = scroller("box");
    Object.defineProperty(box, "scrollHeight", { value: 100 });
    mouseMove(box, 96);
    expect(isShown(box)).toBe(false);
  });
});
