import { useCallback, useEffect } from "react";
import { create } from "zustand";
import type { QuestTopicMap, QuestTopicsResponse, TopicBrief } from "../../shared/library-topics.js";
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

/** Asks the server about some of a leader's quests and remembers the answer. */
export function loadLeaderTopics(leaderId: string, questIds: readonly string[]): Promise<void> {
  if (!questIds.length) return Promise.resolve();
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

/**
 * Every leader's known quest topics, for lists spanning leaders (the attention list groups unread
 * answers by topic). Asks the server about the given quests the first time they appear.
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
      if (!known?.asked[questId]) return undefined;
      return known.map[questId] ?? null;
    },
    [byLeader],
  );
}

/** For the Playground: the topics of some quests, as if the server had answered about them. */
export function seedLeaderTopics(leaderId: string, map: QuestTopicMap): void {
  remember(leaderId, Object.keys(map), { enabled: true, map, topics: {} });
}

/** For tests: forget everything. */
export function resetLeaderTopicsForTest(): void {
  useLeaderTopicsStore.setState({ byLeader: {} });
}
