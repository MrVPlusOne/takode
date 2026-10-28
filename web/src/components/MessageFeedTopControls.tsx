import type { ReactNode } from "react";
import { useStore } from "../store.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { CodexSubagentFeedControl } from "./CodexSubagentFeedControl.js";
import { LiveActivityRail, type CodexTerminalEntry, type LiveSubagentEntry } from "./MessageFeedLiveActivity.js";
import { NotificationChip } from "./NotificationChip.js";

/**
 * Controls floating at the top of the feed, in one row so they never overlap: live terminals and
 * subagents on the left, then the Codex subagent control and, on desktop, the session's attention
 * chip at the right. Desktop keeps the chip up here near the top bar's attention controls to cut
 * mouse travel, except in a leader's chat, where it sits right after the thread tabs so it never
 * covers text; phones keep it at the bottom right (FeedStatusPill), within thumb reach.
 *
 * The feed's day pill sits centered at the top too. The live rail can span the whole row, and on
 * a phone the Codex subagent control leaves little room beside the pill, so then the pill takes
 * its own line under the row; otherwise it sits centered on the row, level with the attention chip.
 */
export function MessageFeedTopControls({
  sessionId,
  currentThreadKey,
  onSelectThread,
  terminals,
  subagents,
  selectedToolUseId,
  onSelect,
  onSelectSubagent,
  onDismissSubagent,
  showCodexSubagents = true,
  showAttentionChip: attentionChipAllowed = true,
  dayPill,
  belowPinnedStrip = false,
}: {
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  terminals: CodexTerminalEntry[];
  subagents: LiveSubagentEntry[];
  selectedToolUseId: string | null;
  onSelect: (toolUseId: string) => void;
  onSelectSubagent: (taskToolUseId: string, turnId: string) => void;
  onDismissSubagent: (taskToolUseId: string, freshnessToken: string) => void;
  showCodexSubagents?: boolean;
  /** False when a leader's tab row shows the attention chip instead. */
  showAttentionChip?: boolean;
  /** The feed's day pill (`MessageFeedDayPill`), which renders nothing when it has no day to show. */
  dayPill?: ReactNode;
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
  const showAttentionChip = useDesktopShellLayout() && attentionChipAllowed;

  const hasRow = hasCodexSubagents || hasLiveActivity || showAttentionChip;
  if (!hasRow && !dayPill) return null;
  const pillOnOwnLine = !hasRow || hasLiveActivity || (hasCodexSubagents && !showAttentionChip);

  const row = hasRow && (
    <div className="flex min-w-0 items-start gap-2" data-testid="message-feed-top-controls">
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
      {(hasCodexSubagents || showAttentionChip) && (
        <div className="ml-auto flex shrink-0 items-start gap-2">
          {hasCodexSubagents && <CodexSubagentFeedControl sessionId={sessionId} />}
          {showAttentionChip && (
            <NotificationChip
              sessionId={sessionId}
              currentThreadKey={currentThreadKey}
              onSelectThread={onSelectThread}
              placement="top"
            />
          )}
        </div>
      )}
    </div>
  );

  return (
    <div
      className={`pointer-events-none absolute inset-x-2 z-20 flex min-w-0 flex-col gap-1.5 sm:inset-x-3 ${
        belowPinnedStrip
          ? "top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+1.5rem)] sm:top-[calc(var(--feed-pinned-top)+var(--feed-pinned-bar,0px)+2rem)]"
          : "top-[calc(var(--feed-pinned-bar,0px)+0.5rem)] sm:top-[calc(var(--feed-pinned-bar,0px)+0.75rem)]"
      }`}
      data-testid="message-feed-top-overlay"
    >
      {row}
      {dayPill && (
        <div className={`flex justify-center ${pillOnOwnLine ? "" : "absolute inset-0 items-center"}`}>{dayPill}</div>
      )}
    </div>
  );
}
