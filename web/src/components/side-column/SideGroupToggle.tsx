import { BellIcon } from "../AttentionKind.js";

/**
 * Folds and unfolds the side column's group (everything put in the column, above the topic page).
 * Folded, it says what the group holds and what waits in it: the amber bell for a question in one
 * of its chats, the blue count of unread answers (the same cues as the chats' own rows), and how
 * many chats (and other pages) it holds. Open, the rows show those, so it is only the chevron.
 */
export function SideGroupToggleButton({
  folded,
  onToggle,
  questions,
  unread,
  chats,
  pages,
  questionCue = 0,
  unreadCue = 0,
}: {
  folded: boolean;
  onToggle: () => void;
  /** Open questions for the user in the group's chats. */
  questions: number;
  /** Unread answers in the group's chats. */
  unread: number;
  /** Chats in the group: conversations, new threads, other sessions. */
  chats: number;
  /** Everything else in the group: topic pages, artifacts, quest details, Homes. */
  pages: number;
  /** Bumped when a question arrives, to ring the bell once (`useAttentionCue`). */
  questionCue?: number;
  /** Bumped when an answer arrives, to pop the count once. */
  unreadCue?: number;
}) {
  const holds = [
    ...(chats ? [`${chats} ${chats === 1 ? "chat" : "chats"}`] : []),
    ...(pages ? [`${pages} ${pages === 1 ? "page" : "pages"}`] : []),
  ].join(" · ");
  const label = folded ? `Show the chats (${holds})` : "Fold the chats, so the topic page takes the column";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!folded}
      aria-label={label}
      title={label}
      className="inline-flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-[12px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      data-testid="side-group-toggle"
    >
      {folded && questions > 0 && (
        <span
          key={`bell:${questionCue}`}
          className="cc-cue-bell inline-flex shrink-0 text-cc-attention"
          data-cue={questionCue > 0 ? "" : undefined}
          data-testid="side-group-questions"
        >
          <BellIcon className="h-3.5 w-3.5" />
        </span>
      )}
      {folded && unread > 0 && (
        <span
          key={`unread:${unreadCue}`}
          className="cc-cue-pill shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info"
          data-cue={unreadCue > 0 ? "" : undefined}
          data-testid="side-group-unread"
        >
          {unread} new
        </span>
      )}
      {folded && (
        <span className="truncate tabular-nums" data-testid="side-group-count">
          {holds}
        </span>
      )}
      <svg
        viewBox="0 0 16 16"
        fill="none"
        className={`h-3.5 w-3.5 shrink-0 transition-transform ${folded ? "" : "rotate-180"}`}
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
