/**
 * A topic's thread: the messages written in a topic's conversation, and the key of that
 * conversation, which shows the topic's own thread together with the threads of its quests. The
 * key names the topic by its short handle (`topic:<first 8 hex digits of the topic id>`), not by
 * its quests, so it stays the same while quests join or leave, and it is short enough for leaders
 * to write in thread markers (`[thread:topic:8df94bcb:A:u12]`). Topic IDs are created so that
 * handles are unique. Which quests a topic holds is the server's to say: it builds the view's
 * windows and decides which messages belong to it, and sends the browser that membership with
 * each window and message.
 */

const PREFIX = "topic:";
/**
 * A thread's short address as written: `t-17`. Threads (the conversations a leader holds) are
 * numbered globally in the order they started, like quests, so the numbers never collide across
 * leaders. Internally a thread is still keyed by its handle (`topic:<handle>`, which keeps working
 * as an alias); `t-N` is what agents and people read and write.
 */
export const THREAD_NUMBER_PATTERN = String.raw`t-\d+`;
const THREAD_NUMBER_RE = /^t-(\d+)$/;
/** A topic thread key as written: the short handle, or a whole topic ID (older keys). */
export const TOPIC_THREAD_KEY_PATTERN = String.raw`topic:[0-9a-f][0-9a-f-]{7,35}`;
const HANDLE_LENGTH = 8;

/** The short handle of a topic ID: its first 8 hex digits. */
export function topicHandle(topicId: string): string {
  return topicId.trim().toLowerCase().replace(/-/g, "").slice(0, HANDLE_LENGTH);
}

/** The thread and conversation key of a topic. */
export function topicViewKey(topicId: string): string {
  return `${PREFIX}${topicHandle(topicId)}`;
}

/**
 * The topic handle a key names; null for any other key. A key naming a whole topic ID (as keys
 * did before handles) names that topic's handle.
 */
export function topicIdOfViewKey(viewKey: string): string | null {
  const key = viewKey.trim().toLowerCase();
  const number = THREAD_NUMBER_RE.exec(key);
  if (number) return handleOfNumber.get(Number(number[1])) ?? null;
  if (!key.startsWith(PREFIX)) return null;
  const id = key.slice(PREFIX.length);
  return /^[\w-]+$/.test(id) ? topicHandle(id) || null : null;
}

/** The canonical form of a topic key (`topic:<handle>`); null for any other key. */
export function normalizeTopicKey(key: string): string | null {
  const handle = topicIdOfViewKey(key);
  return handle ? `${PREFIX}${handle}` : null;
}

/** Whether a key is a topic's thread and conversation. */
export function isTopicViewKey(viewKey: string): boolean {
  return topicIdOfViewKey(viewKey) !== null;
}

/** Whether `topicId` is the topic this key names. */
export function isKeyOfTopic(viewKey: string, topicId: string): boolean {
  return topicIdOfViewKey(viewKey) === topicHandle(topicId);
}

const handleOfNumber = new Map<number, string>();
const numberOfHandle = new Map<string, number>();

/** Learns threads' numbers (`[number, thread ID or handle]`), so `t-N` addresses resolve here. */
export function rememberThreadNumbers(entries: Iterable<readonly [number, string]>): void {
  for (const [number, id] of entries) {
    const handle = topicHandle(id);
    handleOfNumber.set(number, handle);
    numberOfHandle.set(handle, number);
  }
}

/** Whether a key is written as a thread number (`t-17`), known here or not. */
export function isThreadNumberKey(key: string): boolean {
  return THREAD_NUMBER_RE.test(key.trim().toLowerCase());
}

/**
 * How a thread key is written for agents and people: a thread's number (`t-17`) when it has one,
 * otherwise the key as given (`main`, `q-12`, or a handle whose number isn't known here).
 */
export function threadAddress(threadKey: string): string {
  const handle = topicIdOfViewKey(threadKey);
  const number = handle ? numberOfHandle.get(handle) : undefined;
  return number !== undefined ? `t-${number}` : threadKey.trim().toLowerCase();
}

/** Forgets every thread number, for tests. */
export function resetThreadNumbersForTest(): void {
  handleOfNumber.clear();
  numberOfHandle.clear();
}
