import { createContext, useContext } from "react";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { openTopicInPanel } from "../../utils/topic-panel.js";
import { TopicIcon } from "./library-icons.js";
import { useQuestTopic } from "./TopicSidePanel.js";

type TopicConversationInfo = { topicId: string; name: string; questIds: string[] };

/**
 * The topic of a leader's quest tab, with its quests, for reading the topic as one conversation
 * (the quest zoomed out); null on Main or for a quest under no topic yet.
 */
export function useTopicConversation(leaderId: string, threadKey: string): TopicConversationInfo | null {
  const topic = useQuestTopic(leaderId, threadKey);
  // Comes with the tab's topic lookup, so no second request delays the line.
  const brief = useKnownTopicBrief(leaderId, topic?.id);
  if (!topic || !brief || brief.questIds.length === 0) return null;
  return { topicId: topic.id, name: brief.name, questIds: brief.questIds };
}

/**
 * Above a quest tab's strip: the quest's topic, as the way to zoom out. A quest tab is the quest
 * zoomed in from its topic, so this line leads back out to the whole topic, at this quest's place;
 * the topic conversation's header then takes its place.
 */
export function TopicEntryLine({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/50 bg-cc-bg/95 px-2.5 py-1 text-left text-xs hover:bg-cc-hover/40 sm:px-3"
      aria-label={`Zoom out to the topic ${name}`}
      title="Zoom out to the whole topic, at this quest's place"
      data-testid="topic-entry-line"
    >
      <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-cc-muted" />
      <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate text-[13px] text-cc-fg">{name}</span>
      <span className="shrink-0 text-cc-muted">· {questCount(count)}</span>
    </button>
  );
}

/**
 * The top of a topic conversation (a quest tab zoomed out), in place of the quest strip: the
 * topic's name, which opens its page, and its number of quests. Each quest's own strip is in the
 * feed where its part starts; tapping one zooms into that quest, and back zooms in again.
 */
export function TopicConversationHeader({
  leaderId,
  topic,
}: {
  leaderId: string;
  topic: { topicId: string; name: string; questIds: string[] };
}) {
  return (
    <div
      className="flex shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1.5 text-xs sm:px-3"
      data-testid="topic-conversation-header"
    >
      <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <button
        type="button"
        onClick={() => openTopicInPanel(leaderId, topic.topicId)}
        className="min-w-0 truncate text-[13px] font-medium text-cc-fg hover:underline"
        title="Show the topic page"
      >
        {topic.name}
      </button>
      <span className="shrink-0 text-cc-muted">· {questCount(topic.questIds.length)}</span>
    </div>
  );
}

function questCount(count: number): string {
  return `${count} quest${count === 1 ? "" : "s"}`;
}

/** The topic a quest's own feed opens with: its name and a way to zoom out to all of it. */
export const TopicEntryContext = createContext<{ name: string; count: number; onOpen: () => void } | null>(null);

/** At the start of a quest's own conversation, above its description: "Part of <topic>". */
export function TopicFeedEntry() {
  const topic = useContext(TopicEntryContext);
  if (!topic) return null;
  return (
    <button
      type="button"
      onClick={topic.onOpen}
      className="ml-9 mb-2 flex max-w-full items-center gap-1 text-left text-[12px] text-cc-muted hover:text-cc-fg"
      title="Zoom out to the whole topic"
      data-testid="topic-feed-entry"
    >
      <TopicIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">Part of </span>
      <span className="min-w-0 truncate text-cc-primary">{topic.name}</span>
      <span className="shrink-0"> · view the whole topic</span>
      <ChevronRight className="h-3 w-3 shrink-0" />
    </button>
  );
}

function ChevronLeft({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M10 3.5L5.5 8l4.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRight({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
