import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { buildLeaderThreadRowsFromSummaries } from "../../shared/leader-projection.js";
import { useStore } from "../store.js";
import type { BoardRowData } from "../components/BoardTable.js";
import type { QuestThreadBannerRow } from "./session-quest-banner-row.js";
import { applyCanonicalQuestTitles, buildCanonicalQuestTitleIndex } from "./quest-title-index.js";
import { mergeProjectedLeaderThreadRows } from "./leader-thread-tabs-navigation.js";
import { resolveLeaderThreadTabsProjection } from "./leader-thread-tabs-resolver.js";
import { normalizeThreadKey } from "./thread-projection.js";

const NO_BOARD: readonly BoardRowData[] = [];

/**
 * A leader's quest thread as the main view's chips read it (`QuestThreadFeedChips`): its board row,
 * Journey, worker, status and ownership, from the leader's boards and tab projection, the same
 * sources and merge as the main view's thread rows; undefined for a thread that is not a quest's.
 * A side conversation uses it, so its feed shows the quest's state as the main view does.
 */
export function useLeaderQuestThreadRow(leaderId: string, threadKey: string): QuestThreadBannerRow | undefined {
  const key = normalizeThreadKey(threadKey);
  const quest = /^q-\d+$/.test(key);
  const activeBoard = useStore((state) => (quest ? state.sessionBoards.get(leaderId) : undefined) ?? NO_BOARD);
  const completedBoard = useStore(
    (state) => (quest ? state.sessionCompletedBoards.get(leaderId) : undefined) ?? NO_BOARD,
  );
  const rowSessionStatuses = useStore((state) => (quest ? state.sessionBoardRowStatuses.get(leaderId) : undefined));
  const quests = useStore((state) => state.quests);
  const { questDetails, questTitlePreviews } = useStore(
    useShallow((state) => ({ questDetails: state.questDetails, questTitlePreviews: state.questTitlePreviews })),
  );
  const projection = useStore((state) => {
    if (!quest) return null;
    const resolved = resolveLeaderThreadTabsProjection(state, leaderId);
    return resolved.projectionState === "accepted" ? resolved.value : null;
  });
  return useMemo(() => {
    if (!quest) return undefined;
    const titles = buildCanonicalQuestTitleIndex({ quests, questDetails, questTitlePreviews });
    const boardRows = buildLeaderThreadRowsFromSummaries({
      activeBoard,
      completedBoard,
      threadSummaries: [],
      quests,
      rowSessionStatuses,
    }).map((row) => ({ ...row, leaderSessionId: leaderId }));
    const detailRows = applyCanonicalQuestTitles(boardRows, titles);
    const rows = projection ? mergeProjectedLeaderThreadRows(detailRows, projection, titles) : detailRows;
    const row = rows.find((candidate) => candidate.threadKey === key) as QuestThreadBannerRow | undefined;
    if (row) return row;
    // A quest known only by its title: its chips show no more than the main view's would.
    const title = titles.get(key);
    return title ? { threadKey: key, questId: key, title } : undefined;
  }, [
    activeBoard,
    completedBoard,
    key,
    leaderId,
    projection,
    quest,
    questDetails,
    questTitlePreviews,
    quests,
    rowSessionStatuses,
  ]);
}
