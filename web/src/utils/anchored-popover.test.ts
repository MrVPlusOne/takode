// @vitest-environment jsdom
import { anchoredPopoverStyle } from "./anchored-popover.js";

function trigger(left: number, width: number, bottom: number): HTMLElement {
  return { getBoundingClientRect: () => ({ left, width, bottom }) } as HTMLElement;
}

describe("anchoredPopoverStyle", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
  });

  it("opens left-aligned under a sessions-panel trigger and right-aligned under a top-bar trigger", () => {
    // The same menus open from the sessions panel (left) and the full-page header (right).
    expect(anchoredPopoverStyle(trigger(20, 60, 140), 400)).toEqual({ top: 146, left: 20 });
    expect(anchoredPopoverStyle(trigger(1100, 60, 40), 400)).toEqual({ top: 46, right: 12 });
  });

  it("keeps the popover on screen and falls back when the trigger is gone", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 430 });
    // A phone trigger at x=16 with a full-width popover is pulled back to the 12px margin.
    expect(anchoredPopoverStyle(trigger(16, 60, 790), 672)).toEqual({ top: 620, left: 12 });
    expect(anchoredPopoverStyle(null, 672, { fallbackTop: 44 })).toEqual({ top: 44, right: 12 });
  });
});
