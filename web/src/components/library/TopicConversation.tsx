import { useEffect, useState } from "react";
import { topicApi } from "../../api/topics.js";
import { openTopicInPanel } from "../../utils/topic-panel.js";
import { TopicIcon } from "./library-icons.js";
import { useQuestTopic } from "./TopicSidePanel.js";

/**
 * The topic of a leader's quest tab, with its quests, for reading the topic as one conversation;
 * null on Main, for a quest under no topic, or when the topic holds only this quest.
 */
export function useTopicConversation(
  leaderId: string,
  threadKey: string,
): { topicId: string; name: string; questIds: string[] } | null {
  const topic = useQuestTopic(leaderId, threadKey);
  const [found, setFound] = useState<{ topicId: string; name: string; questIds: string[] } | null>(null);
  useEffect(() => {
    if (!topic) return;
    let cancelled = false;
    topicApi
      .get(topic.id)
      .then((detail) => !cancelled && setFound({ topicId: topic.id, name: detail.name, questIds: detail.questIds }))
      .catch((error: Error) => console.warn("[library] Could not load the tab's topic:", error.message));
    return () => {
      cancelled = true;
    };
  }, [topic]);
  if (!topic || found?.topicId !== topic.id || found.questIds.length < 2) return null;
  return found;
}

/** In a quest tab's strip: opens the quest's whole topic as one conversation. */
export function TopicConversationButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Read the whole topic as one conversation"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-cc-border px-1.5 py-0.5 text-[12px] text-cc-muted hover:text-cc-fg"
      data-testid="topic-conversation-toggle"
    >
      <TopicIcon className="h-3.5 w-3.5" />
      Whole topic · {count}
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
