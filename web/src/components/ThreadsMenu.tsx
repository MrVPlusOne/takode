import type { ThreadSummary } from "../../shared/library-topics.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { NewThreadIcon } from "./library/library-icons.js";

/** A leader's threads (New thread) for its Threads menu, and how to start or open one. */
export interface ThreadsMenu {
  threads: readonly ThreadSummary[];
  onStart: () => void;
  onOpen: (threadKey: string) => void;
  /** How many unread answers a thread has. */
  unread: (threadKey: string) => number;
  /** Whether the New thread page is on screen. */
  starting: boolean;
}

/** Recent settled threads shown before search takes over. */
const RECENT_SHOWN = 10;

/**
 * Whether a thread is active: it isn't settled (reading its last answer settles it, and writing in
 * it again unsettles it), it has unread answers, or the leader is writing there.
 */
export function isThreadActive(thread: ThreadSummary, unread: number, writingKey: string | null): boolean {
  return !thread.settledAt || unread > 0 || thread.key === writingKey;
}

/**
 * The Threads menu: start a new thread, then the active threads, then recent settled ones that
 * aren't filed under a topic. A settled thread under a topic lives in that topic.
 */
export function ThreadsList({
  menu,
  currentKey,
  writingKey,
}: {
  menu: ThreadsMenu;
  currentKey: string;
  writingKey: string | null;
}) {
  const active = menu.threads.filter((thread) => isThreadActive(thread, menu.unread(thread.key), writingKey));
  const recent = menu.threads.filter((thread) => !active.includes(thread) && !thread.topic).slice(0, RECENT_SHOWN);
  const row = (thread: ThreadSummary, quiet: boolean) => {
    const unread = menu.unread(thread.key);
    const meta = [thread.topic ? `in ${thread.topic.name}` : null, timeAgo(thread.activityAt)]
      .filter(Boolean)
      .join(" · ");
    return (
      <button
        key={thread.id}
        type="button"
        onClick={() => menu.onOpen(thread.key)}
        className={`flex min-h-[3.25rem] w-full items-center gap-3 px-4 py-1.5 text-left ${thread.key === currentKey ? "bg-cc-active" : "hover:bg-cc-hover/40"}`}
        data-testid="threads-menu-row"
        data-thread-key={thread.key}
      >
        <NewThreadIcon className={`h-4 w-4 shrink-0 ${quiet ? "text-cc-muted/70" : "text-cc-primary"}`} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`flex min-w-0 items-center gap-1.5 text-[14px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
            {thread.key === writingKey && (
              <span
                className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-cc-info border-t-transparent motion-reduce:animate-none"
                aria-label="The leader is writing here"
              />
            )}
            <span className="truncate">{thread.name}</span>
          </span>
          <span className="mt-0.5 truncate text-[11.5px] text-cc-muted">{meta}</span>
        </span>
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info">
            {unread} new
          </span>
        )}
      </button>
    );
  };
  const heading = (label: string, count: number) => (
    <div className="px-4 pb-1 pt-2.5 text-[11px] uppercase tracking-wide text-cc-muted">
      {label} <span className="tabular-nums">{count}</span>
    </div>
  );
  return (
    <div data-testid="threads-menu">
      <button
        type="button"
        onClick={menu.onStart}
        className={`flex w-full items-center gap-2.5 border-b border-cc-border/60 px-4 py-2.5 text-left text-[13px] text-cc-fg ${menu.starting ? "bg-cc-active" : "hover:bg-cc-hover"}`}
        data-testid="threads-menu-new"
      >
        <NewThreadIcon className="h-4 w-4 shrink-0 text-cc-primary" />
        <span>New thread</span>
      </button>
      {active.length > 0 && heading("Active", active.length)}
      {active.map((thread) => row(thread, false))}
      {recent.length > 0 && heading("Recent", recent.length)}
      {recent.map((thread) => row(thread, true))}
      {active.length === 0 && recent.length === 0 && (
        <div className="px-4 py-3 text-[12px] text-cc-muted">
          {menu.threads.length ? "Threads you've read are in their topics" : "No threads yet"}
        </div>
      )}
    </div>
  );
}
