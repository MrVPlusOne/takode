/**
 * When the tab on screen moves to another status group, for example from In progress to
 * Done as its quest finishes, its selected tab glides from where its old group sat into its
 * new group's place, so the move reads as one motion rather than one tab item losing the
 * selection and another gaining it. It plays once per real move: never on first render,
 * never when the user switches tabs, never with reduced motion.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";

const CHIP_SELECTOR = '[data-testid="thread-tab-group-chip"]';
const GLIDE_MS = 260;

export function useGroupMoveAnimation(
  barRef: RefObject<HTMLDivElement | null>,
  currentKey: string,
  currentGroup: string | null,
): void {
  // Each render records where every group's tab sits, so a move can start from the old
  // group's place even when that group has just emptied and its tab is gone.
  const previous = useRef<{ key: string; group: string | null; lefts: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const lefts = new Map<string, number>();
    for (const chip of bar.querySelectorAll<HTMLElement>(CHIP_SELECTOR)) {
      if (chip.dataset.group) lefts.set(chip.dataset.group, chip.getBoundingClientRect().left);
    }
    const before = previous.current;
    previous.current = { key: currentKey, group: currentGroup, lefts };
    if (!before || before.key !== currentKey || !before.group || !currentGroup || before.group === currentGroup) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const fromLeft = before.lefts.get(before.group);
    const to = bar.querySelector<HTMLElement>(`${CHIP_SELECTOR}[data-group="${currentGroup}"]`);
    if (fromLeft === undefined || !to || typeof to.animate !== "function") return;
    const dx = fromLeft - to.getBoundingClientRect().left;
    to.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
      duration: GLIDE_MS,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  });
}
