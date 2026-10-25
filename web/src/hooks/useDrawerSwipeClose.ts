import { useRef, useState, type TouchEvent } from "react";

const AXIS_LOCK_PX = 8;
const CLOSE_FRACTION = 0.25;
const FLICK_PX = 30;
const FLICK_MS = 250;

/** Touches that start here keep their own sideways meaning (text cursor, sideways scroll, reorder handle). */
const IGNORED_START = "input, textarea, select, .overflow-x-auto, [data-session-drag-handle='true']";

/**
 * Swiping a phone drawer that slides in from the left back toward the left edge closes it, as in
 * native apps. The drawer follows the finger while dragged (`dragPx`, zero or negative, to merge
 * into its transform with transitions off) and closes on release once dragged a quarter of its
 * width or flicked; otherwise it springs back. A mostly vertical drag stays a scroll, and a drag
 * to the right does nothing. Spread `handlers` on the drawer; pass `enabled` false while it is
 * closed or not a drawer.
 */
export function useDrawerSwipeClose(onClose: () => void, enabled: boolean) {
  const start = useRef<{
    x: number;
    y: number;
    time: number;
    axis: "x" | "y" | null;
  } | null>(null);
  const [dragPx, setDragPx] = useState<number | null>(null);

  const reset = () => {
    start.current = null;
    setDragPx(null);
  };

  return {
    dragPx,
    handlers: {
      onTouchStart: (event: TouchEvent<HTMLElement>) => {
        const touch = event.touches[0];
        if (!enabled || !touch || event.touches.length > 1 || (event.target as Element).closest(IGNORED_START)) {
          start.current = null;
          return;
        }
        start.current = {
          x: touch.clientX,
          y: touch.clientY,
          time: performance.now(),
          axis: null,
        };
      },
      onTouchMove: (event: TouchEvent<HTMLElement>) => {
        const origin = start.current;
        const touch = event.touches[0];
        if (!origin || !touch) return;
        if (event.touches.length > 1) return reset();
        const dx = touch.clientX - origin.x;
        const dy = touch.clientY - origin.y;
        if (!origin.axis) {
          if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
          origin.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        }
        if (origin.axis === "x") setDragPx(Math.min(0, dx));
      },
      onTouchEnd: (event: TouchEvent<HTMLElement>) => {
        const origin = start.current;
        const touch = event.changedTouches[0];
        reset();
        if (!origin || origin.axis !== "x" || !touch) return;
        const dx = touch.clientX - origin.x;
        const width = event.currentTarget.getBoundingClientRect().width || window.innerWidth;
        const flicked = dx <= -FLICK_PX && performance.now() - origin.time <= FLICK_MS;
        if (dx <= -width * CLOSE_FRACTION || flicked) onClose();
      },
      onTouchCancel: reset,
    },
  };
}
