/**
 * A reopened quest in a thread list or strip is named by what it is doing now: its newest round's
 * title, with the quest (number and title) second (Jiayi, Nov 1: a reopened quest's generic title
 * says less than its newest round). Round titles come with the browser's quest title previews.
 */
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";

/**
 * The newest round titles of these quests, by normalized quest ID, for the reopened ones, from the
 * quest title previews the browser already holds (the views listing these threads load them).
 */
export function useQuestRoundTitles(questIds: readonly (string | null | undefined)[]): ReadonlyMap<string, string> {
  const keys = [
    ...new Set(
      questIds.flatMap((questId) => (questId && /^q-\d+$/i.test(questId) ? [normalizeThreadKey(questId)] : [])),
    ),
  ];
  const keyList = keys.join(",");
  const titles = useStore(
    useShallow((state) => keys.map((key) => state.questTitlePreviews?.get(key)?.roundTitle ?? "")),
  );
  return useMemo(
    () => new Map(keyList.split(",").flatMap((key, index) => (titles[index] ? [[key, titles[index]] as const] : []))),
    [keyList, titles],
  );
}

/** One quest's newest round title, when it was reopened. */
export function useQuestRoundTitle(questId: string | null | undefined): string | undefined {
  const key = questId ? normalizeThreadKey(questId) : null;
  return useQuestRoundTitles([key]).get(key ?? "");
}

/**
 * A reopened quest's name in a row or strip: the round title, then the quest muted (its number when
 * given, and its title) in only the room the round title leaves, so it gives way first. Place it in
 * a flex row.
 */
export function QuestRoundTitle({
  roundTitle,
  questId,
  questTitle,
}: {
  roundTitle: string;
  /** Shown before the quest title, where the row does not already show the quest number. */
  questId?: string | null;
  questTitle?: string;
}) {
  return (
    <>
      <span className="min-w-0 truncate" data-testid="quest-round-title">
        {roundTitle}
      </span>
      {(questId || questTitle) && (
        <span className="min-w-0 flex-1 truncate text-cc-muted" data-testid="quest-round-title-quest">
          {questId && <span className="font-mono-code text-[0.9em]">{questId}</span>}
          {questId && questTitle ? " " : null}
          {questTitle}
        </span>
      )}
    </>
  );
}
