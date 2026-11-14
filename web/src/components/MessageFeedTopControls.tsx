import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useStore } from "../store.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { CodexSubagentFeedControl } from "./CodexSubagentFeedControl.js";
import { LiveActivityRail, type CodexTerminalEntry, type LiveSubagentEntry } from "./MessageFeedLiveActivity.js";

/**
 * Controls floating at the top of the feed, in one row so they never overlap: live terminals and
 * subagents on the left, then the Codex subagent control and a quest thread's chips at the right.
 * The session's Next chip is at the feed's lower right on every screen size (FeedStatusPill).
 *
 * The feed's day pill sits centered at the top too. The live rail can span the whole row, and on
 * a phone the Codex subagent control leaves little room beside the pill, so then the pill takes
 * its own line under the row; otherwise it sits centered on the row.
 */
/** Space between the chips and the feed's first content. */
const TOP_ROOM_GAP_PX = 8;
/**
 * The room every feed keeps at its top, one row of chips (the row's offset, a chip and the gap), even
 * without chips: chips that come and go during a turn would otherwise move a short conversation down
 * and back each time (Jiayi, Nov 14: one extra line of overscroll).
 */
export const ONE_ROW_TOP_ROOM_PX = 44;

export function MessageFeedTopControls({
  sessionId,
  terminals,
  subagents,
  selectedToolUseId,
  onSelect,
  onSelectSubagent,
  onDismissSubagent,
  showCodexSubagents = true,
  dayPill,
  questChips,
  onTopRoomChange,
  belowPinnedStrip = false,
}: {
  sessionId: string;
  terminals: CodexTerminalEntry[];
  subagents: LiveSubagentEntry[];
  selectedToolUseId: string | null;
  onSelect: (toolUseId: string) => void;
  onSelectSubagent: (taskToolUseId: string, turnId: string) => void;
  onDismissSubagent: (taskToolUseId: string, freshnessToken: string) => void;
  showCodexSubagents?: boolean;
  /** The feed's day pill (`MessageFeedDayPill`), which renders nothing when it has no day to show. */
  dayPill?: ReactNode;
  /**
   * A leader's quest thread: its quest's phase, worker and waits, floating at the feed's top right
   * (Jiayi, Nov 1: the right edge covers less, and the phase chip ends the group there).
   */
  questChips?: ReactNode;
  /**
   * The room the feed keeps above its earliest content (px): one row of chips, or the chips' height
   * when they are taller, so scrolled to the top no chip covers the first line. 0 below a pinned
   * strip, where the controls start under the strip instead.
   */
  onTopRoomChange?: (px: number) => void;
  /**
   * In a topic conversation: start below the quest strip pinned at the feed's top (its height is
   * the overlay's `--feed-pinned-top`), also below the first strip where it sits at the top of the
   * feed before it pins, one feed padding and the strip's top margin lower. In any feed the controls also start below a
   * pinned report collapse bar (`--feed-pinned-bar`); see `useFeedPinnedTop`.
   */
  belowPinnedStrip?: boolean;
}) {
  const hasCodexSubagentData = useStore(
    (state) => (state.sessions.get(sessionId)?.codex_native_subagents?.children.length ?? 0) > 0,
  );
  const hasCodexSubagents = showCodexSubagents && hasCodexSubagentData;
  const hasLiveActivity = terminals.length > 0 || subagents.length > 0;
  const desktop = useDesktopShellLayout();
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const hasRow = hasCodexSubagents || hasLiveActivity || !!questChips;
  useLayoutEffect(() => {
    if (!onTopRoomChange) return;
    const overlay = overlayRef.current;
    const row = rowRef.current;
    if (belowPinnedStrip || !hasRow || !overlay || !row) {
      onTopRoomChange(belowPinnedStrip ? 0 : ONE_ROW_TOP_ROOM_PX);
      return;
    }
    // Measured without a pinned report bar the controls moved below: that is room while scrolling
    // through a report, not at the feed's top.
    const report = () => {
      const bar = Number.parseFloat(getComputedStyle(overlay).getPropertyValue("--feed-pinned-bar")) || 0;
      onTopRoomChange(Math.max(ONE_ROW_TOP_ROOM_PX, overlay.offsetTop - bar + row.offsetHeight + TOP_ROOM_GAP_PX));
    };
    report();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(report);
    observer.observe(row);
    return () => observer.disconnect();
  }, [belowPinnedStrip, hasRow, onTopRoomChange]);

  if (!hasRow && !dayPill) return null;
  // Desktop has room for the pill beside the Codex subagent control; a phone does not. Quest chips
  // can be as wide as the pill's place, so the pill goes under them.
  const pillOnOwnLine = !hasRow || hasLiveActivity || !!questChips || (hasCodexSubagents && !desktop);

  const row = hasRow && (
    <div ref={rowRef} className="flex min-w-0 items-start gap-2" data-testid="message-feed-top-controls">
      {hasLiveActivity && (
        <LiveActivityRail
          terminals={terminals}
          subagents={subagents}
          selectedToolUseId={selectedToolUseId}
          onSelect={onSelect}
          onSelectSubagent={onSelectSubagent}
          onDismissSubagent={onDismissSubagent}
        />
      )}
      {(hasCodexSubagents || questChips) && (
        <div className="ml-auto flex min-w-0 items-start justify-end gap-2">
          {hasCodexSubagents && (
            <div className="shrink-0">
              <CodexSubagentFeedControl sessionId={sessionId} />
            </div>
          )}
          {questChips}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 flex min-w-0 flex-col gap-1.5 sm:inset-x-3 ${
        belowPinnedStrip
          ? "top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+1.5rem)] sm:top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+2rem)]"
          : // Close under the strip above (Jiayi, Nov 1): a small gap, not a feed padding's worth.
            "top-[calc(var(--feed-pinned-bar,0px)+0.25rem)] sm:top-[calc(var(--feed-pinned-bar,0px)+0.375rem)]"
      }`}
      ref={overlayRef}
      data-testid="message-feed-top-overlay"
    >
      {row}
      {dayPill && (
        <div className={`flex justify-center ${pillOnOwnLine ? "" : "absolute inset-0 items-center"}`}>{dayPill}</div>
      )}
    </div>
  );
}
