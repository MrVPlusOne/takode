import type { ThreadSummary } from "../../shared/library-topics.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";

/**
 * The topic a thread is filed under, before its title on the thread's strip as a breadcrumb reads
 * (topic › title): a quiet tag that opens the topic's page beside the conversation. It truncates
 * before the title does. Topics are for browsing; the conversation stays put.
 */
export function TopicTag({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="inline-flex min-w-[2.25rem] max-w-[12rem] shrink-[6] items-center gap-1 rounded px-1 py-0.5 text-[12px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg max-sm:max-w-[7rem]"
      title={`Topic: ${name}. Open its page beside the conversation`}
      data-testid="thread-topic-tag"
    >
      <TopicIcon className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
    </button>
  );
}

/**
 * The strip over a thread that is not a quest's (one the user started, or the leader opened): its
 * name, its topic tag once the Scribe files it, and the way back to the leader's Home. As tall as a
 * quest's strip.
 */
export function ThreadStrip({
  thread,
  topic,
  onOpenTopic,
  onLeave,
}: {
  thread: ThreadSummary;
  topic: { id: string; name: string } | null;
  onOpenTopic: () => void;
  onLeave: () => void;
}) {
  return (
    <div
      className="relative flex min-h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-0.5 text-xs sm:px-3"
      data-testid="thread-strip"
    >
      {topic && (
        <>
          <TopicTag name={topic.name} onOpen={onOpenTopic} />
          <span className="shrink-0 text-cc-muted/70" aria-hidden="true">
            ›
          </span>
        </>
      )}
      <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate text-[13px] font-medium text-cc-fg" title={thread.name}>
        {thread.name}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        // 32 px to tap easily on a phone; the negative margin keeps the strip's height.
        className="-my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label="Back to Home"
        title="Back to Home"
        onClick={onLeave}
        data-testid="thread-strip-leave"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
