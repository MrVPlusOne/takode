import type { ReactNode } from "react";
import type { LeaderWorkboardView } from "../store-types.js";
import type { BoardSummarySegment } from "./leader-board-summary.js";

/** Kanban board: a frame holding two card columns of different heights, the familiar board glyph, legible at phone size. */
export function WorkBoardIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      className={`${className} shrink-0`}
      aria-hidden="true"
      data-testid="workboard-icon"
    >
      <rect x="1.75" y="1.75" width="16.5" height="16.5" rx="2.75" stroke="currentColor" strokeWidth="1.5" />
      <rect x="4.75" y="4.75" width="4.25" height="10.5" rx="1.1" fill="currentColor" />
      <rect x="11" y="4.75" width="4.25" height="6.25" rx="1.1" fill="currentColor" />
    </svg>
  );
}

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
}: {
  view: LeaderWorkboardView;
  activeView: LeaderWorkboardView | null;
  onSelectView: (view: LeaderWorkboardView) => void;
  children: ReactNode;
  testId: string;
  ariaLabel: string;
  title?: string;
}) {
  const selected = activeView === view;
  return (
    <button
      type="button"
      onClick={() => onSelectView(view)}
      className={`inline-flex h-6 min-w-0 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${
        selected
          ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
          : "border-cc-border bg-cc-hover/40 text-cc-fg hover:bg-cc-hover"
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

/**
 * The leader's way into the work board from any thread: a top-bar button next to Next.
 * Phones get an icon button sized like Diffs with the active count as a corner badge;
 * desktop adds the "Board" label, and wide desktops also show the phase summary.
 */
export function LeaderWorkboardTopBarButton({
  open,
  activeCount,
  summarySegments,
  compact,
  onToggle,
}: {
  open: boolean;
  activeCount: number;
  summarySegments: BoardSummarySegment[];
  compact: boolean;
  onToggle: () => void;
}) {
  const label = open ? "Close work board" : `Open work board${activeCount > 0 ? ` (${activeCount} active)` : ""}`;
  const tone = open
    ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
    : "border-cc-border bg-cc-hover/40 text-cc-fg hover:bg-cc-hover";
  if (compact) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className={`relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors ${tone}`}
        data-testid="topbar-workboard-button"
        aria-pressed={open}
        aria-label={label}
        title={label}
      >
        <WorkBoardIcon className="h-5 w-5" />
        {activeCount > 0 && (
          <span
            className="absolute -right-1 -top-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-cc-info px-1 text-[9px] font-semibold leading-none text-cc-card tabular-nums"
            data-testid="topbar-workboard-count"
          >
            {activeCount}
          </span>
        )}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex h-7 min-w-0 max-w-[24rem] shrink items-center gap-1.5 rounded-lg border px-2 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${tone}`}
      data-testid="topbar-workboard-button"
      aria-pressed={open}
      aria-label={label}
      title={label}
    >
      <WorkBoardIcon />
      <span>Board</span>
      {activeCount > 0 && (
        <span
          className="rounded-sm bg-cc-hover px-1 font-mono-code text-[10px] leading-4 text-cc-fg tabular-nums"
          data-testid="topbar-workboard-count"
        >
          {activeCount}
        </span>
      )}
      {summarySegments.length > 0 && (
        <span
          className="hidden min-w-0 truncate font-normal min-[1180px]:inline"
          data-testid="topbar-workboard-phase-summary"
        >
          <SummarySegments segments={summarySegments} />
        </span>
      )}
    </button>
  );
}
