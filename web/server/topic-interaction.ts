import {
  leaderMessageThreadKey,
  leaderResponseAssociatedThreadKeys,
} from "../shared/leader-thread-response-routing.js";
import { isCanonicalLeaderUserMessageId } from "../shared/leader-user-message-id.js";
import type { TopicSummary } from "../shared/library-topics.js";
import { topicViewKey } from "../shared/topic-thread-key.js";
import type { QuestmasterTask } from "./quest-types.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";

/**
 * When the user and each of a leader's threads last dealt with each other, the rule the sessions
 * panel's Recent view uses for a leader (`sessionInteractionAt` in the browser), applied per thread:
 * the user's own message there, or the leader asking for the user there (an answer to the user, or a
 * question). Commentary, herd events and system messages don't count.
 */
export function threadInteractionTimes(
  history: ReadonlyArray<BrowserIncomingMessage>,
  from = 0,
  into = new Map<string, number>(),
): Map<string, number> {
  const record = (threadKey: string, timestamp: unknown) => {
    const at = typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
    if (at > (into.get(threadKey) ?? 0)) into.set(threadKey, at);
  };
  for (let index = from; index < history.length; index += 1) {
    const message = history[index]!;
    if (!isRootAgentHistoryMessage(message)) continue;
    if (isActualHumanUserMessage(message)) {
      record(leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]), message.timestamp);
      continue;
    }
    if (message.type !== "assistant") continue;
    if (message.threadAnswer?.answerUserMessageIds.some(isCanonicalLeaderUserMessageId)) {
      for (const threadKey of leaderResponseAssociatedThreadKeys(message)) record(threadKey, message.timestamp);
    } else if (message.notification?.category === "needs-input") {
      record(leaderMessageThreadKey(message as Parameters<typeof leaderMessageThreadKey>[0]), message.timestamp);
    }
  }
  return into;
}

/**
 * A topic's interaction time in one leader: its own thread's and its quests' (`threadTimes`), a
 * quest finishing there (a result to review), and the topic's creation, as a new session counts.
 */
export function topicInteractionAt(
  topic: Pick<TopicSummary, "id" | "createdAt" | "questIds">,
  threadTimes: ReadonlyMap<string, number>,
  quests: ReadonlyMap<string, QuestmasterTask>,
): number {
  let at = Math.max(topic.createdAt, threadTimes.get(topicViewKey(topic.id)) ?? 0);
  for (const questId of topic.questIds) {
    at = Math.max(at, threadTimes.get(questId) ?? 0);
    const quest = quests.get(questId);
    if (quest?.status === "done") at = Math.max(at, (quest as { statusChangedAt?: number }).statusChangedAt ?? 0);
  }
  return at;
}
