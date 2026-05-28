import type { BoardRowSessionStatus, QuestmasterTask } from "../types.js";
import { getQuestJourneyPhase, type QuestJourneyPlanState } from "../../shared/quest-journey.js";

export interface SessionQuestContextBoardRow {
  questId: string;
  title?: string;
  worker?: string;
  workerNum?: number;
  journey?: QuestJourneyPlanState;
  status?: string;
  waitFor?: string[];
  waitForInput?: string[];
  createdAt?: number;
  updatedAt: number;
  completedAt?: number;
}

export interface SessionQuestContextCandidate {
  quest?: QuestmasterTask;
  row?: SessionQuestContextBoardRow;
  rowStatus?: BoardRowSessionStatus;
  leaderSessionId?: string;
}

export interface FindSessionQuestContextCandidateInput {
  sessionId: string;
  sessionNum?: number | null;
  quests: readonly QuestmasterTask[];
  sessionBoards: ReadonlyMap<string, readonly SessionQuestContextBoardRow[]>;
  sessionCompletedBoards: ReadonlyMap<string, readonly SessionQuestContextBoardRow[]>;
  rowStatuses: ReadonlyMap<string, Record<string, BoardRowSessionStatus>>;
}

function sessionNumMatches(candidate: number | null | undefined, sessionNum: number | null | undefined): boolean {
  return typeof candidate === "number" && typeof sessionNum === "number" && candidate === sessionNum;
}

function participantMatches(
  participant: BoardRowSessionStatus["worker"] | BoardRowSessionStatus["reviewer"] | undefined | null,
  sessionId: string,
  sessionNum: number | null | undefined,
): boolean {
  if (!participant) return false;
  return participant.sessionId === sessionId || sessionNumMatches(participant.sessionNum, sessionNum);
}

export function boardRowMatchesSession(
  row: SessionQuestContextBoardRow,
  rowStatus: BoardRowSessionStatus | undefined,
  sessionId: string,
  sessionNum?: number | null,
): boolean {
  return (
    row.worker === sessionId ||
    sessionNumMatches(row.workerNum, sessionNum) ||
    participantMatches(rowStatus?.worker, sessionId, sessionNum) ||
    participantMatches(rowStatus?.reviewer, sessionId, sessionNum)
  );
}

function questTimestamp(quest: QuestmasterTask | undefined): number {
  if (!quest) return 0;
  if ("completedAt" in quest && typeof quest.completedAt === "number") return quest.completedAt;
  if (typeof quest.statusChangedAt === "number") return quest.statusChangedAt;
  if (typeof quest.updatedAt === "number") return quest.updatedAt;
  return quest.createdAt;
}

function questById(quests: readonly QuestmasterTask[], questId: string): QuestmasterTask | undefined {
  const normalized = questId.toLowerCase();
  return quests.find((quest) => quest.questId.toLowerCase() === normalized);
}

function rowStatusFor(
  statuses: Record<string, BoardRowSessionStatus> | undefined,
  questId: string,
): BoardRowSessionStatus | undefined {
  return statuses?.[questId] ?? statuses?.[questId.toLowerCase()];
}

function boardCandidates(
  boards: ReadonlyMap<string, readonly SessionQuestContextBoardRow[]>,
  rowStatuses: ReadonlyMap<string, Record<string, BoardRowSessionStatus>>,
  quests: readonly QuestmasterTask[],
  sessionId: string,
  sessionNum: number | null | undefined,
): SessionQuestContextCandidate[] {
  const candidates: SessionQuestContextCandidate[] = [];
  for (const [leaderSessionId, rows] of boards) {
    const statuses = rowStatuses.get(leaderSessionId);
    for (const row of rows) {
      const rowStatus = rowStatusFor(statuses, row.questId);
      if (!boardRowMatchesSession(row, rowStatus, sessionId, sessionNum)) continue;
      const quest = questById(quests, row.questId);
      candidates.push({ quest, row, rowStatus, leaderSessionId });
    }
  }
  return candidates.sort(
    (left, right) =>
      (right.row?.updatedAt ?? questTimestamp(right.quest)) - (left.row?.updatedAt ?? questTimestamp(left.quest)) ||
      (right.quest?.questId ?? right.row?.questId ?? "").localeCompare(left.quest?.questId ?? left.row?.questId ?? ""),
  );
}

