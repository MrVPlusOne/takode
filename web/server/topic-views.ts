import { topicIdOfViewKey, topicViewKey } from "../shared/topic-thread-key.js";

/**
 * Which quests a topic conversation holds, and which topic conversation shows a quest: the
 * server's single answer, from the topic store, used to build topic windows and to decide which
 * views a message belongs to. Set at startup by the topic service; without it no topic views exist.
 */
export interface TopicViewSource {
  questsOf(topicId: string): readonly string[];
  topicOfQuest(questId: string): string | null;
}

let source: TopicViewSource | null = null;

export function setTopicViewSource(next: TopicViewSource | null): void {
  source = next;
}

/** The quests of a topic conversation's view key; null for other keys or an unknown topic. */
export function topicViewMembers(viewKey: string): string[] | null {
  const topicId = topicIdOfViewKey(viewKey);
  if (!topicId || !source) return null;
  return source.questsOf(topicId).map((questId) => questId.toLowerCase());
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
 * The views something routed to these threads belongs to: the threads themselves, the topic
 * conversations showing their quests, and the topic conversation it was sent from.
 */
export function viewKeysOfRoutes(routeKeys: Iterable<string>, sentFromView?: string): string[] {
  const keys = new Set([...routeKeys].map((key) => key.trim().toLowerCase()).filter(Boolean));
  for (const key of topicViewKeysOfQuests([...keys].filter((key) => /^q-\d+$/.test(key)))) keys.add(key);
  if (sentFromView) keys.add(sentFromView.trim().toLowerCase());
  return [...keys];
}
