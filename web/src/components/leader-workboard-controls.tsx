import type { ReactNode } from "react";
import type { LeaderWorkboardView } from "../store-types.js";
import type { BoardSummarySegment } from "./leader-board-summary.js";

export function SummarySegments({
  segments,
  separatorClassName = "text-cc-fg/40",
}: {
  segments: BoardSummarySegment[];
  separatorClassName?: string;
}) {
  return (
    <>
      {segments.map((seg, i, arr) => (
        <span key={i}>
          <span className={seg.className} style={seg.style}>
            {seg.text}
          </span>
          {i < arr.length - 1 && <span className={separatorClassName}>, </span>}
        </span>
      ))}
    </>
  );
}

export function LeaderWorkboardControlButton({
  view,
  activeView,
  onSelectView,
  children,
  testId,
  ariaLabel,
  title,
  hideUntilWide = false,
}: {
  view: LeaderWorkboardView;
  activeView: LeaderWorkboardView | null;
  onSelectView: (view: LeaderWorkboardView) => void;
  children: ReactNode;
  testId: string;
  ariaLabel: string;
  title?: string;
  hideUntilWide?: boolean;
}) {
  const selected = activeView === view;
  const displayClassName = hideUntilWide ? "hidden min-[1180px]:inline-flex" : "inline-flex";
  return (
    <button
      type="button"
      onClick={() => onSelectView(view)}
      className={`${displayClassName} h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${
        selected
          ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
          : "border-cc-border/70 bg-cc-hover/30 text-cc-muted hover:bg-cc-hover/60 hover:text-cc-fg"
      }`}
      data-testid={testId}
      aria-pressed={selected}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </button>
  );
}
