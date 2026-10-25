import { createContext, useContext } from "react";
import { useKnownTopicBrief } from "../../utils/leader-topics.js";
import { openTopicInPanel } from "../../utils/topic-panel.js";
import { TopicIcon } from "./library-icons.js";
import { useQuestTopic } from "./TopicSidePanel.js";

type TopicConversationInfo = { topicId: string; name: string; questIds: string[] };

/**
 * The topic of a leader's quest tab, with its quests, for reading the topic as one conversation;
 * null on Main, for a quest under no topic, or when the topic holds only this quest.
 */
export function useTopicConversation(leaderId: string, threadKey: string): TopicConversationInfo | null {
  const topic = useQuestTopic(leaderId, threadKey);
  // Comes with the tab's topic lookup, so no second request delays the line.
  const brief = useKnownTopicBrief(leaderId, topic?.id);
  if (!topic || !brief || brief.questIds.length < 2) return null;
  return { topicId: topic.id, name: brief.name, questIds: brief.questIds };
}

/**
 * Above a quest tab's strip: the quest's topic, named. Tapping it reads the topic's quests as one
 * conversation, whose header then takes this line's place.
 */
export function TopicEntryLine({ name, count, onOpen }: { name: string; count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/50 bg-cc-bg/95 px-2.5 py-1 text-left text-xs hover:bg-cc-hover/40 sm:px-3"
      title="Read the topic's quests as one conversation"
      data-testid="topic-entry-line"
    >
      <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
      <span className="min-w-0 truncate text-[13px] text-cc-fg">{name}</span>
      <span className="shrink-0 text-cc-muted">· {count} quests</span>
      <span className="flex-1" />
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cc-muted" />
    </button>
  );
}

/**
 * The top of a topic conversation, in place of the quest strip: the topic's name and its number of
 * quests; × goes back to the quest alone. Each quest's own strip is in the feed where it starts.
 */
export function TopicConversationHeader({
  leaderId,
  topic,
  onClose,
}: {
  leaderId: string;
  topic: { topicId: string; name: string; questIds: string[] };
  onClose: () => void;
}) {
  return (
    <div
      className="flex shrink-0 min-w-0 items-center gap-1.5 border-b border-cc-border/80 bg-cc-bg/95 px-2.5 py-1 text-xs sm:px-3"
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
      <span className="shrink-0 text-cc-muted">· {topic.questIds.length} quests</span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onClose}
        className="-my-1 -mr-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
        aria-label="Back to this quest alone"
        title="Back to this quest alone"
        data-testid="topic-conversation-close"
      >
        ✕
      </button>
    </div>
  );
}

/** The topic a quest's own feed opens with: its name and a way to read all of it. */
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
      title="Read the topic's quests as one conversation"
      data-testid="topic-feed-entry"
    >
      <TopicIcon className="h-3.5 w-3.5 shrink-0" />
      <span className="shrink-0">Part of </span>
      <span className="min-w-0 truncate text-cc-primary">{topic.name}</span>
      <span className="shrink-0"> · read all {topic.count} quests</span>
      <ChevronRight className="h-3 w-3 shrink-0" />
    </button>
  );
}

function ChevronRight({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
