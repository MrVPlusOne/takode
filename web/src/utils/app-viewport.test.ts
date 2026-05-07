// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAppViewportSizing, resolveAppViewportHeight } from "./app-viewport.js";

class MockVisualViewport extends EventTarget {
  height: number;

  constructor(height: number) {
    super();
    this.height = height;
  }
}

let originalVisualViewport: VisualViewport | null;
let originalInnerHeight: number;

beforeEach(() => {
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
});

describe("resolveAppViewportHeight", () => {
  it("keeps the app shell on dynamic viewport units", () => {
    expect(resolveAppViewportHeight()).toBe("100dvh");
  });
});

describe("installAppViewportSizing", () => {
  it("sizes the root chain without shrinking to visualViewport height", () => {
    const visualViewport = new MockVisualViewport(520);
    Object.defineProperty(window, "visualViewport", { configurable: true, value: visualViewport });

    const cleanup = installAppViewportSizing(window);

    expect(document.documentElement.style.height).toBe("100dvh");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.documentElement.style.width).toBe("100vw");
    expect(document.body.style.height).toBe("100%");
    expect(document.body.style.width).toBe("100%");
    expect(document.body.style.margin).toBe("0px");
    expect(document.getElementById("root")?.style.height).toBe("100%");
    expect(document.getElementById("root")?.style.width).toBe("100%");

    visualViewport.height = 480;
    visualViewport.dispatchEvent(new Event("resize"));
    visualViewport.dispatchEvent(new Event("scroll"));
    expect(document.documentElement.style.height).toBe("100dvh");

    document.dispatchEvent(new FocusEvent("focusin"));
    document.dispatchEvent(new FocusEvent("focusout"));
    window.dispatchEvent(new Event("orientationchange"));
    expect(document.documentElement.style.height).toBe("100dvh");

    cleanup();
  });
});
