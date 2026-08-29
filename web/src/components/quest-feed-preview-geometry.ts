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

type Candidate = PreviewPlacement & { rect: PreviewRect };

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
  const exclusions = [
    ...sourceRects.map((rect) => expandPreviewRect(rect, sourceInset)),
    expandPreviewRect(triggerRect, interactiveInset),
    ...interactiveRects.map((rect) => expandPreviewRect(rect, interactiveInset)),
  ];

  const legal = candidates.filter((candidate) => {
    if (!previewRectInsideViewport(candidate.rect, viewport, viewportInset)) return false;
    if (exclusions.some((rect) => previewRectsIntersect(candidate.rect, rect))) return false;
    if (pointer && previewRectContainsPoint(candidate.rect, pointer)) return false;
    return true;
  });
  if (legal.length === 0) return null;

  legal.sort((a, b) => {
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
  return chooseLegalPlacement({
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

export interface QuestSideSheetPlacement {
  side: "left" | "right";
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

const SHEET_ORTHOGONAL_INSET = 8;
const SHEET_SOURCE_GAP = 12;
const SHEET_SOURCE_INSET = 8;
const SHEET_INTERACTIVE_INSET = 4;

function candidateClearsSheetExclusions(
  candidate: PreviewRect,
  sourceRects: readonly PreviewRect[],
  interactiveRects: readonly PreviewRect[],
): boolean {
  return (
    !sourceRects.some((rect) => previewRectsIntersect(candidate, expandPreviewRect(rect, SHEET_SOURCE_INSET))) &&
    !interactiveRects.some((rect) => previewRectsIntersect(candidate, expandPreviewRect(rect, SHEET_INTERACTIVE_INSET)))
  );
}

function distinctNumbers(values: readonly number[]): number[] {
  return values.filter(
    (value, index) => values.findIndex((candidate) => Math.abs(candidate - value) < EPSILON) === index,
  );
}

export function chooseQuestSideSheetPlacement({
  sourceRects,
  viewport,
  preferredWidth,
  minimumWidth,
  preferredHeight,
  interactiveRects = [],
}: {
  sourceRects: readonly PreviewRect[];
  viewport: PreviewViewport;
  preferredWidth: number;
  minimumWidth: number;
  preferredHeight?: number;
  interactiveRects?: readonly PreviewRect[];
}): QuestSideSheetPlacement | null {
  if (
    sourceRects.length === 0 ||
    viewport.width <= 0 ||
    viewport.height <= SHEET_ORTHOGONAL_INSET * 2 ||
    preferredWidth <= 0 ||
    minimumWidth <= 0
  ) {
    return null;
  }

  const sourceLeft = Math.min(...sourceRects.map((rect) => rect.left));
  const sourceRight = Math.max(...sourceRects.map((rect) => rect.right));
  const maxHeight = viewport.height - SHEET_ORTHOGONAL_INSET * 2;
  const measuredHeight = preferredHeight == null ? maxHeight : Math.min(preferredHeight, maxHeight);
  if (measuredHeight <= 0) return null;

  const sideOptions = [
    {
      side: "right" as const,
      available: viewport.right - sourceRight - SHEET_SOURCE_GAP,
    },
    {
      side: "left" as const,
      available: sourceLeft - SHEET_SOURCE_GAP - viewport.left,
    },
  ];
  const topAnchors = distinctNumbers([
    viewport.top + SHEET_ORTHOGONAL_INSET,
    viewport.bottom - SHEET_ORTHOGONAL_INSET - measuredHeight,
  ]);

  const candidates = sideOptions.flatMap((option) => {
    const width = Math.min(preferredWidth, option.available);
    if (width < minimumWidth) return [];
    const left = option.side === "right" ? viewport.right - width : viewport.left;
    return topAnchors.map((top, anchorOrder) => {
      const rect = candidateRect(left, top, width, measuredHeight);
      return { ...option, width, left, top, anchorOrder, rect };
    });
  });

  const selected = candidates
    .filter((candidate) => {
      const touchesRequestedEdge =
        candidate.side === "right"
          ? Math.abs(candidate.rect.right - viewport.right) < EPSILON
          : Math.abs(candidate.rect.left - viewport.left) < EPSILON;
      const insideOrthogonalBounds =
        candidate.rect.top >= viewport.top + SHEET_ORTHOGONAL_INSET &&
        candidate.rect.bottom <= viewport.bottom - SHEET_ORTHOGONAL_INSET;
      return (
        touchesRequestedEdge &&
        insideOrthogonalBounds &&
        candidateClearsSheetExclusions(candidate.rect, sourceRects, interactiveRects)
      );
    })
    .sort((a, b) => b.available - a.available || a.anchorOrder - b.anchorOrder)[0];

  if (!selected) return null;
  return {
    side: selected.side,
    left: selected.left,
    top: selected.top,
    width: selected.width,
    maxHeight,
  };
}

export function shortestCenterDistanceToSource(triggerRect: PreviewRect, sourceRects: readonly PreviewRect[]): number {
  const center = rectCenter(triggerRect);
  if (sourceRects.length === 0) return Number.POSITIVE_INFINITY;
  return Math.sqrt(Math.min(...sourceRects.map((rect) => pointToRectDistanceSquared(center, rect))));
}

export interface QuestBlockSheetPlacement {
  edge: "top" | "bottom";
  left: number;
  top: number;
  width: number;
  maxHeight: number;
}

export function chooseQuestBlockSheetPlacement({
  sourceRects,
  interactiveRects = [],
  viewport,
  preferredWidth,
  preferredHeight,
  minimumHeight = 120,
}: {
  sourceRects: readonly PreviewRect[];
  interactiveRects?: readonly PreviewRect[];
  viewport: PreviewViewport;
  preferredWidth: number;
  preferredHeight: number;
  minimumHeight?: number;
}): QuestBlockSheetPlacement | null {
  if (
    sourceRects.length === 0 ||
    viewport.width <= SHEET_ORTHOGONAL_INSET * 2 ||
    viewport.height <= 0 ||
    preferredWidth <= 0 ||
    preferredHeight <= 0 ||
    minimumHeight <= 0
  ) {
    return null;
  }

  const sourceTop = Math.min(...sourceRects.map((rect) => rect.top));
  const sourceBottom = Math.max(...sourceRects.map((rect) => rect.bottom));
  const width = Math.min(preferredWidth, viewport.width - SHEET_ORTHOGONAL_INSET * 2);
  if (width <= 0) return null;

  const horizontalAnchors = distinctNumbers([
    viewport.left + (viewport.width - width) / 2,
    viewport.left + SHEET_ORTHOGONAL_INSET,
    viewport.right - SHEET_ORTHOGONAL_INSET - width,
  ]);
  const edgeOptions = [
    {
      edge: "bottom" as const,
      available: viewport.bottom - sourceBottom - SHEET_SOURCE_GAP,
    },
    {
      edge: "top" as const,
      available: sourceTop - SHEET_SOURCE_GAP - viewport.top,
    },
  ];

  const candidates = edgeOptions.flatMap((option) => {
    const height = Math.min(preferredHeight, option.available);
    if (height < minimumHeight) return [];
    const top = option.edge === "bottom" ? viewport.bottom - height : viewport.top;
    return horizontalAnchors.map((left, anchorOrder) => {
      const rect = candidateRect(left, top, width, height);
      return { ...option, left, top, width, height, anchorOrder, rect };
    });
  });

  const selected = candidates
    .filter((candidate) => {
      const touchesRequestedEdge =
        candidate.edge === "bottom"
          ? Math.abs(candidate.rect.bottom - viewport.bottom) < EPSILON
          : Math.abs(candidate.rect.top - viewport.top) < EPSILON;
      const insideOrthogonalBounds =
        candidate.rect.left >= viewport.left + SHEET_ORTHOGONAL_INSET &&
        candidate.rect.right <= viewport.right - SHEET_ORTHOGONAL_INSET;
      return (
        touchesRequestedEdge &&
        insideOrthogonalBounds &&
        candidateClearsSheetExclusions(candidate.rect, sourceRects, interactiveRects)
      );
    })
    .sort((a, b) => b.available - a.available || a.anchorOrder - b.anchorOrder)[0];

  if (!selected) return null;
  return {
    edge: selected.edge,
    left: selected.left,
    top: selected.top,
    width: selected.width,
    maxHeight: selected.available,
  };
}
