// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installAppViewportSizing, resolveAppViewportHeight } from "./app-viewport.js";

class MockVisualViewport extends EventTarget {
  height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }
}

let originalMatchMedia: typeof window.matchMedia | undefined;
let originalVisualViewport: VisualViewport | null;
let originalInnerHeight: number;

beforeEach(() => {
  originalMatchMedia = window.matchMedia;
  originalVisualViewport = window.visualViewport;
  originalInnerHeight = window.innerHeight;
  document.documentElement.removeAttribute("style");
  document.body.removeAttribute("style");
  document.body.innerHTML = '<div id="root"></div>';
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
});

afterEach(() => {
  Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: originalVisualViewport });
  window.matchMedia = originalMatchMedia as typeof window.matchMedia;
  vi.useRealTimers();
});

describe("resolveAppViewportHeight", () => {
  it("keeps desktop shells on dynamic viewport units", () => {
    expect(
      resolveAppViewportHeight({
        isTouchKeyboard: false,
        layoutViewportHeight: 900,
        visualViewportHeight: 520,
      }),
    ).toBe("100dvh");
  });

  it("uses visualViewport height for touch keyboard layouts", () => {
    expect(
      resolveAppViewportHeight({
        isTouchKeyboard: true,
        layoutViewportHeight: 844,
        visualViewportHeight: 612.345,
      }),
    ).toBe("612.35px");
  });

  it("does not let stale visualViewport growth exceed the layout viewport", () => {
    expect(
      resolveAppViewportHeight({
        isTouchKeyboard: true,
        layoutViewportHeight: 844,
        visualViewportHeight: 900,
      }),
    ).toBe("844px");
  });

  it("falls back to dynamic viewport units when visualViewport is unavailable", () => {
    expect(
      resolveAppViewportHeight({
        isTouchKeyboard: true,
        layoutViewportHeight: 844,
        visualViewportHeight: null,
      }),
    ).toBe("100dvh");
  });
});

describe("installAppViewportSizing", () => {
  it("tracks visualViewport resize and scroll events on touch-keyboard devices", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const visualViewport = new MockVisualViewport(620);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });

    const cleanup = installAppViewportSizing(window);

    expect(document.documentElement.style.height).toBe("620px");
    expect(document.body.style.height).toBe("100%");
    expect(document.getElementById("root")?.style.height).toBe("100%");

    visualViewport.height = 700;
    visualViewport.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.height).toBe("700px");

    visualViewport.height = 640;
    visualViewport.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.style.height).toBe("640px");

    cleanup();
  });

  it("runs late focus updates to catch delayed mobile browser chrome changes", () => {
    vi.useFakeTimers();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const visualViewport = new MockVisualViewport(620);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });

    const cleanup = installAppViewportSizing(window);

    visualViewport.height = 610;
    document.dispatchEvent(new FocusEvent("focusin"));
    expect(document.documentElement.style.height).toBe("610px");

    visualViewport.height = 590;
    vi.advanceTimersByTime(80);
    expect(document.documentElement.style.height).toBe("590px");

    visualViewport.height = 580;
    vi.advanceTimersByTime(170);
    expect(document.documentElement.style.height).toBe("580px");

    cleanup();
  });
});
