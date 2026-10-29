import { useCallback, useEffect, useMemo } from "react";
import { create } from "zustand";
import type {
  QuestTopicMap,
  QuestTopicsResponse,
  ThreadSummary,
  TopicBrief,
  TopicSummary,
} from "../../shared/library-topics.js";
import { isKeyOfTopic, isTopicViewKey } from "../../shared/topic-thread-key.js";
import { topicApi } from "../api/topics.js";

/**
 * The Library topics of a leader's quests, kept in the browser for the whole tab bar: the tab bar
 * loads them for all its tabs, so opening a quest tab names its topic at once, with the quest
 * strip, instead of after its own request. Each lookup still asks the server again in the
 * background, so a quest the Scribe filed meanwhile shows its topic.
 */
interface LeaderTopics {
  enabled: boolean;
  map: QuestTopicMap;
  topics: Record<string, TopicBrief>;
  /** Quests the server was asked about (a quest under no topic has no map entry). */
  asked: Record<string, true>;
}

const useLeaderTopicsStore = create<{ byLeader: Record<string, LeaderTopics> }>(() => ({ byLeader: {} }));

/** Records an answer about `questIds`: their topics replace what was known about them. */
function remember(leaderId: string, questIds: readonly string[], response: QuestTopicsResponse): void {
  useLeaderTopicsStore.setState((state) => {
    const previous = state.byLeader[leaderId] ?? { enabled: false, map: {}, topics: {}, asked: {} };
    const map = { ...previous.map };
    for (const questId of questIds) {
      if (response.map[questId]) map[questId] = response.map[questId];
      else delete map[questId];
    }
    const next: LeaderTopics = {
      enabled: response.enabled,
      map,
      topics: { ...previous.topics, ...response.topics },
      asked: { ...previous.asked, ...Object.fromEntries(questIds.map((questId) => [questId, true as const])) },
    };
    if (JSON.stringify(next) === JSON.stringify(previous)) return state;
    return { byLeader: { ...state.byLeader, [leaderId]: next } };
  });
}

/** Records a leader's whole topic list (the Topics tab group loads it), so topic threads have names. */
export function rememberTopicList(leaderId: string, topics: readonly TopicSummary[]): void {
  useLeaderTopicsStore.setState((state) => {
    const previous = state.byLeader[leaderId] ?? { enabled: false, map: {}, topics: {}, asked: {} };
    const briefs = Object.fromEntries(
      topics.map((topic) => [
        topic.id,
        {
          name: topic.name,
          questIds: topic.questIds,
          activityAt: topic.activityAt,
          ...(topic.threads ? { threads: topic.threads } : {}),
        },
      ]),
    );
    const next = {
      ...previous,
      enabled: previous.enabled || topics.length > 0,
      topics: { ...previous.topics, ...briefs },
    };
    if (JSON.stringify(next) === JSON.stringify(previous)) return state;
    return { byLeader: { ...state.byLeader, [leaderId]: next } };
  });
}

/**
 * A leader's threads (New thread), as last loaded: lightweight conversations that are not topics.
 * The tab bar loads them for its Threads menu; starting one adds it at once.
 */
const useLeaderThreadsStore = create<{ byLeader: Record<string, ThreadSummary[]> }>(() => ({ byLeader: {} }));

/** Records a leader's threads: the whole list, or one thread that changed. */
export function rememberThreads(leaderId: string, threads: readonly ThreadSummary[], whole = true): void {
  useLeaderThreadsStore.setState((state) => {
    const previous = state.byLeader[leaderId] ?? [];
    const next = whole
      ? [...threads]
      : [...threads, ...previous.filter((known) => !threads.some((thread) => thread.id === known.id))];
    next.sort((a, b) => b.activityAt - a.activityAt);
    if (JSON.stringify(next) === JSON.stringify(previous)) return state;
    return { byLeader: { ...state.byLeader, [leaderId]: next } };
  });
}

const EMPTY_THREADS: ThreadSummary[] = [];

