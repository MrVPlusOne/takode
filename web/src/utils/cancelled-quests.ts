import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { normalizeThreadKey } from "./thread-projection.js";

/**
 * The quests among these that were cancelled, from the browser's quest title previews. Cancelled
 * quests leave every thread list (the status row, Home, the sessions panel's Threads view; Jiayi,
 * Nov 1) and stay reachable through search, Questmaster, links and their own thread.
 */
export function useCancelledQuestIds(questIds: readonly (string | null | undefined)[]): ReadonlySet<string> {
  const cancelled = useStore(
    useShallow((state) =>
      questIds.flatMap((questId) => {
        const key = questId ? normalizeThreadKey(questId) : null;
        return key && state.questTitlePreviews.get(key)?.cancelled ? [key] : [];
      }),
    ),
  );
  return useMemo(() => new Set(cancelled), [cancelled]);
}
