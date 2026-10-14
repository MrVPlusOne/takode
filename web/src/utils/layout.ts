const SHELL_DESKTOP_BREAKPOINT = 768;
const TASK_PANEL_DESKTOP_BREAKPOINT = 1024;
const COMPOSER_NARROW_BREAKPOINT = 640;

export function getEffectiveViewportWidth(zoomLevel: number): number {
  if (typeof window === "undefined") {
    return Number.POSITIVE_INFINITY;
  }
  const safeZoom = Number.isFinite(zoomLevel) && zoomLevel > 0 ? zoomLevel : 1;
  return window.innerWidth / safeZoom;
}

export function isDesktopShellLayout(zoomLevel: number): boolean {
  return getEffectiveViewportWidth(zoomLevel) >= SHELL_DESKTOP_BREAKPOINT;
}

export function isDesktopTaskPanelLayout(zoomLevel: number): boolean {
  return getEffectiveViewportWidth(zoomLevel) >= TASK_PANEL_DESKTOP_BREAKPOINT;
}

export function isNarrowComposerLayout(zoomLevel: number): boolean {
  return getEffectiveViewportWidth(zoomLevel) < COMPOSER_NARROW_BREAKPOINT;
}

const SECONDARY_VIEW_MIN_WIDTH = 420;
const SECONDARY_VIEW_MAX_WIDTH = 760;
const SECONDARY_VIEW_MIN_UNCOVERED_WIDTH = 48;
const PRIMARY_VIEW_MIN_WIDTH_BESIDE_SECONDARY = 560;

/**
 * Width of the right-hand secondary view area, given the width left for the conversation and it
 * after the sidebar and task panel, or null when it would not fit and should cover the
 * conversation instead. Leaves a strip of the conversation uncovered when it floats.
 */
export function secondaryViewWidth(availableWidth: number): number | null {
  if (availableWidth - SECONDARY_VIEW_MIN_UNCOVERED_WIDTH < SECONDARY_VIEW_MIN_WIDTH) return null;
  return Math.min(SECONDARY_VIEW_MAX_WIDTH, Math.max(SECONDARY_VIEW_MIN_WIDTH, Math.round(availableWidth * 0.45)));
}

/** Whether the conversation stays readable beside a secondary view area of `width`. */
export function canShowSecondaryViewBeside(availableWidth: number, width: number): boolean {
  return availableWidth - width >= PRIMARY_VIEW_MIN_WIDTH_BESIDE_SECONDARY;
}