function occurrenceMatchesSession(
  occurrence: NonNullable<QuestmasterTask["journeyRuns"]>[number]["phaseOccurrences"][number] | undefined,
  sessionId: string,
  sessionNum: number | null | undefined,
): boolean {
  if (!occurrence) return false;
  return occurrence.assigneeSessionId === sessionId || sessionNumMatches(occurrence.assigneeSessionNum, sessionNum);
}

function activeOccurrence(run: NonNullable<QuestmasterTask["journeyRuns"]>[number]) {
  return run.phaseOccurrences.find((occurrence) => occurrence.status === "active");
}

function latestStartedOccurrence(run: NonNullable<QuestmasterTask["journeyRuns"]>[number]) {
  return [...run.phaseOccurrences]
    .filter((occurrence) => occurrence.status !== "pending")
    .sort((left, right) => right.phaseIndex - left.phaseIndex)[0];
}

function runMatchesSession(
  run: NonNullable<QuestmasterTask["journeyRuns"]>[number],
  sessionId: string,
  sessionNum: number | null | undefined,
): boolean {
  return (
    run.workerSessionId === sessionId ||
    sessionNumMatches(run.workerSessionNum, sessionNum) ||
    occurrenceMatchesSession(activeOccurrence(run), sessionId, sessionNum)
  );
}

function rowFromRun(
  quest: QuestmasterTask,
  run: NonNullable<QuestmasterTask["journeyRuns"]>[number],
): SessionQuestContextBoardRow {
  const currentOccurrence = activeOccurrence(run) ?? latestStartedOccurrence(run);
  const currentPhaseId = currentOccurrence?.phaseId;
  const journey: QuestJourneyPlanState = {
    mode: "active",
    phaseIds: run.phaseIds,
    ...(currentOccurrence ? { activePhaseIndex: currentOccurrence.phaseIndex } : {}),
    ...(currentPhaseId ? { currentPhaseId } : {}),
  };
  const status =
    run.status !== "active"
      ? "done"
      : (currentOccurrence?.boardState ??
        (currentPhaseId ? getQuestJourneyPhase(currentPhaseId)?.boardState : undefined));

  return {
    questId: quest.questId,
    title: quest.title,
    journey,
    ...(status ? { status } : {}),
    ...(run.workerSessionId ? { worker: run.workerSessionId } : {}),
    ...(typeof run.workerSessionNum === "number" ? { workerNum: run.workerSessionNum } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    ...(run.completedAt ? { completedAt: run.completedAt } : {}),
  };
}

function journeyRunCandidate(
  quests: readonly QuestmasterTask[],
  sessionId: string,
  sessionNum: number | null | undefined,
): SessionQuestContextCandidate | null {
  const candidates = quests.flatMap((quest) =>
    (quest.journeyRuns ?? [])
      .filter((run) => run.status === "active" && runMatchesSession(run, sessionId, sessionNum))
      .map((run) => ({
        quest,
        run,
        leaderSessionId: run.leaderSessionId ?? run.sourceBoardSessionId,
      })),
  );
  const selected = candidates.sort((left, right) => right.run.updatedAt - left.run.updatedAt)[0];
  return selected
    ? {
        quest: selected.quest,
        row: rowFromRun(selected.quest, selected.run),
        leaderSessionId: selected.leaderSessionId,
      }
    : null;
}

function ownerCandidate(quests: readonly QuestmasterTask[], sessionId: string): SessionQuestContextCandidate | null {
  const active = quests.find(
    (quest) => quest.status === "in_progress" && "sessionId" in quest && quest.sessionId === sessionId,
  );
  if (active) return { quest: active };
  const done = quests
    .filter((quest) => {
      if (quest.status !== "done") return false;
      return quest.previousOwnerSessionIds?.includes(sessionId) === true;
    })
    .sort(
      (left, right) => questTimestamp(right) - questTimestamp(left) || right.questId.localeCompare(left.questId),
    )[0];
  return done ? { quest: done } : null;
}

export function findSessionQuestContextCandidate({
  sessionId,
  sessionNum,
  quests,
  sessionBoards,
  sessionCompletedBoards,
  rowStatuses,
}: FindSessionQuestContextCandidateInput): SessionQuestContextCandidate | null {
  return (
    boardCandidates(sessionBoards, rowStatuses, quests, sessionId, sessionNum)[0] ??
    journeyRunCandidate(quests, sessionId, sessionNum) ??
    ownerCandidate(quests, sessionId) ??
    boardCandidates(sessionCompletedBoards, rowStatuses, quests, sessionId, sessionNum)[0] ??
    null
  );
}
