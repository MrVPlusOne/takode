// @vitest-environment jsdom

import {
  chooseQuestRichPopoverPlacement,
  chooseQuestTitlePlacement,
  collectNonEmptyClientRects,
  expandPreviewRect,
  getVisualViewportRect,
  previewRectContainsPoint,
  previewRectInsideViewport,
  previewRectsIntersect,
  rectFromEdges,
  type PreviewRect,
} from "./quest-feed-preview-geometry.js";

function rect(left: number, top: number, width: number, height: number): PreviewRect {
  return rectFromEdges(left, top, left + width, top + height);
}

function placedRect(placement: { left: number; top: number }, width: number, height: number): PreviewRect {
  return rect(placement.left, placement.top, width, height);
}

describe("quest feed preview geometry", () => {
  it("keeps every non-empty wrapped source fragment", () => {
    const element = document.createElement("a");
    element.getClientRects = () =>
      [
        DOMRect.fromRect({ x: 20, y: 30, width: 80, height: 18 }),
        DOMRect.fromRect({ x: 20, y: 48, width: 0, height: 18 }),
        DOMRect.fromRect({ x: 20, y: 48, width: 42, height: 18 }),
      ] as unknown as DOMRectList;

    expect(collectNonEmptyClientRects(element)).toEqual([rect(20, 30, 80, 18), rect(20, 48, 42, 18)]);
  });

  it("uses visual viewport offsets instead of assuming a zero-origin layout viewport", () => {
    const original = window.visualViewport;
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: { offsetLeft: 120, offsetTop: 75, width: 640, height: 480 },
    });

    expect(getVisualViewportRect()).toEqual(rect(120, 75, 640, 480));

    Object.defineProperty(window, "visualViewport", { configurable: true, value: original });
  });

  it("selects a legal title placement without crossing wrapped source, trigger, controls, or pointer", () => {
    const sourceRects = [rect(80, 90, 140, 20), rect(80, 110, 82, 20)];
    const triggerRect = rect(168, 104, 68, 28);
    const interactive = rect(242, 96, 76, 32);
    const pointer = { x: 202, y: 118 };
    const viewport = rect(0, 0, 520, 360);
    const layerSize = { width: 180, height: 54 };

    const placement = chooseQuestTitlePlacement({
      sourceRects,
      triggerRect,
      interactiveRects: [interactive],
      pointer,
      viewport,
      layerSize,
    });

    expect(placement).not.toBeNull();
    const layer = placedRect(placement!, layerSize.width, layerSize.height);
    expect(previewRectInsideViewport(layer, viewport, 8)).toBe(true);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 6)))).toBe(false);
    expect(previewRectsIntersect(layer, expandPreviewRect(triggerRect, 4))).toBe(false);
    expect(previewRectsIntersect(layer, expandPreviewRect(interactive, 4))).toBe(false);
    expect(previewRectContainsPoint(layer, pointer)).toBe(false);
  });

  it("slides a compact title past dense feed controls when every eye-aligned candidate is blocked", () => {
    // Reproduces the reported dense leader-feed geometry: routing controls immediately
    // above and below the link blocked all eight original eye-aligned candidates.
    const sourceRects = [rect(598.9, 716.9, 44.9, 16.2)];
    const triggerRect = rect(645.6, 715.2, 23.4, 23.4);
    const interactiveRects = [
      rect(488.7, 655.3, 171.7, 23.4),
      rect(640.3, 689.5, 77.5, 14.9),
      rect(640.3, 749.4, 77.5, 14.8),
      rect(521.1, 776.8, 658.8, 23.9),
    ];
    const viewport = rect(0, 0, 1440, 1000);
    const layerSize = { width: 288, height: 47.6 };
    const pointer = { x: 620, y: 725 };

    const placement = chooseQuestTitlePlacement({
      sourceRects,
      triggerRect,
      interactiveRects,
      pointer,
      viewport,
      layerSize,
    });

    expect(placement).not.toBeNull();
    expect(placement?.direction).toBe("inline-end");
    expect(placement?.left).toBeCloseTo(675, 1);
    expect(placement?.top).toBeCloseTo(637.9, 1);
    const layer = placedRect(placement!, layerSize.width, layerSize.height);
    expect(previewRectInsideViewport(layer, viewport, 8)).toBe(true);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 6)))).toBe(false);
    expect(previewRectsIntersect(layer, expandPreviewRect(triggerRect, 4))).toBe(false);
    expect(interactiveRects.some((control) => previewRectsIntersect(layer, expandPreviewRect(control, 4)))).toBe(false);
    expect(previewRectContainsPoint(layer, pointer)).toBe(false);
  });

  it("scores focus placement against each asymmetric source fragment", () => {
    const sourceRects = [rect(24, 40, 44, 18), rect(220, 118, 120, 18), rect(220, 136, 36, 18)];
    const triggerRect = rect(264, 132, 70, 28);
    const layerSize = { width: 126, height: 48 };

    const placement = chooseQuestTitlePlacement({
      sourceRects,
      triggerRect,
      viewport: rect(0, 0, 520, 300),
      layerSize,
    });

    expect(placement).not.toBeNull();
    const layer = placedRect(placement!, layerSize.width, layerSize.height);
    const nearestSecondLine = Math.hypot(
      layer.left + layer.width / 2 - (sourceRects[1].left + sourceRects[1].width / 2),
      layer.top + layer.height / 2 - (sourceRects[1].top + sourceRects[1].height / 2),
    );
    const firstLine = Math.hypot(
      layer.left + layer.width / 2 - (sourceRects[0].left + sourceRects[0].width / 2),
      layer.top + layer.height / 2 - (sourceRects[0].top + sourceRects[0].height / 2),
    );
    expect(nearestSecondLine).toBeLessThan(firstLine);
  });

  it("returns no-fit instead of clamping an illegal title across the source", () => {
    const placement = chooseQuestTitlePlacement({
      sourceRects: [rect(12, 16, 196, 28)],
      triggerRect: rect(88, 50, 72, 28),
      interactiveRects: [rect(8, 82, 204, 28)],
      viewport: rect(0, 0, 220, 120),
      layerSize: { width: 200, height: 64 },
      pointer: { x: 110, y: 64 },
    });

    expect(placement).toBeNull();
  });

  it("keeps a compact title local instead of escaping a dense cage across the viewport", () => {
    const placement = chooseQuestTitlePlacement({
      sourceRects: [rect(184, 200, 240, 20), rect(184, 220, 150, 20)],
      triggerRect: rect(338, 217, 28, 28),
      interactiveRects: [
        rect(100, 100, 544, 80),
        rect(100, 184, 80, 140),
        rect(370, 184, 274, 140),
        rect(100, 249, 544, 159),
      ],
      viewport: rect(0, 0, 1200, 800),
      layerSize: { width: 320, height: 58 },
      pointer: { x: 260, y: 225 },
    });

    expect(placement).toBeNull();
  });

  it("places a rich popover from the final rendered layer dimensions", () => {
    const sourceRects = [rect(420, 270, 120, 24)];
    const triggerRect = rect(548, 268, 72, 28);
    const viewport = rect(0, 0, 1200, 640);

    expect(
      chooseQuestRichPopoverPlacement({
        sourceRects,
        triggerRect,
        viewport,
        layerSize: { width: 520, height: 300 },
      }),
    ).not.toBeNull();
  });
});
