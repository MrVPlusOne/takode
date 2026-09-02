// @vitest-environment jsdom

import {
  chooseQuestBlockSheetPlacement,
  chooseQuestRichPopoverPlacement,
  chooseQuestSideSheetPlacement,
  chooseQuestTitlePlacement,
  collectNonEmptyClientRects,
  expandPreviewRect,
  getVisualViewportRect,
  previewRectContainsPoint,
  previewRectInsideViewport,
  previewRectsIntersect,
  rectFromEdges,
  shortestCenterDistanceToSource,
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

  it("uses final rendered layer dimensions for rich placement and a right-edge-docked side sheet", () => {
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

    const sheet = chooseQuestSideSheetPlacement({
      sourceRects: [...sourceRects, triggerRect],
      viewport,
      preferredWidth: 560,
      minimumWidth: 280,
      preferredHeight: 300,
    });
    expect(sheet).toMatchObject({ side: "right", top: 8, width: 560, maxHeight: 624 });
    expect(sheet!.left + sheet!.width).toBe(viewport.right);
    expect(sheet!.left).toBeGreaterThanOrEqual(triggerRect.right + 12);
    const layer = placedRect(sheet!, sheet!.width, 300);
    expect(
      [...sourceRects, triggerRect].some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 8))),
    ).toBe(false);
  });

  it("docks a left side sheet to a non-zero visual viewport edge", () => {
    const viewport = rect(100, 50, 900, 620);
    const sourceRects = [rect(700, 260, 120, 24), rect(828, 258, 72, 28)];

    const sheet = chooseQuestSideSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 480,
      minimumWidth: 280,
      preferredHeight: 260,
    });

    expect(sheet).toMatchObject({ side: "left", left: 100, top: 58, width: 480, maxHeight: 604 });
    const layer = placedRect(sheet!, sheet!.width, 260);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 8)))).toBe(false);
  });

  it("uses rendered 150%-zoom dimensions with visual viewport offsets and remains right-edge docked", () => {
    const zoom = 1.5;
    const viewport = rect(120, 75, 960, 720);
    const sourceRects = [rect(300, 300, 120, 30), rect(430, 296, 70, 42)];

    const sheet = chooseQuestSideSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 560 * zoom,
      minimumWidth: 280 * zoom,
      preferredHeight: 300 * zoom,
    });

    expect(sheet).toMatchObject({ side: "right", left: 512, top: 83, width: 568, maxHeight: 704 });
    expect(sheet!.left + sheet!.width).toBe(viewport.right);
    const layer = placedRect(sheet!, sheet!.width, 300 * zoom);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 8)))).toBe(false);
  });

  it("moves a side sheet to the opposite block anchor rather than covering an interactive control", () => {
    const viewport = rect(0, 0, 1000, 700);
    const sourceRects = [rect(260, 320, 160, 28), rect(430, 316, 70, 36)];
    const control = rect(620, 80, 180, 80);

    const sheet = chooseQuestSideSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 420,
      minimumWidth: 280,
      preferredHeight: 300,
      interactiveRects: [control],
    });

    expect(sheet).toMatchObject({ side: "right", left: 580, top: 392, width: 420 });
    const layer = placedRect(sheet!, sheet!.width, 300);
    expect(previewRectsIntersect(layer, expandPreviewRect(control, 4))).toBe(false);
  });

  it("rejects a wider side even when it has more room if visible controls occupy every legal anchor", () => {
    const viewport = rect(0, 0, 1000, 700);
    const sourceRects = [rect(360, 320, 160, 28), rect(530, 316, 70, 36)];
    const rightTopControl = rect(650, 60, 250, 260);
    const rightBottomControl = rect(650, 380, 250, 260);

    const sheet = chooseQuestSideSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 320,
      minimumWidth: 280,
      preferredHeight: 300,
      interactiveRects: [rightTopControl, rightBottomControl],
    });

    expect(sheet).toMatchObject({ side: "left", left: 0, width: 320 });
  });

  it("reports no side-sheet fit when neither side can avoid the source", () => {
    expect(
      chooseQuestSideSheetPlacement({
        sourceRects: [rect(120, 40, 360, 40)],
        viewport: rect(0, 0, 600, 500),
        preferredWidth: 560,
        minimumWidth: 280,
        preferredHeight: 260,
      }),
    ).toBeNull();
  });

  it("fails closed when controls obstruct all otherwise legal side-sheet footprints", () => {
    const viewport = rect(0, 0, 1200, 700);
    const sourceRects = [rect(500, 330, 120, 28), rect(628, 326, 72, 36)];

    expect(
      chooseQuestSideSheetPlacement({
        sourceRects,
        viewport,
        preferredWidth: 420,
        minimumWidth: 280,
        preferredHeight: 300,
        interactiveRects: [rect(0, 0, 430, 700), rect(770, 0, 430, 700)],
      }),
    ).toBeNull();
  });

  it("uses a genuinely top-edge-docked block sheet when the upper region is the larger legal fallback", () => {
    const viewport = rect(120, 75, 800, 600);
    const sourceRects = [rect(340, 480, 160, 30), rect(510, 474, 72, 42)];

    const sheet = chooseQuestBlockSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 600,
      preferredHeight: 240,
      minimumHeight: 120,
    });

    expect(sheet).toMatchObject({ edge: "top", left: 220, top: 75, width: 600, maxHeight: 387 });
    const layer = placedRect(sheet!, sheet!.width, 240);
    expect(layer.top).toBe(viewport.top);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 8)))).toBe(false);
  });

  it("uses a genuinely bottom-edge-docked block sheet when the lower region is the larger legal fallback", () => {
    const viewport = rect(120, 75, 800, 600);
    const sourceRects = [rect(340, 150, 160, 30), rect(510, 174, 72, 42)];

    const sheet = chooseQuestBlockSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 600,
      preferredHeight: 260,
      minimumHeight: 120,
    });

    expect(sheet).toMatchObject({ edge: "bottom", left: 220, top: 415, width: 600, maxHeight: 447 });
    const layer = placedRect(sheet!, sheet!.width, 260);
    expect(layer.bottom).toBe(viewport.bottom);
    expect(sourceRects.some((source) => previewRectsIntersect(layer, expandPreviewRect(source, 8)))).toBe(false);
  });

  it("slides a block-edge sheet along the edge to preserve a nearby interactive control", () => {
    const viewport = rect(0, 0, 1000, 700);
    const sourceRects = [rect(400, 280, 120, 28), rect(530, 276, 72, 36)];
    const control = rect(300, 500, 100, 40);

    const sheet = chooseQuestBlockSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 500,
      preferredHeight: 240,
      minimumHeight: 120,
      interactiveRects: [control],
    });

    expect(sheet).toMatchObject({ edge: "bottom", left: 492, top: 460, width: 500 });
    const layer = placedRect(sheet!, sheet!.width, 240);
    expect(previewRectsIntersect(layer, expandPreviewRect(control, 4))).toBe(false);
  });

  it("uses the opposite block edge rather than tolerating an obstructed preferred edge", () => {
    const viewport = rect(0, 0, 1000, 700);
    const sourceRects = [rect(400, 300, 120, 28), rect(530, 296, 72, 36)];
    const bottomControls = rect(0, 500, 1000, 40);

    const sheet = chooseQuestBlockSheetPlacement({
      sourceRects,
      viewport,
      preferredWidth: 500,
      preferredHeight: 240,
      minimumHeight: 120,
      interactiveRects: [bottomControls],
    });

    expect(sheet).toMatchObject({ edge: "top", top: 0, width: 500 });
  });

  it("fails closed instead of choosing a half-viewport block fallback across source or controls", () => {
    const viewport = rect(0, 0, 1000, 700);
    const sourceRects = [rect(400, 300, 120, 28), rect(530, 296, 72, 36)];

    expect(
      chooseQuestBlockSheetPlacement({
        sourceRects,
        viewport,
        preferredWidth: 500,
        preferredHeight: 240,
        minimumHeight: 120,
        interactiveRects: [rect(0, 80, 1000, 40), rect(0, 540, 1000, 40)],
      }),
    ).toBeNull();
  });

  it("reports no block-sheet fit when expanded source geometry leaves neither edge tall enough", () => {
    expect(
      chooseQuestBlockSheetPlacement({
        sourceRects: [rect(100, 110, 600, 280)],
        viewport: rect(0, 0, 800, 500),
        preferredWidth: 560,
        preferredHeight: 260,
        minimumHeight: 120,
      }),
    ).toBeNull();
  });

  it("measures Preview-center travel to the nearest point of any source fragment", () => {
    const distance = shortestCenterDistanceToSource(rect(106, 40, 68, 28), [
      rect(10, 10, 30, 18),
      rect(80, 40, 20, 28),
    ]);
    expect(distance).toBe(40);
  });
});
