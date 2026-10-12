import type { ReactNode } from "react";

const CHIP_SHAPE_CLASS =
  "inline-flex h-6 min-w-0 max-w-full items-center gap-1 rounded-full border bg-cc-hover/60 px-2 text-[11px]";

/** Shared look of the quest view's static chips (tags, owner, a single related quest). */
export const QUEST_CHIP_CLASS = `${CHIP_SHAPE_CLASS} border-cc-border text-cc-muted`;

/** A chip in the quest view's chip row that expands a list (commits, related quests) below the row. */
export function QuestDisclosureChip({
  expanded,
  controls,
  onToggle,
  ariaLabel,
  children,
}: {
  expanded: boolean;
  /** ID of the list this chip shows and hides. */
  controls: string;
  onToggle: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${CHIP_SHAPE_CLASS} cursor-pointer transition-colors hover:border-cc-primary/30 hover:text-cc-primary ${
        expanded ? "border-cc-primary/30 text-cc-fg" : "border-cc-border text-cc-muted"
      }`}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-label={ariaLabel}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`h-3 w-3 shrink-0 opacity-70 transition-transform ${expanded ? "rotate-90" : ""}`}
        aria-hidden="true"
      >
        <path d="M6 4l4 4-4 4" />
      </svg>
      <span className="truncate">{children}</span>
    </button>
  );
}
