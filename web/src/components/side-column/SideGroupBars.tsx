import type { ReactNode } from "react";
import { BellIcon } from "../AttentionKind.js";
import { THREAD_GROUP_DOT, type ThreadGroupId } from "../ThreadTabGroups.js";

/**
 * Folds and unfolds the side column's chats, from the column's top row, beside Collapse. It always
 * reads the same ("Chats", how many, the chevron), so nothing on the row moves when it folds (Jiayi,
 * Nov 6: the old one grew a summary when folded and pushed the buttons beside it aside). Folded,
 * the chats show as `FoldedChatsBar` under the row.
 */
export function ChatsGroupToggle({
  folded,
  onToggle,
  chats,
}: {
  folded: boolean;
  onToggle: () => void;
  /** Chats in the group: conversations, new threads, other sessions. */
  chats: number;
}) {
  const label = folded ? "Show the side chats" : "Fold the side chats";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!folded}
      aria-label={`${label} (${chats} ${chats === 1 ? "chat" : "chats"})`}
      title={label}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      data-testid="side-chats-toggle"
    >
      <span>Chats</span>
      <span className="tabular-nums" data-testid="side-chats-count">
        {chats}
      </span>
      <Chevron folded={folded} />
    </button>
  );
}

/**
 * The side column's chats while folded: one bar with the amber bell for a question and the count of
 * unread answers (the same cues as the chats' own rows), then each chat (`FoldedChatButton`) by its
 * status dot and name, the ones asking and with news first. It says what the folded chats hold
 * without opening them (Jiayi, Nov 6: a count alone was too easy to miss). A click on a chat opens
 * it; a click elsewhere on the bar opens the chats as they were.
 */
export function FoldedChatsBar({
  questions,
  unread,
  onOpen,
  questionCue = 0,
  unreadCue = 0,
  children,
}: {
  /** Open questions for the user in the chats. */
  questions: number;
  /** Unread answers in the chats. */
  unread: number;
  /** Opens the chats as they were. */
  onOpen: () => void;
  /** Bumped when a question arrives, to ring the bell once (`useAttentionCue`). */
  questionCue?: number;
  /** Bumped when an answer arrives, to pop the count once. */
  unreadCue?: number;
  /** The chats, as `FoldedChatButton`s. */
  children: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpen();
      }}
      title="Show the side chats"
      className="flex h-9 w-full cursor-pointer items-center gap-2 overflow-hidden border-b border-cc-border/70 bg-cc-card/60 px-2.5 text-[13px] hover:bg-cc-hover/50"
      data-testid="side-chats-folded"
    >
      <Chevron folded />
      {questions > 0 && (
        <span
          key={`bell:${questionCue}`}
          className="cc-cue-bell inline-flex shrink-0 text-cc-attention"
          data-cue={questionCue > 0 ? "" : undefined}
          title={questions === 1 ? "A question for you" : `${questions} questions for you`}
          data-testid="side-chats-questions"
        >
          <BellIcon className="h-3.5 w-3.5" />
        </span>
      )}
      {unread > 0 && (
        <span
          key={`unread:${unreadCue}`}
          className="cc-cue-pill shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info"
          data-cue={unreadCue > 0 ? "" : undefined}
          data-testid="side-chats-unread"
        >
          {unread} new
        </span>
      )}
      {children}
    </div>
  );
}

/**
 * A chat in `FoldedChatsBar`: its status dot and name, which opens it. The first gives way last;
 * the others, short of room, shrink to their dots, still named on hover.
 */
export function FoldedChatButton({
  name,
  group,
  first,
  onOpen,
}: {
  name: string;
  /** Its status group, by the rows' rule: its dot's color. */
  group: ThreadGroupId;
  first: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      title={name}
      className={`flex min-w-4 max-w-[18rem] items-center gap-1.5 rounded px-1 text-cc-fg/85 hover:bg-cc-hover hover:text-cc-fg ${
        first ? "shrink-[0.25]" : "shrink"
      }`}
      data-testid="side-chats-folded-chat"
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${THREAD_GROUP_DOT[group]}`} aria-hidden="true" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}

/**
 * The header of a group of pages in the side column (quest pages, other pages): a quiet bar that
 * folds the group. Folded, it lists what the group holds by name, so it can be found without
 * opening it.
 */
export function PageGroupBar({
  label,
  count,
  folded,
  onToggle,
  names,
}: {
  label: string;
  count: number;
  folded: boolean;
  onToggle: () => void;
  /** What the group holds, by name, listed while folded. */
  names: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!folded}
      title={folded ? `Show the ${label.toLowerCase()}` : `Fold the ${label.toLowerCase()}`}
      className="flex h-8 w-full items-center gap-1.5 border-b border-cc-border/70 bg-cc-card/60 px-2.5 text-left text-[12px] text-cc-muted hover:text-cc-fg"
      data-testid="side-group-bar"
      data-group-label={label}
    >
      <Chevron folded={folded} />
      <span className="shrink-0 text-cc-fg/90">{label}</span>
      <span className="shrink-0 tabular-nums">{count}</span>
      {folded && (
        <span className="min-w-0 truncate" data-testid="side-group-names">
          {names}
        </span>
      )}
    </button>
  );
}

function Chevron({ folded }: { folded: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${folded ? "-rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
