import type { PreviewPlacement, PreviewRect, PreviewViewport } from "./quest-feed-preview-geometry.js";

const DEFAULT_GAP = 6;
const DEFAULT_VIEWPORT_INSET = 8;

/**
 * Preserve the established quest-hover placement sequence: start immediately
 * below the trigger, clamp against the right edge, flip above on bottom
 * overflow, then clamp against the top edge. The sequence intentionally does
 * not exclude or protect the trigger from the final card footprint.
 */
export function chooseLegacyQuestHoverPlacement({
  anchorRect,
  layerSize,
  viewport,
  placementWidth = layerSize.width,
  gap = DEFAULT_GAP,
  viewportInset = DEFAULT_VIEWPORT_INSET,
}: {
  anchorRect: PreviewRect;
  layerSize: { width: number; height: number };
  viewport: PreviewViewport;
  placementWidth?: number;
  gap?: number;
  viewportInset?: number;
}): PreviewPlacement {
  let left = anchorRect.left;
  let top = anchorRect.bottom + gap;
  let direction: PreviewPlacement["direction"] = "block-end";

  if (left + layerSize.width > viewport.right - viewportInset) {
    left = Math.max(viewport.left + viewportInset, viewport.right - placementWidth - viewportInset);
  }
  if (top + layerSize.height > viewport.bottom - viewportInset) {
    top = Math.max(viewport.top + viewportInset, anchorRect.top - layerSize.height - gap);
    direction = "block-start";
  }
  if (top < viewport.top + viewportInset) {
    top = viewport.top + viewportInset;
  }

  return { left, top, direction };
}
