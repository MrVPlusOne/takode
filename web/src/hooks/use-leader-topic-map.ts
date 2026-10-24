import { useEffect, useRef, useState } from "react";
import type { QuestTopicMap } from "../../shared/library-topics.js";
import { topicApi } from "../api/topics.js";

/**
 * The Library topic of each of a leader's quests, for grouping its Done list by topic; null while
 * the leader has topics off. Reloaded when its quest tabs change.
 */
export function useLeaderTopicMap(leaderSessionId: string, questIds: readonly string[]): QuestTopicMap | null {
  const [map, setMapState] = useState<QuestTopicMap | null>(null);
  const current = useRef<QuestTopicMap | null>(null);
  const key = questIds.join(",");
  useEffect(() => {
    // Leaders with topics off (the default) must not re-render the tab bar for nothing.
    const setMap = (next: QuestTopicMap | null) => {
      if (JSON.stringify(next) === JSON.stringify(current.current)) return;
      current.current = next;
      setMapState(next);
    };
    if (!key) {
      setMap(null);
      return;
    }
    let cancelled = false;
    topicApi
      .questMap(leaderSessionId, key.split(","))
      .then((response) => !cancelled && setMap(response.enabled ? response.map : null))
      .catch(() => !cancelled && setMap(null));
    return () => {
      cancelled = true;
    };
  }, [leaderSessionId, key]);
  return map;
}
