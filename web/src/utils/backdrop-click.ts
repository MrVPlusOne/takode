import type { MouseEvent, PointerEvent } from "react";

interface Press {
  down: EventTarget | null;
  up: EventTarget | null;
}

// Keyed by the backdrop element, so the props need no hook and work wherever a backdrop renders.
const pressesByBackdrop = new WeakMap<EventTarget, Press>();

/**
 * Props for a backdrop (scrim) that closes its dialog, sheet or viewer when clicked. Every
 * backdrop that wraps its surface uses them.
 *
 * A browser sends a click to the nearest element containing both where the press started and
 * where it ended, so selecting text or dragging inside the surface and letting go over the
 * backdrop arrives as a click on the backdrop. These props call `onBackdropClick` only when the
 * press started and ended on the clicked element itself; a plain click outside the surface still
 * closes it. A click without a pointer press (keyboard, scripted) passes through unchanged.
 *
 * They close on the click rather than the press: React then marks the backdrop clickable, which
 * iOS Safari needs before it delivers a tap, and the tap's click cannot land on whatever was
 * under the backdrop once it is gone. The press is recorded in the capture phase, so a handler
 * inside that stops propagation cannot hide it.
 */
export function backdropClickProps<T extends Element>(onBackdropClick: (event: MouseEvent<T>) => void) {
  return {
    onPointerDownCapture: (event: PointerEvent<T>) => {
      pressesByBackdrop.set(event.currentTarget, {
        down: event.target,
        up: null,
      });
    },
    onPointerUpCapture: (event: PointerEvent<T>) => {
      const press = pressesByBackdrop.get(event.currentTarget);
      if (press) press.up = event.target;
    },
    onClick: (event: MouseEvent<T>) => {
      const press = pressesByBackdrop.get(event.currentTarget);
      pressesByBackdrop.delete(event.currentTarget);
      if (press && (press.down !== event.target || press.up !== event.target)) return;
      onBackdropClick(event);
    },
  };
}
