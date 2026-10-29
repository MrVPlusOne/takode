export interface PreviewRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PreviewPoint {
  x: number;
  y: number;
}

export interface PreviewPlacement {
  left: number;
  top: number;
  direction: "block-end" | "block-start" | "inline-end" | "inline-start";
}

export interface PreviewViewport extends PreviewRect {}

const EPSILON = 0.5;

export function rectFromEdges(left: number, top: number, right: number, bottom: number): PreviewRect {
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function toPreviewRect(
  rect: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom" | "width" | "height">,
): PreviewRect {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
}

export function collectNonEmptyClientRects(element: Element | null): PreviewRect[] {
  if (!element) return [];
  return Array.from(element.getClientRects())
    .filter((rect) => rect.width > EPSILON && rect.height > EPSILON)
    .map(toPreviewRect);
}

export function getVisualViewportRect(targetWindow: Window = window): PreviewViewport {
  const viewport = targetWindow.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? targetWindow.innerWidth;
  const height = viewport?.height ?? targetWindow.innerHeight;
  return rectFromEdges(left, top, left + width, top + height);
}

export function expandPreviewRect(rect: PreviewRect, amount: number): PreviewRect {
  return rectFromEdges(rect.left - amount, rect.top - amount, rect.right + amount, rect.bottom + amount);
}

export function previewRectsIntersect(a: PreviewRect, b: PreviewRect): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function previewRectContainsPoint(rect: PreviewRect, point: PreviewPoint): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

export function previewRectInsideViewport(rect: PreviewRect, viewport: PreviewViewport, inset = 8): boolean {
  return (
    rect.left >= viewport.left + inset &&
    rect.right <= viewport.right - inset &&
    rect.top >= viewport.top + inset &&
    rect.bottom <= viewport.bottom - inset
  );
}

export function previewRectVisibleInViewport(rect: PreviewRect, viewport: PreviewViewport): boolean {
  return previewRectsIntersect(rect, viewport);
}

function candidateRect(left: number, top: number, width: number, height: number): PreviewRect {
  return rectFromEdges(left, top, left + width, top + height);
}

function rectCenter(rect: PreviewRect): PreviewPoint {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function pointDistanceSquared(a: PreviewPoint, b: PreviewPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function pointToRectDistanceSquared(point: PreviewPoint, rect: PreviewRect): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return dx * dx + dy * dy;
}

function nearestSourceCenter(sourceRects: readonly PreviewRect[], pointer?: PreviewPoint | null): PreviewPoint {
  if (sourceRects.length === 0) return { x: 0, y: 0 };
  if (!pointer) {
    const left = Math.min(...sourceRects.map((rect) => rect.left));
    const right = Math.max(...sourceRects.map((rect) => rect.right));
    const top = Math.min(...sourceRects.map((rect) => rect.top));
    const bottom = Math.max(...sourceRects.map((rect) => rect.bottom));
    return { x: (left + right) / 2, y: (top + bottom) / 2 };
  }
  let nearest = sourceRects[0];
  let nearestDistance = pointToRectDistanceSquared(pointer, nearest);
  for (const rect of sourceRects.slice(1)) {
    const distance = pointToRectDistanceSquared(pointer, rect);
    if (distance < nearestDistance) {
      nearest = rect;
      nearestDistance = distance;
    }
  }
  return rectCenter(nearest);
}

type Candidate = PreviewPlacement & { rect: PreviewRect; slideDistance?: number };

function placementCandidates(triggerRect: PreviewRect, width: number, height: number, gap: number): Candidate[] {
  const candidates: Candidate[] = [];
  const add = (left: number, top: number, direction: PreviewPlacement["direction"]) => {
    if (candidates.some((candidate) => candidate.left === left && candidate.top === top)) return;
    candidates.push({ left, top, direction, rect: candidateRect(left, top, width, height) });
  };

  add(triggerRect.left, triggerRect.bottom + gap, "block-end");
  add(triggerRect.right - width, triggerRect.bottom + gap, "block-end");
  add(triggerRect.left, triggerRect.top - height - gap, "block-start");
  add(triggerRect.right - width, triggerRect.top - height - gap, "block-start");
  add(triggerRect.right + gap, triggerRect.top, "inline-end");
  add(triggerRect.right + gap, triggerRect.bottom - height, "inline-end");
  add(triggerRect.left - width - gap, triggerRect.top, "inline-start");
  add(triggerRect.left - width - gap, triggerRect.bottom - height, "inline-start");
  return candidates;
}

function expandedPlacementExclusions({
  sourceRects,
  triggerRect,
  interactiveRects,
  sourceInset,
  interactiveInset,
}: {
  sourceRects: readonly PreviewRect[];
  triggerRect: PreviewRect;
  interactiveRects: readonly PreviewRect[];
  sourceInset: number;
  interactiveInset: number;
}): PreviewRect[] {
  return [
    ...sourceRects.map((rect) => expandPreviewRect(rect, sourceInset)),
    expandPreviewRect(triggerRect, interactiveInset),
    ...interactiveRects.map((rect) => expandPreviewRect(rect, interactiveInset)),
  ];
}

function titleSlidingCandidates({
  triggerRect,
  layerSize,
  exclusions,
  viewport,
}: {
  triggerRect: PreviewRect;
  layerSize: { width: number; height: number };
  exclusions: readonly PreviewRect[];
  viewport: PreviewViewport;
}): Candidate[] {
  // The normal eight positions remain the first choice. These candidates are
  // only a no-fit fallback, aligned to viewport or exclusion boundaries so the
  // title can move around dense controls without being clamped across them.
  const { width, height } = layerSize;
  const viewportInset = 8;
  const gap = 6;
  const maxSlideDistance = height + triggerRect.width;
  const candidates: Candidate[] = [];
  const add = (left: number, top: number, direction: PreviewPlacement["direction"], slideDistance: number) => {
    // A compact hover should stay recognizably attached to its source rather
    // than escaping a dense local cage by jumping across the viewport.
    if (slideDistance > maxSlideDistance) return;
    const duplicate = candidates.find(
      (candidate) => candidate.left === left && candidate.top === top && candidate.direction === direction,
    );
    if (duplicate) {
      duplicate.slideDistance = Math.min(duplicate.slideDistance ?? slideDistance, slideDistance);
      return;
    }
    candidates.push({ left, top, direction, slideDistance, rect: candidateRect(left, top, width, height) });
  };

  const blockLefts = [
    viewport.left + viewportInset,
    viewport.right - viewportInset - width,
    ...exclusions.flatMap((rect) => [rect.left - width, rect.right]),
  ];
  const blockStarts = [triggerRect.left, triggerRect.right - width];
  for (const { top, direction } of [
    { top: triggerRect.bottom + gap, direction: "block-end" as const },
    { top: triggerRect.top - height - gap, direction: "block-start" as const },
  ]) {
    for (const left of blockLefts) {
      add(left, top, direction, Math.min(...blockStarts.map((start) => Math.abs(left - start))));
    }
  }

  const inlineTops = [
    viewport.top + viewportInset,
    viewport.bottom - viewportInset - height,
    ...exclusions.flatMap((rect) => [rect.top - height, rect.bottom]),
  ];
  const inlineStarts = [triggerRect.top, triggerRect.bottom - height];
  for (const { left, direction } of [
    { left: triggerRect.right + gap, direction: "inline-end" as const },
    { left: triggerRect.left - width - gap, direction: "inline-start" as const },
  ]) {
    for (const top of inlineTops) {
      add(left, top, direction, Math.min(...inlineStarts.map((start) => Math.abs(top - start))));
    }
  }

  return candidates;
}

function chooseLegalPlacement({
  candidates,
  sourceRects,
  triggerRect,
  interactiveRects,
  viewport,
  pointer,
  viewportInset,
  sourceInset,
  interactiveInset,
}: {
  candidates: Candidate[];
  sourceRects: readonly PreviewRect[];
  triggerRect: PreviewRect;
  interactiveRects: readonly PreviewRect[];
  viewport: PreviewViewport;
  pointer?: PreviewPoint | null;
  viewportInset: number;
  sourceInset: number;
  interactiveInset: number;
}): PreviewPlacement | null {
  const sourceCenters = pointer
    ? [nearestSourceCenter(sourceRects, pointer)]
    : sourceRects.map((rect) => rectCenter(rect));
  const triggerCenter = rectCenter(triggerRect);
  const exclusions = expandedPlacementExclusions({
    sourceRects,
    triggerRect,
    interactiveRects,
    sourceInset,
    interactiveInset,
  });

  const legal = candidates.filter((candidate) => {
    if (!previewRectInsideViewport(candidate.rect, viewport, viewportInset)) return false;
    if (exclusions.some((rect) => previewRectsIntersect(candidate.rect, rect))) return false;
    if (pointer && previewRectContainsPoint(candidate.rect, pointer)) return false;
    return true;
  });
  if (legal.length === 0) return null;

  legal.sort((a, b) => {
    // Sliding fallback candidates should perturb the accepted eye-relative
    // geometry as little as possible before applying the normal proximity score.
    const slideDistanceDelta = (a.slideDistance ?? 0) - (b.slideDistance ?? 0);
    if (slideDistanceDelta !== 0) return slideDistanceDelta;
    const aCenter = rectCenter(a.rect);
    const bCenter = rectCenter(b.rect);
    const aSourceScore = Math.min(...sourceCenters.map((center) => pointDistanceSquared(aCenter, center)));
    const bSourceScore = Math.min(...sourceCenters.map((center) => pointDistanceSquared(bCenter, center)));
    const aScore = aSourceScore + pointDistanceSquared(aCenter, triggerCenter) * 0.25;
    const bScore = bSourceScore + pointDistanceSquared(bCenter, triggerCenter) * 0.25;
    return aScore - bScore;
  });
  const selected = legal[0];
  return { left: selected.left, top: selected.top, direction: selected.direction };
}

export function chooseQuestTitlePlacement({
  sourceRects,
  triggerRect,
  layerSize,
  interactiveRects = [],
  viewport,
  pointer,
}: {
  sourceRects: readonly PreviewRect[];
  triggerRect: PreviewRect;
  layerSize: { width: number; height: number };
  interactiveRects?: readonly PreviewRect[];
  viewport: PreviewViewport;
  pointer?: PreviewPoint | null;
}): PreviewPlacement | null {
  if (sourceRects.length === 0 || layerSize.width <= 0 || layerSize.height <= 0) return null;
  const primary = chooseLegalPlacement({
    candidates: placementCandidates(triggerRect, layerSize.width, layerSize.height, 6),
    sourceRects,
    triggerRect,
    interactiveRects,
    viewport,
    pointer,
    viewportInset: 8,
    sourceInset: 6,
    interactiveInset: 4,
  });
  if (primary) return primary;

  return chooseLegalPlacement({
    candidates: titleSlidingCandidates({
      triggerRect,
      layerSize,
      exclusions: expandedPlacementExclusions({
        sourceRects,
        triggerRect,
        interactiveRects,
        sourceInset: 6,
        interactiveInset: 4,
      }),
      viewport,
    }),
    sourceRects,
    triggerRect,
    interactiveRects,
    viewport,
    pointer,
    viewportInset: 8,
    sourceInset: 6,
    interactiveInset: 4,
  });
}

export function chooseQuestRichPopoverPlacement({
  sourceRects,
  triggerRect,
  layerSize,
  interactiveRects = [],
  viewport,
}: {
  sourceRects: readonly PreviewRect[];
  triggerRect: PreviewRect;
  layerSize: { width: number; height: number };
  interactiveRects?: readonly PreviewRect[];
  viewport: PreviewViewport;
}): PreviewPlacement | null {
  if (sourceRects.length === 0 || layerSize.width <= 0 || layerSize.height <= 0) return null;
  return chooseLegalPlacement({
    candidates: placementCandidates(triggerRect, layerSize.width, layerSize.height, 8),
    sourceRects,
    triggerRect,
    interactiveRects,
    viewport,
    viewportInset: 8,
    sourceInset: 8,
    interactiveInset: 4,
  });
}
