import type { ReactNode } from "react";
import { useCrumbSlotRef } from "./crumb-slot.js";
import type { ThreadSummary } from "../../../shared/library-topics.js";
import { topicViewKey } from "../../../shared/topic-thread-key.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { ItemCrumb } from "./ItemCrumb.js";
import { CrumbSeparator } from "./PlaceCrumb.js";

/**
 * The start of a strip's breadcrumb: the place picker (Main, All or a topic), which the thread bar
 * draws here, then a separator when more parts follow.
 */
export function CrumbStart({ sessionId, separator = true }: { sessionId: string; separator?: boolean }) {
  const ref = useCrumbSlotRef(sessionId);
  return (
    <>
      <span ref={ref} className="contents" data-testid="crumb-start" />
      {separator && <CrumbSeparator />}
    </>
  );
}

/**
 * A strip that is only a breadcrumb (a topic's conversation, a thread): the place picker, then
 * what is on screen inside it, as tall as the quest strip.
 */
export function CrumbStrip({ sessionId, children }: { sessionId: string; children?: ReactNode }) {
  return (
    <div
      className="relative flex min-h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-0.5 text-xs sm:px-3"
      data-testid="crumb-strip"
    >
      <CrumbStart sessionId={sessionId} separator={!!children} />
      {children}
    </div>
  );
}

/** A thread (one the user started) on screen: its name, a picker of its topic's quests once filed. */
export function ThreadCrumb({
  leaderId,
  thread,
  onOpen,
}: {
  leaderId: string;
  thread: ThreadSummary;
  onOpen: (threadKey: string) => void;
}) {
  const name = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate">{thread.name}</span>
    </span>
  );
  if (!thread.topic) return <span className="min-w-0 text-[13px] font-medium text-cc-fg">{name}</span>;
  return (
    <ItemCrumb
      leaderId={leaderId}
      topicId={thread.topic.id}
      current={{ kind: "thread", threadKey: thread.key }}
      label={name}
      onOpenTopic={() => onOpen(topicViewKey(thread.topic!.id))}
      onOpenQuest={onOpen}
      onOpenThread={onOpen}
    />
  );
}
