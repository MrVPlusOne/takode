// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  canShowSecondaryViewBeside,
  getEffectiveViewportWidth,
  secondaryViewWidth,
  isDesktopShellLayout,
  isDesktopTaskPanelLayout,
  isNarrowComposerLayout,
} from "./layout.js";

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

  // The right-hand secondary area takes about 45% of the space, within readable bounds, and sits
  // beside the conversation only while the conversation keeps a readable width.
  it("sizes the secondary view area and decides when it fits beside the conversation", () => {
    // Half of a 27-inch screen with the sidebar open: 1280 - 260.
    expect(secondaryViewWidth(1020)).toBe(459);
    expect(canShowSecondaryViewBeside(1020, 459)).toBe(true);
    // Very wide windows cap the area so the conversation gets the extra room.
    expect(secondaryViewWidth(2300)).toBe(760);
    // Narrow desktop windows keep the minimum width and float it over the conversation.
    expect(secondaryViewWidth(800)).toBe(420);
    expect(canShowSecondaryViewBeside(800, 420)).toBe(false);
    // It never covers the whole conversation: a strip stays visible to click outside, and when
    // even the minimum width leaves no strip, the secondary view covers the conversation instead.
    expect(secondaryViewWidth(468)).toBe(420);
    expect(secondaryViewWidth(467)).toBeNull();
  });
});
