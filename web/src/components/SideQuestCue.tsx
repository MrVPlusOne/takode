/**
 * Marks side quests: quests filed from one of the leader's requests that is still answered
 * where it was asked, so the user can read the answer there and skip the quest's own tab.
 * The server's leader tab projection says which quests are side quests (`sideQuestOf`).
 */
import { useMemo } from "react";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import { useStore } from "../store.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { useThreadPlace } from "./side-column/thread-names.js";

/** Where a leader's side quest is answered: "main", a quest ID or a thread's `topic:<handle>` key. */
export interface SideQuestOf {
  leaderId: string;
  threadKey: string;
}

/** The thread a leader's quest is a side quest of, or undefined. */
export function useSideQuestOf(
  leaderSessionId: string | undefined,
  questId: string | undefined,
): SideQuestOf | undefined {
  const threadKey = useStore((state) => {
    if (!leaderSessionId || !questId) return undefined;
    const key = normalizeThreadKey(questId);
    return resolveLeaderThreadTabsProjection(state, leaderSessionId).value?.tabs.find((tab) => tab.threadKey === key)
      ?.sideQuestOf;
  });
  return useMemo(
    () => (leaderSessionId && threadKey ? { leaderId: leaderSessionId, threadKey } : undefined),
    [leaderSessionId, threadKey],
  );
}

/**
 * "Side quest of Main", "Side quest of q-12" or "Side quest of <thread name>": where the quest's
 * answer is given. A thread is named, never shown by its `topic:<handle>` key.
 */
export function useSideQuestOfText({ leaderId, threadKey }: SideQuestOf): string {
  const key = normalizeThreadKey(threadKey);
  const thread = isTopicViewKey(key);
  // Naming Main costs nothing, so only a thread is looked up.
  const place = useThreadPlace(leaderId, thread ? key : MAIN_THREAD_KEY);
  if (thread) return `Side quest of ${place.name}`;
  return `Side quest of ${key === MAIN_THREAD_KEY ? "Main" : key}`;
}

/** A branch off a line and back: the side-quest mark. */
export function SideQuestIcon({ sideQuestOf }: { sideQuestOf: SideQuestOf }) {
  const label = useSideQuestOfText(sideQuestOf);
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      role="img"
      aria-label={label}
      data-testid="side-quest-icon"
    >
      <title>{label}</title>
      <path
        d="M4 2.5v6.5a2.5 2.5 0 0 0 2.5 2.5H12M9.5 9l2.5 2.5L9.5 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
