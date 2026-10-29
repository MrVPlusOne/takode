import { useCallback, useMemo, useState } from "react";
import { topicApi } from "../api/topics.js";
import { useStore } from "../store.js";
import { rememberThreads, useKnownThreadOfKey, useKnownTopicOfKey } from "../utils/leader-topics.js";
import type { ThreadSummary } from "../../shared/library-topics.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { navigateToSessionThread } from "../utils/routing.js";
import { topicViewKey } from "../../shared/topic-thread-key.js";

/**
 * A leader's New thread page: a fresh conversation with the leader, started on purpose instead of
 * under whatever Main or the thread on screen last held. Sending its first message starts the
 * thread (a lightweight conversation, listed in the Threads menu) and opens it; the leader answers
 * there.
 */
export function NewThreadHeader({
  leaderId,
  startedFrom,
  onClearStartedFrom,
  onClose,
}: {
  leaderId: string;
  /** The quest or topic thread it starts from (shown so the user sees what the leader will be told). */
  startedFrom: string | null;
  onClearStartedFrom: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="flex min-h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-0.5 text-xs sm:px-3"
      data-testid="new-thread-header"
    >
      <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="shrink-0 text-[13px] font-medium text-cc-fg">New thread</span>
      {startedFrom && (
        <span className="inline-flex min-w-0 items-center gap-0.5 text-cc-muted" data-testid="new-thread-started-from">
          <span className="truncate">
            · from <ThreadOriginName leaderId={leaderId} threadKey={startedFrom} />
          </span>
          <button
            type="button"
            onClick={onClearStartedFrom}
            className="-my-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded hover:bg-cc-hover hover:text-cc-fg"
            aria-label={`Don't link it to ${startedFrom}`}
            title={`Start it on its own, not from ${startedFrom}`}
          >
            <SmallX />
          </button>
        </span>
      )}
      <button
        type="button"
        onClick={onClose}
        className="-my-1 ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label="Cancel the new thread"
        title="Cancel"
        data-testid="new-thread-close"
      >
        <SmallX className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * A thread's header: its name, where it was started from, and the topic it is filed under once it
 * is (tapping that opens the topic's conversation, where the thread is one part). Nothing to close:
 * a thread settles once you have read its last answer.
 */
export function ThreadHeader({
  leaderId,
  thread,
  onOpenThread,
}: {
  leaderId: string;
  thread: ThreadSummary;
  onOpenThread: (threadKey: string) => void;
}) {
  return (
    <div
      className="flex min-h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-0.5 text-xs sm:px-3"
      data-testid="thread-header"
    >
      {thread.topic && (
        <button
          type="button"
          onClick={() => onOpenThread(topicViewKey(thread.topic!.id))}
          className="-mx-1 inline-flex min-w-0 max-w-[16rem] shrink-[4] items-center gap-1 rounded px-1 py-0.5 text-[12px] text-cc-fg hover:bg-cc-hover"
          title="Open the topic this thread is filed under"
          data-testid="thread-header-topic"
        >
          <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
          <span className="min-w-0 truncate">{thread.topic.name}</span>
          <span className="shrink-0 text-cc-muted">›</span>
        </button>
      )}
      <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate text-[13px] font-medium text-cc-fg">{thread.name}</span>
      {thread.startedFrom && (
        <button
          type="button"
          onClick={() => onOpenThread(thread.startedFrom!)}
          className="min-w-0 shrink truncate text-cc-muted hover:text-cc-fg hover:underline"
          title="Open the thread this one was started from"
        >
          · from <ThreadOriginName leaderId={leaderId} threadKey={thread.startedFrom} />
        </button>
      )}
    </div>
  );
}

/** The empty page above the composer, until the first message starts the thread. */
export function NewThreadBody({ leaderId, startedFrom }: { leaderId: string; startedFrom: string | null }) {
  // Passages taken along with Ask in new thread: what the thread is about.
  const passages = useStore((state) => state.composerDrafts.get(leaderId)?.annotations);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center px-6" data-testid="new-thread-body">
      <div className="max-w-sm text-center">
        <NewThreadIcon className="mx-auto mb-3 h-8 w-8 text-cc-muted/70" />
        <p className="text-sm text-cc-fg">A new thread with the leader</p>
        <p className="mt-1 text-[13px] leading-relaxed text-cc-muted">
          {startedFrom ? (
            <>
              It starts from <ThreadOriginName leaderId={leaderId} threadKey={startedFrom} />, which stays as it is.{" "}
            </>
          ) : (
            "Main and the other threads stay as they are. "
          )}
          You'll find it under Threads.
        </p>
        {passages?.map((passage) => (
          <blockquote
            key={passage.id}
            className="mt-4 line-clamp-4 border-l-2 border-cc-primary/60 pl-3 text-left text-[13px] leading-relaxed text-cc-muted"
            data-testid="new-thread-passage"
          >
            {passage.selectedText}
          </blockquote>
        ))}
      </div>
    </div>
  );
}

/**
 * The composer's way to start the thread: names it after the message's first words (the leader
 * renames it once the subject is clear), starts it and opens it once the message is sent.
 */
export function useNewThreadStart(sessionId: string, startedFrom: string | null) {
  const start = useCallback(
    async (text: string) => {
      const { thread } = await topicApi.startThread(
        sessionId,
        threadNameFromMessage(text),
        startedFrom ?? undefined,
        text.slice(0, 400),
      );
      rememberThreads(sessionId, [thread], false);
      return thread.key;
    },
    [sessionId, startedFrom],
  );
  const started = useCallback((threadKey: string) => navigateToSessionThread(sessionId, threadKey, true), [sessionId]);
  return useMemo(() => ({ start, started }), [start, started]);
}

/** The origin a New thread page starts from, which the user may clear. */
export function useNewThreadOrigin(threadOnScreen: string): [string | null, () => void] {
  const [cleared, setCleared] = useState<string | null>(null);
  const key = threadOnScreen.toLowerCase();
  const fromThread = /^q-\d+$/.test(key) || key.startsWith("topic:") ? key : null;
  return [fromThread && cleared !== fromThread ? fromThread : null, () => setCleared(fromThread)];
}

/** A provisional name: the message's first words, until the leader names the thread. */
export function threadNameFromMessage(text: string): string {
  const line =
    text
      .split("\n")
      .map((part) =>
        part
          .replace(/[#>*_`[\]]/g, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .find(Boolean) ?? "";
  if (!line) return "New thread";
  const words = line.split(" ");
  let name = "";
  for (const word of words) {
    if ((name + " " + word).trim().length > 48) break;
    name = (name + " " + word).trim();
  }
  if (!name) name = line.slice(0, 48);
  return name.length < line.length ? `${name}…` : name;
}

/** A thread by its name: a quest's title, a topic's name (its key until known). */
export function ThreadOriginName({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const isQuest = /^q-\d+$/i.test(threadKey);
  const quest = useQuestRecord(isQuest ? threadKey : null);
  const topic = useKnownTopicOfKey(leaderId, isQuest ? "" : threadKey);
  const thread = useKnownThreadOfKey(leaderId, isQuest ? "" : threadKey);
  return <>{(isQuest ? quest?.title : (thread?.name ?? topic?.name)) ?? threadKey}</>;
}

function SmallX({ className = "h-3 w-3" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}
