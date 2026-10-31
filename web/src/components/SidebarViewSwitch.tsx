import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { ContextMenu, useMenuButton } from "./ContextMenu.js";

export type SidebarViewMode = "spaces" | "recent" | "topics";

const LABELS = { spaces: "Spaces", recent: "Recent", topics: "Topics" } as const;
const TITLES = {
  spaces: "Group sessions by Session Space",
  recent: "List sessions by recent interaction",
  topics: "List the topics of your leaders, then the leaders and other sessions",
} as const;
const MODES = ["spaces", "recent", "topics"] as const;

/**
 * The sessions panel's Spaces / Recent / Topics switch. Where the panel is wide enough it is a
 * segmented control; where it isn't (`compact`), a dropdown naming the current view, so the New
 * button beside it is never pushed off the edge (Jiayi, Oct 31: New is the panel's most important
 * button).
 */
export function SidebarViewSwitch({
  mode,
  compact,
  onSwitch,
}: {
  mode: SidebarViewMode;
  compact: boolean;
  onSwitch: (mode: SidebarViewMode) => void;
}) {
  const { menu, toggle, close } = useMenuButton();
  if (compact) {
    return (
      <>
        <button
          type="button"
          onClick={toggle}
          aria-label="Sidebar view"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          title={TITLES[mode]}
          className="shrink-0 mr-auto inline-flex h-7 items-center gap-1 rounded-md border border-cc-border/70 px-2 text-[10px] text-cc-fg hover:bg-cc-hover cursor-pointer"
          data-testid="sidebar-view-dropdown"
        >
          {LABELS[mode]}
          <svg
            viewBox="0 0 16 16"
            className="h-3 w-3 text-cc-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>
        {menu && (
          <ContextMenu
            {...menu}
            onClose={close}
            items={MODES.map((option) => ({
              label: option === mode ? `${LABELS[option]} ✓` : LABELS[option],
              onClick: () => onSwitch(option),
            }))}
          />
        )}
      </>
    );
  }
  return (
    <div
      role="group"
      aria-label="Sidebar view"
      className="shrink-0 mr-auto inline-flex items-center rounded-md border border-cc-border/70 p-px"
    >
      {MODES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onSwitch(option)}
          aria-pressed={mode === option}
          title={TITLES[option]}
          className={`h-6 px-2 rounded-[5px] text-[10px] transition-colors cursor-pointer ${
            mode === option ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:text-cc-fg"
          }`}
        >
          {LABELS[option]}
        </button>
      ))}
    </div>
  );
}

/**
 * Whether the row's contents no longer fit with the switch at full size. The switch must be the row's
 * first child. Each check works from the sizes of what the row holds now (the counts and buttons
 * beside the switch change), with the full switch's width as last seen, so a moment of overflow
 * (such as before fonts load) never leaves it compact.
 */
export function useCompactWhenCrowded(rowRef: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);
  const fullSwitchWidth = useRef(0);
  const observer = useRef<ResizeObserver | null>(null);
  const check = useRef(() => {});
  check.current = () => {
    const row = rowRef.current;
    const switchElement = row?.firstElementChild as HTMLElement | null | undefined;
    if (!row || !switchElement) return;
    if (!compact) {
      fullSwitchWidth.current = switchElement.offsetWidth;
      if (row.scrollWidth > row.clientWidth) setCompact(true);
      return;
    }
    // The row spreads spare room around its items, so add up what they need instead.
    const style = getComputedStyle(row);
    const children = [...row.children] as HTMLElement[];
    const neededAtFullSize =
      parseFloat(style.paddingLeft) +
      parseFloat(style.paddingRight) +
      (parseFloat(style.columnGap) || 0) * (children.length - 1) +
      fullSwitchWidth.current +
      children.slice(1).reduce((total, child) => total + child.offsetWidth, 0);
    if (neededAtFullSize <= row.clientWidth) setCompact(false);
  };
  // After every render: what the row holds changes without the row resizing.
  useLayoutEffect(() => {
    check.current();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    observer.current ??= new ResizeObserver(() => check.current());
    observer.current.observe(row);
    for (const child of row.children) observer.current.observe(child);
  });
  useLayoutEffect(() => () => observer.current?.disconnect(), []);
  return compact;
}
