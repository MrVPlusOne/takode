/**
 * Marks side quests: quests filed from one of the leader's requests that is still answered
 * where it was asked, so the user can read the answer there and skip the quest's own tab.
 * The server's leader tab projection says which quests are side quests (`sideQuestOf`).
 */
import { useStore } from "../store.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";

/** The thread a leader's quest is a side quest of ("main" or a quest ID), or undefined. */
export function useSideQuestOf(leaderSessionId: string | undefined, questId: string | undefined): string | undefined {
  return useStore((state) => {
    if (!leaderSessionId || !questId) return undefined;
    const key = normalizeThreadKey(questId);
    return resolveLeaderThreadTabsProjection(state, leaderSessionId).value?.tabs.find((tab) => tab.threadKey === key)
      ?.sideQuestOf;
  });
}

/** "Side quest of Main" or "Side quest of q-12": where the quest's answer is given. */
export function sideQuestOfText(sideQuestOf: string): string {
  return `Side quest of ${sideQuestOf === MAIN_THREAD_KEY ? "Main" : sideQuestOf}`;
}

/** A branch off a line and back: the side-quest mark. */
export function SideQuestIcon({ sideQuestOf }: { sideQuestOf: string }) {
  const label = sideQuestOfText(sideQuestOf);
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
