import type { ThreadSummary } from "../../shared/library-topics.js";
import { NewThreadIcon } from "./library/library-icons.js";
import { useThreadNews } from "./home/HomeExtras.js";
import { InlineThreadUpdate } from "./ThreadUpdate.js";

/**
 * Moves what the main view shows into the side column; with `keepHere` (a Shift-click) it opens
 * there too and stays in the main view, so one chat can be read at two places at once.
 */
export type MoveToSide = (keepHere: boolean) => void;

/**
 * Moves the thread on screen into the side column, the mirror of a side pane's button that brings
 * its thread into the main view. Shown on desktop only, where the side column sits beside it.
 */
export function MoveToSideButton({ onMove }: { onMove: MoveToSide }) {
  return (
    <button
      type="button"
      onClick={(event) => onMove(event.shiftKey)}
      className="-my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg focus-visible:outline focus-visible:outline-cc-primary"
      aria-label="Move to the side column"
      title="Move to the side column (Shift-click to keep it here too)"
      data-testid="thread-move-to-side"
    >
      <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
        <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
        <path d="M10 3v10" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.5 8h3.5M6.5 6.25 8.25 8 6.5 9.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * The strip over a thread that is not a quest's (one the user started, or the leader opened): its
 * name, and on desktop the way to move it to the side column. Threads don't close; Home, in the
 * status row, is the way back. As tall as a quest's strip.
 */
export function ThreadStrip({ thread, onMoveToSide }: { thread: ThreadSummary; onMoveToSide?: MoveToSide }) {
  const news = useThreadNews(thread.leaderId, thread.key);
  return (
    <div
      className="relative flex min-h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-0.5 text-xs sm:px-3"
      data-testid="thread-strip"
    >
      <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate text-[13px] font-medium text-cc-fg" title={thread.name}>
        {thread.name}
      </span>
      <span className="flex min-w-0 flex-1 text-[13px]">
        <InlineThreadUpdate text={news} />
      </span>
      {onMoveToSide && <MoveToSideButton onMove={onMoveToSide} />}
    </div>
  );
}
