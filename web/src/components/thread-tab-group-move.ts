/**
 * Motion in the status-group bar that compares one render with the previous one.
 *
 * When the tab on screen moves to another status group, the tab itself floats above the row and
 * glides from its old group to its new one (Jiayi, Nov 1): both groups stay where they are, the
 * new group is not the thing that moves, and an old group the move emptied stays until the tab has
 * left it. That covers a quest finishing while the user watches (In progress to Idle) and opening a
 * tab whose result the opening reads (Unread to Idle). It plays once per real move: never on first
 * render, never when the user opens a tab that stays in its group, never with reduced motion.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { normalizeThreadKey } from "../utils/thread-projection.js";

const CHIP_SELECTOR = '[data-testid="thread-tab-group-chip"]';
// Long and even enough to follow: a faster glide spent most of its travel in its first
// frames and was easy to miss.
export const GLIDE_MS = 560;

/** A move playing now: from the group that held the tab on screen to the one holding it now. */
export interface GroupMove<Tab> {
  from: string;
  to: string;
  /** The old group's tabs before the move, which keep an emptied old group on screen meanwhile. */
  fromTabs: readonly Tab[];
}

/**
 * The move playing now, if any. The bar keeps `from` on screen and shows neither group selected;
 * the floating tab (`ghostRef`) glides from `from`'s place to `to`'s.
 */
export function useGroupMoveAnimation<Tab extends { threadKey: string }>(
  barRef: RefObject<HTMLDivElement | null>,
  ghostRef: RefObject<HTMLElement | null>,
  currentKey: string,
  currentGroup: string | null,
  /** The groups in the bar's order; a tab may be in more than one. */
  groups: Readonly<Record<string, readonly Tab[]>>,
): GroupMove<Tab> | null {
  const [move, setMove] = useState<GroupMove<Tab> | null>(null);
  // Each render records which group held every tab, so a move starts from the tab's previous group
  // even when that group has just emptied.
  const previous = useRef<{ groupOf: Map<string, string>; groups: Readonly<Record<string, readonly Tab[]>> } | null>(
    null,
  );
  useLayoutEffect(() => {
    const groupOf = new Map<string, string>();
    // A tab in two groups counts as in the first, the one the bar selects for it.
    for (const [group, tabs] of Object.entries(groups)) {
      for (const tab of tabs) {
        const key = normalizeThreadKey(tab.threadKey);
        if (!groupOf.has(key)) groupOf.set(key, group);
      }
    }
    const before = previous.current;
    previous.current = { groupOf, groups };
    const fromGroup = before?.groupOf.get(currentKey);
    if (!before || !fromGroup || !currentGroup || fromGroup === currentGroup) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setMove({ from: fromGroup, to: currentGroup, fromTabs: before.groups[fromGroup] ?? [] });
  }, [currentGroup, currentKey, groups]);

  // The floating tab starts over the old group and lands on the new one; the move then ends.
  useLayoutEffect(() => {
    if (!move) return;
    const bar = barRef.current;
    const ghost = ghostRef.current;
    const chip = (group: string) => bar?.querySelector<HTMLElement>(`${CHIP_SELECTOR}[data-group="${group}"]`);
    const from = chip(move.from);
    const to = chip(move.to);
    const end = () => setMove((current) => (current === move ? null : current));
    if (!bar || !ghost || !from || !to || typeof ghost.animate !== "function") {
      end();
      return;
    }
    const origin = bar.getBoundingClientRect().left;
    const place = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return { left: `${rect.left - origin}px`, width: `${rect.width}px` };
    };
    const target = place(to);
    Object.assign(ghost.style, target);
    const animation = ghost.animate([place(from), target], {
      duration: GLIDE_MS,
      easing: "cubic-bezier(0.35, 0.1, 0.25, 1)",
    });
    animation.onfinish = end;
    // Ends the move even where the animation never finishes (a hidden tab, a test without one).
    const timer = setTimeout(end, GLIDE_MS + 100);
    return () => clearTimeout(timer);
  }, [barRef, ghostRef, move]);

  return move;
}
