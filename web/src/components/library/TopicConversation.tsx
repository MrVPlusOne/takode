import { createContext, useContext, useEffect, useMemo } from "react";
import { useStore } from "../../store.js";
import { useKnownTopicBrief, useKnownTopicOfKey } from "../../utils/leader-topics.js";
import { isTopicViewKey, topicIdOfViewKey } from "../../../shared/topic-thread-key.js";
import type { TopicThreadRef } from "../../../shared/library-topics.js";
import { sendToSession } from "../../ws.js";
import { TopicIcon } from "./library-icons.js";
import { useQuestTopic } from "./TopicSidePanel.js";

type TopicConversationInfo = {
  topicId: string;
  name: string;
  questIds: string[];
  /** Threads filed under the topic, shown in its conversation each under its own name. */
  threads?: TopicThreadRef[];
};

/**
 * The topic of a leader's quest tab, with its quests, for reading the topic as one conversation
 * (the quest zoomed out); null on Main or for a quest under no topic yet.
 */
export function useTopicConversation(leaderId: string, threadKey: string): TopicConversationInfo | null {
  const topic = useQuestTopic(leaderId, threadKey);
  // Comes with the tab's topic lookup, so no second request delays the line.
  const brief = useKnownTopicBrief(leaderId, topic?.id);
  if (!topic || !brief || brief.questIds.length === 0) return null;
  return {
    topicId: topic.id,
    name: brief.name,
    questIds: brief.questIds,
    ...(brief.threads ? { threads: brief.threads } : {}),
  };
}

/**
 * A topic's conversation selected on its own (`topic:<handle>` as the leader's thread), when no
 * quest tab of the topic is known to open it in. Threads the user started are not topics: see
 * `ThreadHeader`.
 */
export function useStandaloneTopicConversation(leaderId: string, threadKey: string): TopicConversationInfo | null {
  const isTopic = isTopicViewKey(threadKey);
  const topic = useKnownTopicOfKey(leaderId, isTopic ? threadKey : "");
  // One object per change, so the conversation built from it isn't rebuilt on every render.
  return useMemo(() => {
    if (!isTopic) return null;
    if (!topic) return { topicId: topicIdOfViewKey(threadKey)!, name: "Topic", questIds: [] };
    return {
      topicId: topic.id,
      name: topic.name,
      questIds: topic.questIds,
      ...(topic.threads ? { threads: topic.threads } : {}),
    };
  }, [isTopic, threadKey, topic]);
}

/**
 * Keeps an open topic conversation in step with its quests. Its view key names the topic, so a
 * quest joining or leaving changes no key; when the quests known for the topic change and differ
 * from those its latest window was built with, the window is asked for again. A reader paging
 * through older messages keeps their place; the view catches up when they return to the latest.
 */
export function useTopicWindowFollowsQuests(sessionId: string, viewKey: string | null, questIds: readonly string[]) {
  const questsKey = questIds
    .map((id) => id.toLowerCase())
    .sort()
    .join(",");
  useEffect(() => {
    if (!viewKey) return;
    const window = useStore.getState().threadWindows.get(sessionId)?.get(viewKey);
    if (!window?.topic_members || window.has_newer_items) return;
    if ([...window.topic_members].sort().join(",") === questsKey) return;
    sendToSession(sessionId, {
      type: "thread_window_request",
      thread_key: viewKey,
      from_item: -1,
      item_count: window.item_count,
      section_item_count: window.section_item_count,
      visible_item_count: window.visible_item_count,
      activate_view: true,
    });
  }, [sessionId, viewKey, questsKey]);
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

function ChevronRight({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
