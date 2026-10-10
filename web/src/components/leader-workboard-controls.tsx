import type { ReactNode } from "react";
import type { LeaderWorkboardView } from "../store-types.js";
import { describeBoardPhaseDots, type BoardPhaseDot, type BoardSummarySegment } from "./leader-board-summary.js";
import { getQuestPhaseAccentValue } from "../utils/quest-phase-theme.js";

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

const MAX_BOARD_DOTS = 5;
/** Past five dots, three dots plus "+N" fit the same square. */
const OVERFLOW_SHOWN_DOTS = 3;

/**
 * The Board button's icon: a small board (frame and header bar) holding one dot per
 * quest in a Journey phase, three per row, in that phase's Journey accent color. The
 * square never changes size, so the button keeps its width for any number of quests.
 */
export function WorkBoardDotsIcon({ dots, large }: { dots: readonly BoardPhaseDot[]; large: boolean }) {
  const overflow = dots.length > MAX_BOARD_DOTS ? dots.length - OVERFLOW_SHOWN_DOTS : 0;
  const shown = overflow > 0 ? dots.slice(0, OVERFLOW_SHOWN_DOTS) : dots;
  // Phones get a 31x28 px board with 6 px dots; the 28 px desktop button fits 26x22 px with 5 px dots.
  // The side padding keeps the outer dots off the frame so each color reads on its own.
  const dotSize = large ? "h-[6px] w-[6px]" : "h-[5px] w-[5px]";
  return (
    <span
      className={`inline-flex shrink-0 flex-col overflow-hidden rounded-[5px] border-[1.5px] border-current ${
        large ? "h-[28px] w-[31px]" : "h-[22px] w-[26px]"
      }`}
      aria-hidden="true"
      data-testid="workboard-dots-icon"
      data-dot-count={dots.length}
    >
      <span className="h-[3px] w-full shrink-0 bg-current opacity-80" />
      <span
        className={`grid flex-1 grid-cols-3 content-center justify-items-center ${
          large ? "gap-x-[2px] gap-y-[2px] px-[3px]" : "gap-x-[2px] gap-y-[1.5px] px-[2px]"
        }`}
      >
        {shown.map((dot) => (
          <span
            key={dot.questId}
            className={`${dotSize} rounded-full`}
            // A thin dark ring in light theme only (see --color-cc-board-dot-ring) keeps pale accents
            // such as Landing's teal visible against the light button.
            style={{
              backgroundColor: getQuestPhaseAccentValue(dot.phase.color),
              boxShadow: "0 0 0 0.5px var(--color-cc-board-dot-ring)",
            }}
            data-testid="workboard-dot"
            data-phase={dot.phase.id}
          />
        ))}
        {overflow > 0 && (
          <span
            className={`col-span-3 font-semibold leading-none text-cc-fg tabular-nums ${large ? "text-[9px]" : "text-[8px]"}`}
            data-testid="workboard-dots-overflow"
          >{`+${overflow}`}</span>
        )}
      </span>
    </span>
  );
}

/**
 * The leader's way into the work board from any thread: a top-bar button next to Next.
 * It shows the board's quests in a Journey phase as colored dots, never as a count or a
 * notification-style badge: it is information, not something unread. The count and the
 * phase breakdown live in the tooltip and the accessible label. The width never changes:
 * phones show the 36 px square board, desktop adds the "Board" label.
 */
export function LeaderWorkboardTopBarButton({
  open,
  dots,
  compact,
  onToggle,
}: {
  open: boolean;
  dots: readonly BoardPhaseDot[];
  compact: boolean;
  onToggle: () => void;
}) {
  const label = `${open ? "Close" : "Open"} work board: ${describeBoardPhaseDots(dots)}`;
  const tone = open
    ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
    : "border-cc-border bg-cc-hover/40 text-cc-fg hover:bg-cc-hover";
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${
        compact ? "h-9 w-9" : "h-7 gap-1.5 px-1.5 pr-2 text-[12px] font-medium"
      } ${tone}`}
      data-testid="topbar-workboard-button"
      aria-pressed={open}
      aria-label={label}
      title={label}
    >
      <WorkBoardDotsIcon dots={dots} large={compact} />
      {!compact && <span>Board</span>}
    </button>
  );
}
