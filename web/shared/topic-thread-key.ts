/**
 * A topic conversation: the threads of a topic's quests read as one conversation (a quest tab
 * zoomed out to its topic). Its view key names the topic (`topic:<topic id>`), not its quests, so
 * it stays the same while quests join or leave the topic. Which quests a topic holds is the
 * server's to say: it builds the view's windows and decides which messages belong to it, and sends
 * the browser that membership with each window and message.
 */

const PREFIX = "topic:";

/** The view key of a topic's conversation. */
export function topicViewKey(topicId: string): string {
  return `${PREFIX}${topicId.trim().toLowerCase()}`;
}

/** The topic a view key names; null for any other view key. */
export function topicIdOfViewKey(viewKey: string): string | null {
  const key = viewKey.trim().toLowerCase();
  if (!key.startsWith(PREFIX)) return null;
  const id = key.slice(PREFIX.length);
  return /^[\w-]+$/.test(id) ? id : null;
}

/** Whether a view key is a topic conversation's. */
export function isTopicViewKey(viewKey: string): boolean {
  return topicIdOfViewKey(viewKey) !== null;
}
