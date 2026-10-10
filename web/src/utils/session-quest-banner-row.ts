import type { LeaderThreadTabsProjectionJourney } from "../../shared/leader-thread-tabs-projection.js";
import type { BoardRowData } from "../components/BoardTable.js";
import type { QuestThreadOwnership } from "../components/QuestThreadOwnership.js";
import type { BoardRowSessionStatus, QuestmasterTask } from "../types.js";
import { findSessionQuestContextCandidate } from "./session-quest-context.js";

export interface QuestThreadBannerRow {
  threadKey: string;
  questId?: string;
  title: string;
  status?: string;
  boardStatus?: string;
  journey?: BoardRowData["journey"];
  journeyDurationSummary?: LeaderThreadTabsProjectionJourney["durationSummary"];
  boardRow?: BoardRowData;
  rowStatus?: BoardRowSessionStatus;
  leaderSessionId?: string | null;
  leaderSessionNum?: number | null;
  /** Whose board holds the quest, relative to the viewing leader; leader quest threads only. */
  ownership?: QuestThreadOwnership;
  /** Legacy row snapshot; commit UI resolves from the fresher exact quest projection. */
  commitShas?: string[];
  section?: "active" | "done";
}

function findQuestById(quests: QuestmasterTask[], questId?: string | null): QuestmasterTask | undefined {
  if (!questId) return undefined;
  const normalized = questId.toLowerCase();
  return quests.find((quest) => quest.questId.toLowerCase() === normalized);
}

export function findQuestBoardContext({
  questId,
  leaderSessionId,
  sessionBoards,
  sessionCompletedBoards,
  rowStatuses,
}: {
  questId: string;
  leaderSessionId?: string | null;
  sessionBoards: ReadonlyMap<string, readonly BoardRowData[]>;
  sessionCompletedBoards: ReadonlyMap<string, readonly BoardRowData[]>;
  rowStatuses: ReadonlyMap<string, Record<string, BoardRowSessionStatus>>;
}): {
  row?: BoardRowData;
  rowStatus?: BoardRowSessionStatus;
  leaderSessionId?: string;
} {
  const normalizedQuestId = questId.toLowerCase();
  const preferredLeaderId = leaderSessionId ?? undefined;
  const leaderIds = [
    ...(preferredLeaderId ? [preferredLeaderId] : []),
    ...[...sessionBoards.keys(), ...sessionCompletedBoards.keys()].filter((id) => id !== preferredLeaderId),
  ];

  for (const candidateLeaderId of leaderIds) {
    const row =
      sessionBoards
        .get(candidateLeaderId)
        ?.find((candidate) => candidate.questId.toLowerCase() === normalizedQuestId) ??
      sessionCompletedBoards
        .get(candidateLeaderId)
        ?.find((candidate) => candidate.questId.toLowerCase() === normalizedQuestId);
    const rowStatus =
      rowStatuses.get(candidateLeaderId)?.[questId] ?? rowStatuses.get(candidateLeaderId)?.[normalizedQuestId];
    if (row || rowStatus) return { row, rowStatus, leaderSessionId: candidateLeaderId };
  }

  return {};
}

export function buildSessionQuestBannerRow({
  sessionId,
  sessionNum,
  claimedQuestId,
  claimedQuestTitle,
  claimedQuestStatus,
  claimedQuestLeaderSessionId,
  herdedBy,
  quests,
  sessionBoards,
  sessionCompletedBoards,
  rowStatuses,
}: {
  sessionId: string;
  sessionNum?: number | null;
  claimedQuestId?: string | null;
  claimedQuestTitle?: string | null;
  claimedQuestStatus?: string | null;
  claimedQuestLeaderSessionId?: string | null;
  herdedBy?: string | null;
  quests: QuestmasterTask[];
  sessionBoards: ReadonlyMap<string, readonly BoardRowData[]>;
  sessionCompletedBoards: ReadonlyMap<string, readonly BoardRowData[]>;
  rowStatuses: ReadonlyMap<string, Record<string, BoardRowSessionStatus>>;
}): QuestThreadBannerRow | null {
  const sessionCandidate = claimedQuestId
    ? null
    : findSessionQuestContextCandidate({
        sessionId,
        sessionNum,
        quests,
        sessionBoards,
        sessionCompletedBoards,
        rowStatuses,
      });
  const quest = findQuestById(quests, claimedQuestId) ?? sessionCandidate?.quest;
  const questId = claimedQuestId ?? quest?.questId ?? sessionCandidate?.row?.questId;
  if (!questId) return null;

  const leaderSessionId =
    claimedQuestLeaderSessionId ?? quest?.leaderSessionId ?? sessionCandidate?.leaderSessionId ?? herdedBy ?? null;
  const boardContext = sessionCandidate?.row
    ? {
        row: sessionCandidate.row as BoardRowData,
        rowStatus: sessionCandidate.rowStatus,
        leaderSessionId: sessionCandidate.leaderSessionId,
      }
    : findQuestBoardContext({
        questId,
        leaderSessionId,
        sessionBoards,
        sessionCompletedBoards,
        rowStatuses,
      });
  const boardRow = boardContext.row;
  const rowStatus = boardContext.rowStatus;
  const resolvedLeaderSessionId = leaderSessionId ?? boardContext.leaderSessionId ?? null;
  const title = quest?.title ?? claimedQuestTitle ?? boardRow?.title ?? questId;
  const status = quest?.status ?? claimedQuestStatus ?? boardRow?.status;

  return {
    threadKey: questId.toLowerCase(),
    questId,
    title,
    ...(status ? { status } : {}),
    ...(boardRow?.status ? { boardStatus: boardRow.status } : {}),
    ...(boardRow?.journey ? { journey: boardRow.journey } : {}),
    ...(boardRow ? { boardRow } : {}),
    ...(rowStatus ? { rowStatus } : {}),
    ...(resolvedLeaderSessionId ? { leaderSessionId: resolvedLeaderSessionId } : {}),
    section: status === "done" || boardRow?.completedAt ? "done" : "active",
  };
}
