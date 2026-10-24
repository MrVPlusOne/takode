/**
 * A topic conversation: the feed of several quest threads of one leader stitched into one, in
 * time order. Its thread key names the member quests itself (`topic:q-2838+q-2839`), so the
 * server builds its windows and the browser filters its live messages without asking which quests
 * a topic holds.
 */

const PREFIX = "topic:";

/** The thread key of a conversation over these quests (oldest quest first). */
export function topicThreadKey(questIds: readonly string[]): string {
  const ids = [...new Set(questIds.map((id) => id.toLowerCase()))].sort(
    (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
  );
  return `${PREFIX}${ids.join("+")}`;
}

/** The member quests of a topic conversation's thread key; null for any other key. */
export function topicThreadMembers(threadKey: string): string[] | null {
  const key = threadKey.trim().toLowerCase();
  if (!key.startsWith(PREFIX)) return null;
  const members = key
    .slice(PREFIX.length)
    .split("+")
    .filter((id) => /^q-\d+$/.test(id));
  return members.length ? members : null;
}
