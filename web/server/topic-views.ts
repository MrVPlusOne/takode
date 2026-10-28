import { topicIdOfViewKey, topicViewKey } from "../shared/topic-thread-key.js";

/**
 * Which quests a topic conversation holds, and which topic conversation shows a quest: the
 * server's single answer, from the topic store, used to build topic windows and to decide which
 * views a message belongs to. Set at startup by the topic service; without it no topic views exist.
 */
export interface TopicViewSource {
  /** The live topic a thread handle names (following merges), or null. */
  topicOf(handle: string): { id: string; name: string } | null;
  questsOf(topicId: string): readonly string[];
  /** The handles whose threads a topic's conversation shows: its own and those merged into it. */
  handlesOf(topicId: string): readonly string[];
  topicOfQuest(questId: string): string | null;
}

let source: TopicViewSource | null = null;

export function setTopicViewSource(next: TopicViewSource | null): void {
  source = next;
}

/**
 * The threads a topic conversation shows besides its own: its quests, and the threads of topics
 * merged into it. Null for other keys or an unknown topic.
 */
export function topicViewMembers(viewKey: string): string[] | null {
  const handle = topicIdOfViewKey(viewKey);
  const topic = handle && source ? source.topicOf(handle) : null;
  if (!topic || !source) return null;
  const own = topicViewKey(topic.id);
  const merged = source
    .handlesOf(topic.id)
    .map((other) => topicViewKey(other))
    .filter((key) => key !== own);
  return [...merged, ...source.questsOf(topic.id).map((questId) => questId.toLowerCase())];
}

/** The conversation showing a topic thread: its topic's own, or that of the topic it was merged into. */
export function liveTopicKey(threadKey: string): string | null {
  const handle = topicIdOfViewKey(threadKey);
  const topic = handle && source ? source.topicOf(handle) : null;
  return topic ? topicViewKey(topic.id) : null;
}

/**
 * How a topic thread is introduced to the leader with a message written there: the topic's name
 * and its quests (newest first, at most `limit`), so it can answer in the topic's thread or hand
 * the message off to one of its quests. Null when the key is not a known topic.
 */
export function topicOfViewForLeader(
  threadKey: string | undefined,
  limit = 12,
): { name: string; questIds: string[]; more: number } | null {
  const handle = threadKey ? topicIdOfViewKey(threadKey) : null;
  const topic = handle && source ? source.topicOf(handle) : null;
  if (!topic || !source) return null;
  const quests = [...source.questsOf(topic.id)].sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)));
  return { name: topic.name, questIds: quests.slice(0, limit), more: Math.max(0, quests.length - limit) };
}

/** The topic conversation views showing any of these quests. */
export function topicViewKeysOfQuests(questIds: Iterable<string>): string[] {
  if (!source) return [];
  const keys = new Set<string>();
  for (const questId of questIds) {
    const topicId = source.topicOfQuest(questId);
    if (topicId) keys.add(topicViewKey(topicId));
  }
  return [...keys];
}

/**
 * The views something routed to these threads belongs to: the threads themselves (a topic's thread
 * is its conversation, or that of the topic it was merged into) and the topic conversations
 * showing their quests.
 */
export function viewKeysOfRoutes(routeKeys: Iterable<string>): string[] {
  const keys = new Set([...routeKeys].map((key) => key.trim().toLowerCase()).filter(Boolean));
  for (const key of [...keys]) {
    const live = liveTopicKey(key);
    if (live) keys.add(live);
  }
  for (const key of topicViewKeysOfQuests([...keys].filter((key) => /^q-\d+$/.test(key)))) keys.add(key);
  return [...keys];
}
