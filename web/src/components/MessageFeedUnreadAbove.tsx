import type { UnreadAbove } from "../hooks/use-unread-messages-seen.js";

/**
 * Says how many unread answers and reports wait above the view, as Slack does when a conversation
 * opens at its latest messages; a tap jumps to the first one. The pill at the bottom of the feed
 * ("New content below") is its counterpart.
 */
export function MessageFeedUnreadAbove({ unread, onJump }: { unread: UnreadAbove; onJump: () => void }) {
  const label = `${unread.count} unread`;
  return (
    <button
      type="button"
      data-testid="message-feed-unread-above"
      onClick={onJump}
      className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-cc-primary/30 bg-cc-card/95 px-3 py-1 text-xs font-medium text-cc-fg shadow-md backdrop-blur-sm transition-colors hover:bg-cc-hover cursor-pointer"
      aria-label={`Jump to the first of ${label}`}
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0 text-cc-primary" fill="none" aria-hidden="true">
        <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      {label}
    </button>
  );
}
