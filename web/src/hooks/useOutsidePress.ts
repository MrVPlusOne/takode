import { useEffect, useRef, type RefObject } from "react";

/**
 * Part of a surface: an element, a ref to one, or a CSS selector matched
 * against the pressed element and its ancestors.
 */
export type OutsidePressInside = Element | RefObject<Element | null> | string | null | undefined;

/**
 * Calls `onOutsidePress` when a finger or mouse goes down outside a popover,
 * panel, menu or dropdown. Every surface that closes on an outside tap uses it.
 *
 * - `inside` lists what counts as part of the surface, the surface itself
 *   first; while the surface is not in the page, presses do nothing. Include
 *   the trigger that opens and closes it: a tap sends its press before its
 *   click, so a trigger counted as outside would close the surface on the
 *   press and reopen it on the click. Name layers the surface opens elsewhere
 *   in the page, such as its menus and dialogs, with selectors.
 * - It listens to `pointerdown` in the capture phase on the document. A finger
 *   landing outside closes the surface at once, including at the start of a
 *   scroll, and no handler that stops propagation can keep the surface open.
 * - Pass `enabled = false` while the surface is closed.
 */
export function useOutsidePress(
  inside: readonly OutsidePressInside[],
  onOutsidePress: (event: PointerEvent) => void,
  enabled = true,
): void {
  const latest = useRef({ inside, onOutsidePress });
  latest.current = { inside, onOutsidePress };

  useEffect(() => {
    if (!enabled) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const { inside } = latest.current;
      if (!(target instanceof Element) || !isMounted(inside[0])) return;
      if (inside.some((part) => containsTarget(part, target))) return;
      latest.current.onOutsidePress(event);
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [enabled]);
}

function isMounted(surface: OutsidePressInside): boolean {
  if (!surface) return false;
  if (typeof surface === "string") return true;
  return surface instanceof Element ? surface.isConnected : surface.current !== null;
}

function containsTarget(part: OutsidePressInside, target: Element): boolean {
  if (!part) return false;
  if (typeof part === "string") return target.closest(part) !== null;
  const element = part instanceof Element ? part : part.current;
  return element?.contains(target) ?? false;
}
