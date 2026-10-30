import { useEffect } from "react";
import { topicApi } from "../../api/topics.js";
import { useStore } from "../../store.js";
import { loadLeaderTopics, useKnownQuestTopic } from "../../utils/leader-topics.js";
import { topicViewKey } from "../../../shared/topic-thread-key.js";
import { navigateToSessionMessageId, navigateToSessionThread, sessionTopicViewHash } from "../../utils/routing.js";
import { TopicIcon } from "./library-icons.js";
import { handleOpenInSideClick, openConversationInSide } from "../../utils/side-column.js";
import type { QuestTopicMap } from "../../../shared/library-topics.js";

type QuestTopic = QuestTopicMap[string];

/**
 * The Library topic of a quest, as its leader's topic lookups know it, asking the server when they
 * don't yet; null for a quest under no topic, without a leader, or not known yet.
 */
export function useLeaderQuestTopic(leaderSessionId: string | null, questId: string): QuestTopic | null {
  const leaderId = leaderSessionId ?? "";
  const topic = useKnownQuestTopic(leaderId, questId);
  const unknown = !!leaderId && topic === undefined;
  useEffect(() => {
    if (!unknown) return;
    loadLeaderTopics(leaderId, [questId]).catch((error: Error) =>
      console.warn("[library] Could not look up a quest's topic:", error.message),
    );
  }, [leaderId, questId, unknown]);
  return leaderId ? (topic ?? null) : null;
}

/**
 * A quest's topic in the quest views (the previews and the quest view): its name, which opens the
 * topic's conversation in the quest's leader where this quest was last discussed.
 */
export function QuestTopicLink({
  questId,
  leaderSessionId,
  topic,
  onNavigate,
  className = "",
}: {
  questId: string;
  leaderSessionId: string;
  topic: QuestTopic;
  /** Called once the link is followed, so a preview or dialog can close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  const sessionNum = useStore(
    (state) => state.sdkSessions.find((session) => session.sessionId === leaderSessionId)?.sessionNum,
  );
  const routeSessionId = sessionNum ?? leaderSessionId;
  const label = `Topic ${topic.name}: open its conversation where ${questId} was last discussed`;
  return (
    <a
      href={sessionTopicViewHash(routeSessionId, topicViewKey(topic.id))}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const open = () => void openQuestInTopic(leaderSessionId, questId, topicViewKey(topic.id), routeSessionId);
        // The open-in-side click shows the topic's conversation beside its leader's conversation.
        const inSide = () => openConversationInSide(leaderSessionId, topicViewKey(topic.id));
        if (!handleOpenInSideClick(event, inSide, open)) open();
        onNavigate?.();
      }}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-cc-primary/40 bg-cc-primary/10 px-2 py-0.5 text-[11px] text-cc-primary transition-colors hover:bg-cc-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50 ${className}`}
      title={label}
      aria-label={label}
      data-testid="quest-topic-link"
    >
      <TopicIcon className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{topic.name}</span>
    </a>
  );
}

/**
 * Opens a quest's topic conversation (`topicKey`) at the place the quest was last discussed; at
 * the conversation's end when the server can't say where that was.
 */
export async function openQuestInTopic(
  leaderId: string,
  questId: string,
  topicKey: string,
  routeSessionId: string | number = leaderId,
): Promise<void> {
  const messageId = await topicApi.lastDiscussed(leaderId, questId).then(
    (response) => response.messageId,
    (error: Error) => {
      console.warn("[library] Could not find where a quest was last discussed:", error.message);
      return null;
    },
  );
  if (messageId) navigateToSessionMessageId(leaderId, messageId, { routeSessionId, threadKey: topicKey });
  else navigateToSessionThread(leaderId, topicKey, false, routeSessionId);
}
