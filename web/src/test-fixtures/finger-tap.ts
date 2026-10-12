import { fireEvent } from "@testing-library/react";

/**
 * Replays what a finger tap delivers in a mobile browser, all on one target:
 * pointer and touch events, then the emulated hover, mouse press and click.
 * Outside-press handlers see the press (touchstart or mousedown) before the
 * click, and hover handlers see an emulated mouseover, which is how they can
 * fight a toggle on the same element. A bare fireEvent.click skips all of
 * that and hides those bugs.
 */
export function fingerTap(target: Element): void {
  fireEvent.pointerOver(target, { pointerType: "touch" });
  fireEvent.pointerDown(target, { pointerType: "touch" });
  fireEvent.touchStart(target);
  fireEvent.pointerUp(target, { pointerType: "touch" });
  fireEvent.touchEnd(target);
  fireEvent.mouseOver(target);
  fireEvent.mouseDown(target);
  fireEvent.mouseUp(target);
  fireEvent.click(target);
}
