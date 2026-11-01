import { topicHandle, topicIdOfViewKey, topicViewKey } from "../shared/topic-thread-key.js";

/**
 * Which quests a topic conversation holds, and which topic conversation shows a quest: the
 * server's single answer, from the topic store, used to build topic windows and to decide which
 * views a message belongs to. Set at startup by the topic service; without it no topic views exist.
 */
export interface TopicViewSource {
  /** The live topic a thread handle names (following merges), or null. */
  /**
   * For a thread (New thread): where it started, the topic it is filed under, if any, and whether
   * it still has the placeholder name it started with (the user's first words).
   */
  topicOf(handle: string): {
    id: string;
    name: string;
    thread?: {
      startedFrom?: string;
      topicId?: string;
      placeholderName?: boolean;
      quest?: string;
      /** The earlier thread it was joined onto. */
      joinedInto?: string;
      /** The leader opened it itself. */
      byLeader?: boolean;
    };
  } | null;
  /** The handles of threads joined onto a thread: their messages read in its conversation. */
  threadsJoinedInto?(threadId: string): readonly string[];
  /** The handles of threads filed under a topic: their threads show in its conversation. */
  threadsUnder?(topicId: string): readonly string[];
  questsOf(topicId: string): readonly string[];
  /** The handles whose threads a topic's conversation shows: its own and those merged into it. */
  handlesOf(topicId: string): readonly string[];
  topicOfQuest(questId: string): string | null;
  /** Every thread, most recent activity first (to suggest one for an unknown handle). */
  listThreads?(): ReadonlyArray<{ id: string; name: string }>;
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
  const threads = (source.threadsUnder?.(topic.id) ?? []).map((handle) => topicViewKey(handle));
  const joined = (source.threadsJoinedInto?.(topic.id) ?? []).map((handle) => topicViewKey(handle));
  return [...merged, ...threads, ...joined, ...source.questsOf(topic.id).map((questId) => questId.toLowerCase())];
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
): {
  name: string;
  questIds: string[];
  more: number;
  thread?: { handle: string; startedFrom?: string; topicName?: string; placeholderName?: boolean; byLeader?: boolean };
} | null {
  const handle = threadKey ? topicIdOfViewKey(threadKey) : null;
  const topic = handle && source ? source.topicOf(handle) : null;
  if (!topic || !source) return null;
  const quests = [...source.questsOf(topic.id)].sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)));
  const under = topic.thread?.topicId ? source.topicOf(topicHandle(topic.thread.topicId)) : null;
  return {
    name: topic.name,
    questIds: quests.slice(0, limit),
    more: Math.max(0, quests.length - limit),
    ...(topic.thread
      ? {
          thread: {
            handle: topicHandle(topic.id),
            ...(topic.thread.startedFrom ? { startedFrom: topic.thread.startedFrom } : {}),
            ...(under ? { topicName: under.name } : {}),
            ...(topic.thread.placeholderName ? { placeholderName: true } : {}),
            ...(topic.thread.byLeader ? { byLeader: true } : {}),
          },
        }
      : {}),
  };
}

/**
 * How a topic thread key reads to the user (in search results): a thread the user started by its
 * name, a topic conversation by its topic's name. Null for other keys and unknown topics.
 */
export function topicThreadLabel(threadKey: string): string | null {
  const handle = topicIdOfViewKey(threadKey);
  const topic = handle && source ? source.topicOf(handle) : null;
  if (!topic) return null;
  return topic.thread ? `Thread "${topic.name}"` : `Topic "${topic.name}"`;
}

/**
 * The conversation a thread key's messages are read in now: a thread joined onto an earlier one, or
 * that became a quest's thread, is that conversation. Other keys come back as they are.
 */
export function threadConversationKey(threadKey: string): string {
  let key = threadKey;
  // A join is onto a thread that is not itself joined, but follow a short chain to be safe.
  for (let hop = 0; hop < 3; hop++) {
    const handle = topicIdOfViewKey(key);
    const thread = handle && source ? source.topicOf(handle)?.thread : undefined;
    const next = thread?.quest ?? thread?.joinedInto;
    if (!next) return key;
    key = next.toLowerCase();
  }
  return key;
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
    // A thread filed under a topic shows in that topic's conversation too.
    const handle = topicIdOfViewKey(key);
    const thread = handle && source ? source.topicOf(handle)?.thread : undefined;
    if (thread?.topicId) keys.add(topicViewKey(thread.topicId));
    // A side chat that became a quest's thread shows in that quest, and a thread joined onto an
    // earlier one in that thread, even for a message still routed to it.
    if (thread?.quest) keys.add(thread.quest);
    if (thread?.joinedInto) keys.add(thread.joinedInto);
  }
  for (const key of topicViewKeysOfQuests([...keys].filter((key) => /^q-\d+$/.test(key)))) keys.add(key);
  return [...keys];
}

/**
 * Whether a `topic:<handle>` key names no thread: a mistyped handle, or a topic's (topics are tags,
 * nobody writes in them). A message routed there shows in no view but All. False for other keys,
 * and while topics are not loaded.
 */
export function isUnknownThreadKey(threadKey: string): boolean {
  const handle = topicIdOfViewKey(threadKey);
  return !!handle && !!source && !source.topicOf(handle)?.thread;
}

/**
 * The threads whose handles are closest to an unknown thread key's (fewest differing characters,
 * then most recent activity), at most `limit`, for a warning that suggests the intended one.
 */
export function closestThreads(threadKey: string, limit = 3): Array<{ key: string; name: string }> {
  const handle = topicIdOfViewKey(threadKey);
  if (!handle || !source?.listThreads) return [];
  return source
    .listThreads()
    .map((thread, order) => ({ key: topicViewKey(thread.id), name: thread.name, order }))
    .map((thread) => ({ ...thread, distance: editDistance(handle, thread.key.slice("topic:".length)) }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order)
    .slice(0, limit)
    .map(({ key, name }) => ({ key, name }));
}

/** Levenshtein distance between two short strings. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length]!;
}

/** The sentence naming the closest threads, for warnings and errors about an unknown thread key. */
export function describeClosestThreads(threadKey: string): string {
  const closest = closestThreads(threadKey);
  if (closest.length === 0) return "No threads are known.";
  return `Closest threads: ${closest.map((thread) => `\`${thread.key}\` "${thread.name}"`).join(", ")}.`;
}