/** A leader's threads, newest activity first; loads them (and every minute) while `enabled`. */
export function useLeaderThreads(leaderId: string, enabled: boolean, refreshKey = ""): ThreadSummary[] {
  useEffect(() => {
    if (!enabled || !leaderId) return;
    let cancelled = false;
    const load = () =>
      topicApi
        .threads(leaderId)
        .then((response) => !cancelled && rememberThreads(leaderId, response.threads))
        .catch((error: Error) => console.warn("[library] Could not load the threads:", error.message));
    void load();
    const timer = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [leaderId, enabled, refreshKey]);
  return useLeaderThreadsStore((state) => state.byLeader[leaderId] ?? EMPTY_THREADS);
}

/** A leader's threads changed on the server: reloads them when this browser has them. */
export function reloadLeaderThreads(leaderId: string): void {
  if (!useLeaderThreadsStore.getState().byLeader[leaderId]) return;
  topicApi
    .threads(leaderId)
    .then((response) => rememberThreads(leaderId, response.threads))
    .catch((error: Error) => console.warn("[library] Could not reload the threads:", error.message));
}

const namesAsked = new Set<string>();

/**
 * Loads a leader's threads and topics once, for names shown outside its tab bar (the attention
 * list, a message's thread label): only the tab bar loads them otherwise.
 */
export function loadLeaderNamesOnce(leaderId: string): void {
  if (namesAsked.has(leaderId)) return;
  namesAsked.add(leaderId);
  const warn = (error: Error) => console.warn("[library] Could not load the threads and topics:", error.message);
  if (!useLeaderThreadsStore.getState().byLeader[leaderId])
    topicApi
      .threads(leaderId)
      .then((response) => rememberThreads(leaderId, response.threads))
      .catch(warn);
  topicApi
    .list("", leaderId)
    .then((response) => rememberTopicList(leaderId, response.topics))
    .catch(warn);
}

/**
 * Names a topic conversation or user thread key (`topic:<handle>`) of any leader: the thread's or
 * the topic's name, as last known, and whether it is a thread; undefined for other keys and until known.
 */
export function useTopicKeyNamer(): (
  leaderId: string,
  threadKey: string,
) => { name: string; thread: boolean } | undefined {
  const threads = useLeaderThreadsStore((state) => state.byLeader);
  const topics = useLeaderTopicsStore((state) => state.byLeader);
  return useCallback(
    (leaderId: string, threadKey: string) => {
      if (!isTopicViewKey(threadKey)) return undefined;
      const key = threadKey.toLowerCase();
      const thread = threads[leaderId]?.find((candidate) => candidate.key === key);
      if (thread) return { name: thread.name, thread: true };
      const known = topics[leaderId]?.topics ?? {};
      const id = Object.keys(known).find((topicId) => isKeyOfTopic(key, topicId));
      return id ? { name: known[id]!.name, thread: false } : undefined;
    },
    [threads, topics],
  );
}

/** The thread a thread key names, as last known for a leader; undefined for topics and unknown keys. */
export function useKnownThreadOfKey(leaderId: string, threadKey: string): ThreadSummary | undefined {
  return useLeaderThreadsStore((state) =>
    threadKey ? state.byLeader[leaderId]?.find((thread) => thread.key === threadKey.toLowerCase()) : undefined,
  );
}

/** Asks the server about some of a leader's quests and remembers the answer. */
export function loadLeaderTopics(leaderId: string, questIds: readonly string[]): Promise<void> {
  // With no quests to ask about, still learn once whether topics are on: a leader can have
  // threads it started before any quest.
  if (!questIds.length && useLeaderTopicsStore.getState().byLeader[leaderId]) return Promise.resolve();
  return topicApi.questMap(leaderId, questIds).then((response) => remember(leaderId, questIds, response));
}

/**
 * For the tab bar: loads the topics of these quests (all its tabs), and returns what the Done list
 * groups by; null while the leader has topics off.
 */
export function useLeaderTopics(
  leaderId: string,
  questIds: readonly string[],
): { map: QuestTopicMap; topics: Record<string, TopicBrief> } | null {
  const key = questIds.join(",");
  useEffect(() => {
    loadLeaderTopics(leaderId, key ? key.split(",") : []).catch((error: Error) =>
      console.warn("[library] Could not load the tabs' topics:", error.message),
    );
  }, [leaderId, key]);
  const known = useLeaderTopicsStore((state) => state.byLeader[leaderId]);
  return known?.enabled ? known : null;
}

/** Whether a leader has Library topics on, as last known (false until its tab bar has asked). */
export function useLeaderTopicsOn(leaderId: string): boolean {
  return useLeaderTopicsStore((state) => !!leaderId && !!state.byLeader[leaderId]?.enabled);
}

/** The topic a quest is filed under, as last known; undefined when not known yet. */
export function useKnownQuestTopic(leaderId: string, questId: string): QuestTopicMap[string] | null | undefined {
  return useLeaderTopicsStore((state) => {
    const known = state.byLeader[leaderId];
    if (!known?.asked[questId]) return undefined;
    return known.map[questId] ?? null;
  });
}

/** A topic in brief (name, quests, last activity), as last known for a leader. */
export function useKnownTopicBrief(leaderId: string, topicId: string | undefined): TopicBrief | undefined {
  return useLeaderTopicsStore((state) => (topicId ? state.byLeader[leaderId]?.topics[topicId] : undefined));
}

/** The topic a topic thread key names (`topic:<handle>`), as last known for a leader. */
export function useKnownTopicOfKey(leaderId: string, topicKey: string): (TopicBrief & { id: string }) | undefined {
  // Selects stable values (the ID string and the stored brief); a new object per read would re-render forever.
  const id = useLeaderTopicsStore((state) =>
    Object.keys(state.byLeader[leaderId]?.topics ?? {}).find((topicId) => isKeyOfTopic(topicKey, topicId)),
  );
  const brief = useLeaderTopicsStore((state) => (id ? state.byLeader[leaderId]?.topics[id] : undefined));
  return useMemo(() => (id && brief ? { id, ...brief } : undefined), [id, brief]);
}

/**
 * Every leader's known quest topics, for lists spanning leaders (the attention list groups unread
 * answers by topic). Asks the server about the given quests the first time they appear. A topic's
 * own thread (`topic:<handle>`) is its topic, when the leader's topics are known.
 */
export function useQuestTopicsOf(
  quests: ReadonlyArray<{ leaderId: string; questId: string }>,
): (leaderId: string, questId: string) => { id: string; name: string } | null | undefined {
  const byLeader = useLeaderTopicsStore((state) => state.byLeader);
  const unknown = quests
    .filter(({ leaderId, questId }) => !byLeader[leaderId]?.asked[questId])
    .map(({ leaderId, questId }) => `${leaderId} ${questId}`);
  const unknownKey = [...new Set(unknown)].sort().join(",");
  useEffect(() => {
    if (!unknownKey) return;
    const byLeaderQuests = new Map<string, string[]>();
    for (const pair of unknownKey.split(",")) {
      const [leaderId, questId] = pair.split(" ") as [string, string];
      byLeaderQuests.set(leaderId, [...(byLeaderQuests.get(leaderId) ?? []), questId]);
    }
    for (const [leaderId, questIds] of byLeaderQuests) {
      loadLeaderTopics(leaderId, questIds).catch((error: Error) =>
        console.warn("[library] Could not look up the topics of unread answers:", error.message),
      );
    }
  }, [unknownKey]);
  return useCallback(
    (leaderId: string, questId: string) => {
      const known = byLeader[leaderId];
      if (isTopicViewKey(questId)) {
        const id = Object.keys(known?.topics ?? {}).find((topicId) => isKeyOfTopic(questId, topicId));
        return id ? { id, name: known!.topics[id]!.name } : null;
      }
      if (!known?.asked[questId]) return undefined;
      return known.map[questId] ?? null;
    },
    [byLeader],
  );
}

/**
 * The quest tab that shows a topic thread's conversation (a topic conversation opens in one of its
 * quests' tabs, zoomed out): the topic's newest quest, as last known; null when unknown.
 */
export function topicHostQuest(leaderId: string, topicKey: string): string | null {
  const topics = useLeaderTopicsStore.getState().byLeader[leaderId]?.topics ?? {};
  const id = Object.keys(topics).find((topicId) => isKeyOfTopic(topicKey, topicId));
  const quests = id ? [...topics[id]!.questIds] : [];
  return quests.sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))[0] ?? null;
}

/** For the Playground: the topics of some quests, as if the server had answered about them. */
export function seedLeaderTopics(leaderId: string, map: QuestTopicMap): void {
  remember(leaderId, Object.keys(map), { enabled: true, map, topics: {} });
}

/** For tests: forget everything. */
export function resetLeaderTopicsForTest(): void {
  useLeaderTopicsStore.setState({ byLeader: {} });
  namesAsked.clear();
}
