// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  getEffectiveViewportWidth,
  secondaryViewWidth,
  isDesktopShellLayout,
  isDesktopTaskPanelLayout,
  isNarrowComposerLayout,
} from "./layout.js";
import { SECONDARY_VIEW_MAX_WIDTHS } from "./secondary-view.js";

describe("layout utilities", () => {
  it("uses zoom-adjusted viewport width for responsive layout decisions", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 720 });

    expect(getEffectiveViewportWidth(0.8)).toBe(900);
    expect(isDesktopShellLayout(0.8)).toBe(true);
    expect(isDesktopTaskPanelLayout(0.8)).toBe(false);
    expect(isNarrowComposerLayout(0.8)).toBe(false);
  });

  it("treats the same viewport as compact when the zoom level is 1", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 720 });

    expect(isDesktopShellLayout(1)).toBe(false);
    expect(isNarrowComposerLayout(1)).toBe(false);
  });

  // The secondary view floats over the whole app, sidebar included: narrow windows give it all but
  // a strip left to click outside, and wide windows stop it at its content's maximum.
  it("sizes the secondary view from the whole app width up to its content's maximum", () => {
    expect(secondaryViewWidth(800, 1080)).toBe(752);
    expect(secondaryViewWidth(1280, 1080)).toBe(1080);
    expect(secondaryViewWidth(2560, 880)).toBe(880);
    // A full-width viewer (the guided review walkthrough) covers all but the dismiss strip.
    expect(secondaryViewWidth(1440, SECONDARY_VIEW_MAX_WIDTHS.full)).toBe(1392);
  });
});
