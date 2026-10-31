/**
 * Motion in the status-group bar that compares one render with the previous one.
 *
 * When the tab on screen moves to another status group, its selected tab glides from where
 * its old group sat into its new group's place, so the move reads as one motion rather than
 * one tab item losing the selection and another gaining it. That covers a quest finishing
 * while the user watches (In progress to Done) and opening a tab whose result the opening
 * reads (New results to Done). It plays once per real move: never on first render, never
 * when the user opens a tab that stays in its group, never with reduced motion.
 */
import { useLayoutEffect, useRef, type RefObject } from "react";
import { normalizeThreadKey } from "../utils/thread-projection.js";

const CHIP_SELECTOR = '[data-testid="thread-tab-group-chip"]';
// Long and even enough to follow: a faster glide spent most of its travel in its first
// frames and was easy to miss.
const GLIDE_MS = 560;

/** The glide described above. */
export function useGroupMoveAnimation(
  barRef: RefObject<HTMLDivElement | null>,
  currentKey: string,
  currentGroup: string | null,
  groups: Readonly<Record<string, ReadonlyArray<{ threadKey: string }>>>,
): void {
  // Each render records which group held every tab and where every group's tab sits, so a
  // move starts from the tab's previous group even when that group has just emptied.
  const previous = useRef<{ groupOf: Map<string, string>; lefts: Map<string, number> } | null>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const lefts = new Map<string, number>();
    for (const chip of bar.querySelectorAll<HTMLElement>(CHIP_SELECTOR)) {
      if (chip.dataset.group) lefts.set(chip.dataset.group, chip.getBoundingClientRect().left);
    }
    const groupOf = new Map<string, string>();
    for (const [group, tabs] of Object.entries(groups)) {
      for (const tab of tabs) groupOf.set(normalizeThreadKey(tab.threadKey), group);
    }
    const before = previous.current;
    previous.current = { groupOf, lefts };
    const fromGroup = before?.groupOf.get(currentKey);
    if (!before || !fromGroup || !currentGroup || fromGroup === currentGroup) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const fromLeft = before.lefts.get(fromGroup);
    const to = bar.querySelector<HTMLElement>(`${CHIP_SELECTOR}[data-group="${currentGroup}"]`);
    if (fromLeft === undefined || !to || typeof to.animate !== "function") return;
    const dx = fromLeft - to.getBoundingClientRect().left;
    to.animate([{ transform: `translateX(${dx}px)` }, { transform: "translateX(0)" }], {
      duration: GLIDE_MS,
      easing: "cubic-bezier(0.35, 0.1, 0.25, 1)",
    });
  });
}
