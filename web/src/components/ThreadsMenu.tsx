import { useEffect, useRef, useState } from "react";
import type { ThreadSummary } from "../../shared/library-topics.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { NewThreadIcon } from "./library/library-icons.js";
import { matchesSearch, TopicSearchBox } from "./library/topic-search.js";

/** A leader's threads (New thread) for its Threads menu, and how to start or open one. */
export interface ThreadsMenu {
  threads: readonly ThreadSummary[];
  onStart: () => void;
  onOpen: (threadKey: string) => void;
  /** How many unread answers a thread has. */
  unread: (threadKey: string) => number;
  /** How many of the leader's questions to the user are open in a thread. */
  questions?: (threadKey: string) => number;
  /** Whether the New thread page is on screen. */
  starting: boolean;
  /** Removes a thread whose first message never arrived. */
  onRemove?: (threadKey: string) => void;
}

/** How long a new thread may wait for its first message before it counts as never sent. */
const UNSENT_AFTER_MS = 30_000;

/** A thread whose first message never arrived: its send failed, so it holds nothing. */
export function isUnsent(thread: ThreadSummary, now = Date.now()): boolean {
  return !!thread.empty && now - thread.createdAt > UNSENT_AFTER_MS;
}

/**
 * Read threads are never dropped from Recent, so a leader can gather hundreds: they are drawn a
 * page at a time, the next page when the end of the list scrolls into view.
 */
const RECENT_PAGE = 20;

/**
 * Whether a thread is active: it isn't settled (reading its last answer settles it, and writing in
 * it again unsettles it), it has unread answers or an open question, or the leader is writing there.
 */
export function isThreadActive(
  thread: ThreadSummary,
  unread: number,
  writingKey: string | null,
  questions = 0,
): boolean {
  return !thread.settledAt || unread > 0 || questions > 0 || thread.key === writingKey;
}

/**
 * The Threads menu: start a new thread, then the active threads, then every thread read, newest
 * first, filed under a topic or not, with a search box for the older ones.
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
  const questionsIn = (threadKey: string) => menu.questions?.(threadKey) ?? 0;
  const active = menu.threads.filter((thread) =>
    isThreadActive(thread, menu.unread(thread.key), writingKey, questionsIn(thread.key)),
  );
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(RECENT_PAGE);
  // The search narrows both lists, by a thread's name and the topic it is filed under.
  const matches = (thread: ThreadSummary) => matchesSearch(`${thread.name} ${thread.topic?.name ?? ""}`, query);
  const read = menu.threads.filter((thread) => !active.includes(thread));
  const activeShown = active.filter(matches);
  const matching = read.filter(matches);
  const recent = matching.slice(0, shown);
  const showMore = () => setShown((count) => count + RECENT_PAGE);
  const row = (thread: ThreadSummary, quiet: boolean) => {
    const unread = menu.unread(thread.key);
    const questions = questionsIn(thread.key);
    const meta = [thread.topic ? `in ${thread.topic.name}` : null, timeAgo(thread.activityAt)]
      .filter(Boolean)
      .join(" · ");
    const notSent = isUnsent(thread);
    const main = (
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
          <span className="mt-0.5 truncate text-[11.5px] text-cc-muted">
            {notSent ? (
              <span className="text-cc-error" data-testid="threads-menu-row-unsent">
                Not sent{meta ? ` · ${meta}` : ""}
              </span>
            ) : (
              meta
            )}
          </span>
        </span>
        {questions > 0 && (
          // The leader asked something here: amber, like a question anywhere else.
          <span
            className="shrink-0 rounded-full bg-[var(--color-cc-phase-accent-amber)]/15 px-1.5 text-[11px] tabular-nums text-[var(--color-cc-phase-accent-amber)]"
            data-testid="threads-menu-row-questions"
          >
            {questions === 1 ? "question" : `${questions} questions`}
          </span>
        )}
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-cc-info/15 px-1.5 text-[11px] tabular-nums text-cc-info">
            {unread} new
          </span>
        )}
      </button>
    );
    if (!notSent || !menu.onRemove) return main;
    // Its first message never arrived, so nothing is lost by removing it.
    return (
      <div key={thread.id} className="flex items-center">
        <div className="min-w-0 flex-1">{main}</div>
        <button
          type="button"
          onClick={() => menu.onRemove?.(thread.key)}
          className="mr-3 shrink-0 rounded px-2 py-1 text-[12px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          title="Remove this thread: its first message was never sent"
          data-testid="threads-menu-remove"
        >
          Remove
        </button>
      </div>
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
      {activeShown.length > 0 && heading("Active", activeShown.length)}
      {activeShown.map((thread) => row(thread, false))}
      {read.length > 0 && (
        <div className="sticky top-0 z-10 flex items-center gap-2 bg-cc-card/95 px-4 pb-1 pt-2.5 backdrop-blur">
          <span className="shrink-0 text-[11px] uppercase tracking-wide text-cc-muted">Recent</span>
          <span className="shrink-0 text-[11px] tabular-nums text-cc-muted">{read.length}</span>
          <TopicSearchBox
            query={query}
            label="Search threads"
            onChange={(next) => {
              setQuery(next);
              setShown(RECENT_PAGE);
            }}
          />
        </div>
      )}
      {recent.map((thread) => row(thread, true))}
      {query.trim() && matching.length === 0 && activeShown.length === 0 && (
        <div className="px-4 py-3 text-[12px] text-cc-muted" data-testid="threads-search-empty">
          No threads match "{query.trim()}".
        </div>
      )}
      {matching.length > recent.length && <ShowMoreRow left={matching.length - recent.length} onShow={showMore} />}
      {menu.threads.length === 0 && <div className="px-4 py-3 text-[12px] text-cc-muted">No threads yet</div>}
    </div>
  );
}

/** The end of a long Recent list: shows the next page when scrolled into view, or when tapped. */
function ShowMoreRow({ left, onShow }: { left: number; onShow: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const showRef = useRef(onShow);
  showRef.current = onShow;
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    // The list scrolls inside its menu; the observer still sees the row clipped until it's in view.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) showRef.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [left]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onShow}
      className="w-full px-4 py-2.5 text-left text-[12px] text-cc-muted hover:bg-cc-hover/40 hover:text-cc-fg"
      data-testid="threads-menu-more"
    >
      {left} more
    </button>
  );
}
