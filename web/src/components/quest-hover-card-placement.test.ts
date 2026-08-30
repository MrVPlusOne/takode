import { describe, expect, it } from "vitest";
import { rectFromEdges } from "./quest-feed-preview-geometry.js";
import { chooseLegacyQuestHoverPlacement } from "./quest-hover-card-placement.js";

const viewport = rectFromEdges(0, 0, 800, 500);

/** The shared helper intentionally preserves the legacy hover sequence rather than protected feed placement. */
describe("chooseLegacyQuestHoverPlacement", () => {
  it("starts directly below and left-aligned with the hovered trigger", () => {
    expect(
      chooseLegacyQuestHoverPlacement({
        anchorRect: rectFromEdges(120, 80, 146, 106),
        layerSize: { width: 320, height: 180 },
        viewport,
      }),
    ).toEqual({ left: 120, top: 112, direction: "block-end" });
  });

  it("clamps to the right viewport edge without adding trigger exclusions", () => {
    expect(
      chooseLegacyQuestHoverPlacement({
        anchorRect: rectFromEdges(710, 80, 736, 106),
        layerSize: { width: 560, height: 180 },
        viewport,
      }),
    ).toEqual({ left: 232, top: 112, direction: "block-end" });
  });

  it("preserves the legacy unscaled right clamp when the measured layer is zoom-scaled", () => {
    expect(
      chooseLegacyQuestHoverPlacement({
        anchorRect: rectFromEdges(1000, 80, 1026, 106),
        layerSize: { width: 1120, height: 360 },
        placementWidth: 560,
        viewport: rectFromEdges(0, 0, 1200, 800),
      }),
    ).toEqual({ left: 632, top: 112, direction: "block-end" });
  });

  it("flips above and top-clamps even when the resulting card covers the trigger", () => {
    const anchorRect = rectFromEdges(710, 235, 736, 261);
    const placement = chooseLegacyQuestHoverPlacement({
      anchorRect,
      layerSize: { width: 560, height: 400 },
      viewport,
    });

    expect(placement).toEqual({ left: 232, top: 8, direction: "block-start" });
    expect(placement.left).toBeLessThan(anchorRect.right);
    expect(placement.left + 560).toBeGreaterThan(anchorRect.left);
    expect(placement.top).toBeLessThan(anchorRect.bottom);
    expect(placement.top + 400).toBeGreaterThan(anchorRect.top);
  });
});
