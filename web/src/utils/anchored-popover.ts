import type { CSSProperties } from "react";

/**
 * Fixed-position style that opens a popover just below its trigger, on the
 * trigger's side of the screen: left-aligned for triggers in the sessions panel,
 * right-aligned for top-bar triggers. Keeps `width` px of popover on screen.
 */
export function anchoredPopoverStyle(
  trigger: HTMLElement | null,
  width: number,
  { fallbackTop = 44, minBottomSpace = 180 }: { fallbackTop?: number; minBottomSpace?: number } = {},
): CSSProperties {
  const rect = trigger?.getBoundingClientRect();
  const top = rect ? Math.min(rect.bottom + 6, window.innerHeight - minBottomSpace) : fallbackTop;
  if (!rect || rect.left + rect.width / 2 >= window.innerWidth / 2) return { top, right: 12 };
  const fittedWidth = Math.min(width, window.innerWidth - 24);
  return { top, left: Math.max(12, Math.min(rect.left, window.innerWidth - fittedWidth - 12)) };
}
