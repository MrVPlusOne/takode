import { useEffect } from "react";
import { useStore } from "../../store.js";
import { loadLeaderTopics, useKnownQuestTopic } from "../../utils/leader-topics.js";
import { navigateToSessionThread, sessionThreadHash } from "../../utils/routing.js";
import { TopicIcon } from "./library-icons.js";
import { openInSide } from "../../utils/side-column.js";
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
 * quest's thread in its leader with the topic's page beside it. Topics are tags for browsing.
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
  const label = `Topic ${topic.name}: open its page beside ${questId}`;
  return (
    <a
      href={sessionThreadHash(routeSessionId, questId)}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        navigateToSessionThread(leaderSessionId, questId, false, routeSessionId);
        openInSide({ kind: "topic", topicId: topic.id, leaderId: leaderSessionId });
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
