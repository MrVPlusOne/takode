// @vitest-environment jsdom
/**
 * The quest strip's close animation: a copy of the strip is laid over it and animated away
 * while the next tab's strip renders underneath, so closing never waits for it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { playStripClose } from "./quest-strip-close-animation.js";

function setup({ reducedMotion = false } = {}) {
  vi.useFakeTimers();
  const animate = vi.fn(() => ({}) as Animation);
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  // jsdom lays nothing out, so the strip gets the size and place a browser would give it.
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(430);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(52);
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockReturnValue(80);
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({ matches: reducedMotion && query === "(prefers-reduced-motion: reduce)", media: query }) as MediaQueryList,
  );
  const host = document.createElement("div");
  const strip = document.createElement("div");
  strip.dataset.testid = "quest-thread-banner";
  strip.textContent = "q-12 Finished quest";
  host.appendChild(strip);
  document.body.appendChild(host);
  return { animate, host, strip };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  document.body.innerHTML = "";
});

describe("playStripClose", () => {
  it("animates a hidden copy over the strip and removes it afterwards", () => {
    const { animate, host, strip } = setup();
    playStripClose(strip, host);

    const copy = host.querySelector<HTMLElement>("[data-strip-close-ghost]")!;
    // The copy covers the strip exactly, is hidden from assistive tech, and is not mistaken
    // for the real strip by tests or queries.
    expect(copy.textContent).toBe("q-12 Finished quest");
    expect(copy.getAttribute("aria-hidden")).toBe("true");
    expect(copy.dataset.testid).toBeUndefined();
    // It never blocks the next strip's close button, so tabs can be closed in a row.
    expect(copy.style).toMatchObject({ position: "absolute", top: "80px", width: "430px", pointerEvents: "none" });
    expect(copy.hasAttribute("inert")).toBe(true);
    // It slides left, uncovering the next strip's close button at the right end first.
    expect(animate).toHaveBeenCalledWith(
      [{ transform: "translateX(0)" }, { transform: "translateX(-100%)" }],
      expect.objectContaining({ duration: 280 }),
    );

    // A timer removes it even if the page never delivers the animation's finish event.
    vi.advanceTimersByTime(1000);
    expect(host.querySelector("[data-strip-close-ghost]")).toBeNull();
  });

  it("does nothing with reduced motion", () => {
    const { animate, host, strip } = setup({ reducedMotion: true });
    playStripClose(strip, host);
    expect(host.querySelector("[data-strip-close-ghost]")).toBeNull();
    expect(animate).not.toHaveBeenCalled();
  });
});
