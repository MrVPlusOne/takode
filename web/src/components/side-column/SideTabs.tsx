import { BellIcon } from "../AttentionKind.js";
import { THREAD_GROUP_DOT } from "../ThreadTabGroups.js";
import type { SideTab } from "../../utils/side-column.js";

const TAB_LABELS: Record<SideTab, string> = { chats: "Chats", quests: "Quests", pages: "Pages", topic: "Topic" };

/** What waits in the side chats, for the Chats tab while another tab is on screen. */
export interface ChatsCue {
  /** Open questions for the user in the chats. */
  questions: number;
  /** Unread answers in the chats. */
  unread: number;
  /** Whether a chat's leader is writing in it. */
  running: boolean;
  /** Bumped when a question arrives, to ring the bell once (`useAttentionCue`). */
  questionCue?: number;
  /** Bumped when an answer arrives, to pop the count once. */
  unreadCue?: number;
}

/**
 * The side column's tabs, as equal cells: Chats, Quests and Pages while they hold something, each
 * with how many, then Topic. While another tab is on screen, the Chats tab shows what waits in the
 * chats by their rows' rule (Jiayi, Nov 14): the amber bell for a question and "N new" for unread
 * answers, else a green dot while a chat's leader is writing; on the Chats tab its rows show this.
 */
export function SideTabs({
  tabs,
  active,
  onSelect,
  counts,
  chats,
}: {
  tabs: readonly SideTab[];
  active: SideTab;
  onSelect: (tab: SideTab) => void;
  /** How many items each tab of things put in the column holds. */
  counts: Partial<Record<SideTab, number>>;
  chats: ChatsCue;
}) {
  return (
    <div className="shrink-0 border-b border-cc-border/80 px-2 py-1" data-testid="side-tabs">
      <div
        role="tablist"
        aria-label="Side column"
        className="grid rounded-lg border border-cc-border p-0.5"
        style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={tab === active}
            onClick={() => onSelect(tab)}
            className={`inline-flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] ${
              tab === active ? "bg-cc-hover text-cc-fg [.dark_&]:bg-white/10" : "text-cc-muted hover:text-cc-fg"
            }`}
            data-testid="side-tab"
            data-tab={tab}
          >
            <span className="truncate">{TAB_LABELS[tab]}</span>
            {counts[tab] !== undefined && <span className="shrink-0 tabular-nums text-cc-muted">{counts[tab]}</span>}
            {tab === "chats" && active !== "chats" && <ChatsTabCue {...chats} />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChatsTabCue({ questions, unread, running, questionCue = 0, unreadCue = 0 }: ChatsCue) {
  if (questions === 0 && unread === 0) {
    if (!running) return null;
    return (
      <span
        className={`h-1.5 w-1.5 shrink-0 rounded-full ${THREAD_GROUP_DOT["in-progress"]}`}
        title="A leader is writing in a side chat"
        data-testid="side-tab-running"
      />
    );
  }
  return (
    <>
      {questions > 0 && (
        <span
          key={`bell:${questionCue}`}
          className="cc-cue-bell inline-flex shrink-0 text-cc-attention"
          data-cue={questionCue > 0 ? "" : undefined}
          title={questions === 1 ? "A question for you" : `${questions} questions for you`}
          data-testid="side-tab-questions"
        >
          <BellIcon className="h-3.5 w-3.5" />
        </span>
      )}
      {unread > 0 && (
        <span
          key={`unread:${unreadCue}`}
          className="cc-cue-pill shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info"
          data-cue={unreadCue > 0 ? "" : undefined}
          data-testid="side-tab-unread"
        >
          {unread} new
        </span>
      )}
    </>
  );
}
