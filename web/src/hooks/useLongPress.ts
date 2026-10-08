import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from "react";

export const LONG_PRESS_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

/** Keeps iOS text selection and the native callout from competing with the menu. */
export const LONG_PRESS_TARGET_CLASS = "select-none [-webkit-touch-callout:none]";

/** Opens a context menu at viewport coordinates. */
export type OpenContextMenu = (x: number, y: number) => void;

/**
 * Touch long-press plus right-click for opening a context menu, matching a
 * native iOS menu: the target presses in while held, a long-press opens the
 * menu just below the target (so the finger does not cover it), and lifting
 * the finger never dismisses the menu or activates the target.
 *
 * iOS Safari never fires `contextmenu` for touch, so the press is timed here.
 * Spread `handlers` on the target, merge `pressStyle` into its style, and
 * skip hover cards while `isSuppressingMouse()` is true. Pass `undefined` to
 * disable the menu; the browser's own context menu then stays available.
 */
export function useLongPress(onOpen: OpenContextMenu | undefined) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  // Set when a long-press opens the menu and kept until the next touchstart.
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);
  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };
  const cancel = () => {
    clearTimer();
    setPressing(false);
  };
  useEffect(() => clearTimer, []);
  // iOS does not reliably honor the cancelled touchend after a long press and
  // can still emulate mousedown/mouseup/click when the finger lifts. Swallow
  // them here: the mousedown would otherwise reach the menu's outside-press
  // dismissal and close the menu the moment it opened, and the click would
  // activate the target.
  const swallowEmulatedMouse = (event: MouseEvent<HTMLElement>) => {
    if (!firedRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return {
    pressing,
    pressStyle: pressing
      ? ({ scale: "0.94", transition: `scale ${LONG_PRESS_MS}ms ease-out` } satisfies CSSProperties)
      : undefined,
    /** iOS also emulates a hover when a long-press lifts; hover cards should ignore it. */
    isSuppressingMouse: () => firedRef.current,
    handlers: {
      onTouchStart: (event: TouchEvent<HTMLElement>) => {
        clearTimer();
        // Emulated mouse events never start with touchstart, so this ends
        // the previous long-press's suppression without swallowing this tap.
        firedRef.current = false;
        const touch = event.touches[0];
        if (!onOpen || !touch || event.touches.length > 1) {
          setPressing(false);
          return;
        }
        startRef.current = { x: touch.clientX, y: touch.clientY };
        setPressing(true);
        const element = event.currentTarget;
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          firedRef.current = true;
          setPressing(false);
          // Android haptics. iOS has no web API that can tick mid-press.
          navigator.vibrate?.(10);
          const rect = element.getBoundingClientRect();
          onOpen(rect.left, rect.bottom + 4);
        }, LONG_PRESS_MS);
      },
      onTouchMove: (event: TouchEvent<HTMLElement>) => {
        const start = startRef.current;
        const touch = event.touches[0];
        if (!start || !touch) return;
        const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y);
        if (moved > LONG_PRESS_MOVE_TOLERANCE_PX) cancel();
      },
      onTouchEnd: (event: TouchEvent<HTMLElement>) => {
        cancel();
        if (firedRef.current) event.preventDefault();
      },
      onTouchCancel: cancel,
      onMouseDownCapture: swallowEmulatedMouse,
      onMouseUpCapture: swallowEmulatedMouse,
      onClickCapture: swallowEmulatedMouse,
      onContextMenu: (event: MouseEvent<HTMLElement>) => {
        if (!onOpen) return;
        event.preventDefault();
        // Android also fires contextmenu on long-press; let whichever fires
        // first open the menu.
        cancel();
        if (!firedRef.current) onOpen(event.clientX, event.clientY);
      },
    },
  };
}
