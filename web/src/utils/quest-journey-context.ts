import type {
  BoardParticipantStatus,
  BoardRowSessionStatus,
  QuestListPreview,
  QuestmasterTask,
  SdkSessionInfo,
} from "../types.js";
import { getQuestLeaderSessionId, getQuestOwnerSessionId } from "./quest-helpers.js";
import { getQuestJourneyPhase, type QuestJourneyPlanState } from "../../shared/quest-journey.js";

export interface QuestJourneyBoardRow {
  questId: string;
  journey?: QuestJourneyPlanState;
  status?: string;
  worker?: string;
  workerNum?: number;
  waitFor?: string[];
  completedAt?: number;
}

export interface QuestJourneyContext {
  row: QuestJourneyBoardRow;
  rowStatus?: BoardRowSessionStatus;
  completed: boolean;
  /** The leader whose board holds the row, or the Journey run's leader. */
  leaderSessionId?: string;
}

/** The sessions behind a quest's Open Worker and Open Thread buttons. */
export interface QuestSessionTargets {
  workerSessionId: string | null;
  /** The board's worker status, for the worker's dot when its session is not listed. */
  workerStatus?: BoardParticipantStatus["status"];
  leaderSessionId: string | null;
}

/**
 * Resolve a quest's worker and leader sessions. The worker is the Journey row's worker, else the
 * quest's owner. The leader is the recorded leader, else the leader whose board or Journey run
 * holds the quest, else the worker's herding leader. A quest only records its leader once a worker
 * claims it, so a freshly dispatched quest depends on the board fallbacks.
 */
export function resolveQuestSessionTargets(
  quest: QuestmasterTask | QuestListPreview,
  context: QuestJourneyContext | null,
  sdkSessions: readonly SdkSessionInfo[],
): QuestSessionTargets {
  const worker = context?.rowStatus?.worker ?? null;
  const workerSessionId = worker?.sessionId ?? context?.row.worker ?? getQuestOwnerSessionId(quest);
  const leaderSessionId =
    getQuestLeaderSessionId(quest) ??
    context?.leaderSessionId ??
    (workerSessionId
      ? (sdkSessions.find((session) => session.sessionId === workerSessionId)?.herdedBy ?? null)
      : null);
  return {
    workerSessionId,
    ...(worker ? { workerStatus: worker.status } : context?.row.worker ? { workerStatus: "idle" } : {}),
    leaderSessionId,
  };
}

export function buildQuestJourneyContextByQuestId(
  quests: ReadonlyArray<QuestmasterTask | QuestListPreview>,
  sessionBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
  completedBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
): Map<string, QuestJourneyContext> {
  const contexts = new Map<string, QuestJourneyContext>();
  for (const [leaderSessionId, board] of sessionBoards) {
    for (const row of board) {
      contexts.set(row.questId.toLowerCase(), { row, completed: false, leaderSessionId });
    }
  }
  for (const [leaderSessionId, board] of completedBoards) {
    for (const row of board) {
      const questKey = row.questId.toLowerCase();
      if (!contexts.has(questKey)) contexts.set(questKey, { row, completed: true, leaderSessionId });
    }
  }
  for (const quest of quests) {
    const questKey = quest.questId.toLowerCase();
    if (contexts.has(questKey)) continue;
    const context = questJourneyContextFromRuns(quest);
    if (context) contexts.set(questKey, context);
  }
  return contexts;
}

export function findQuestJourneyContext(
  quest: QuestmasterTask | QuestListPreview,
  sessionBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
  completedBoards: ReadonlyMap<string, readonly QuestJourneyBoardRow[]>,
  rowStatuses: ReadonlyMap<string, Record<string, BoardRowSessionStatus>>,
): QuestJourneyContext | null {
  const normalizedQuestId = quest.questId.toLowerCase();
  for (const [sessionId, board] of sessionBoards) {
    const match = board.find((row) => row.questId.toLowerCase() === normalizedQuestId);
    if (match) {
      return {
        row: match,
        rowStatus: rowStatuses.get(sessionId)?.[match.questId],
        completed: false,
        leaderSessionId: sessionId,
      };
    }
  }
  for (const [sessionId, board] of completedBoards) {
    const match = board.find((row) => row.questId.toLowerCase() === normalizedQuestId);
    if (match) {
      return {
        row: match,
        rowStatus: rowStatuses.get(sessionId)?.[match.questId],
        completed: true,
        leaderSessionId: sessionId,
      };
    }
  }
  return questJourneyContextFromRuns(quest);
}

type QuestJourneyRun = NonNullable<(QuestmasterTask | QuestListPreview)["journeyRuns"]>[number];

function questJourneyContextFromRuns(quest: QuestmasterTask | QuestListPreview): QuestJourneyContext | null {
  const run = selectQuestJourneyRun(quest.journeyRuns ?? []);
  if (!run || run.phaseIds.length === 0) return null;

  const completed = run.status !== "active";
  const activeOccurrence = run.phaseOccurrences.find((occurrence) => occurrence.status === "active");
  const latestOccurrence = [...run.phaseOccurrences]
    .filter((occurrence) => occurrence.status !== "pending")
    .sort((left, right) => right.phaseIndex - left.phaseIndex)[0];
  const currentOccurrence = activeOccurrence ?? (completed ? undefined : latestOccurrence);
  const currentPhaseId = currentOccurrence?.phaseId;
  const phaseTimings = buildQuestJourneyPhaseTimings(run);
  const journey: QuestJourneyPlanState = {
    mode: "active",
    phaseIds: run.phaseIds,
    ...(currentOccurrence ? { activePhaseIndex: currentOccurrence.phaseIndex } : {}),
    ...(currentPhaseId ? { currentPhaseId } : {}),
    ...(phaseTimings ? { phaseTimings } : {}),
  };
  const status = completed
    ? "done"
    : (currentOccurrence?.boardState ??
      (currentPhaseId ? getQuestJourneyPhase(currentPhaseId)?.boardState : undefined));

  return {
    completed,
    ...(run.leaderSessionId ? { leaderSessionId: run.leaderSessionId } : {}),
    row: {
      questId: quest.questId,
      journey,
      ...(status ? { status } : {}),
      ...(run.workerSessionId ? { worker: run.workerSessionId } : {}),
      ...(typeof run.workerSessionNum === "number" ? { workerNum: run.workerSessionNum } : {}),
      ...(run.completedAt ? { completedAt: run.completedAt } : {}),
    },
  };
}

function selectQuestJourneyRun(runs: readonly QuestJourneyRun[]): QuestJourneyRun | null {
  const current = [...runs]
    .filter((run) => run.status === "active")
    .sort((left, right) => right.updatedAt - left.updatedAt)[0];
  if (current) return current;

  return (
    [...runs]
      .filter((run) => run.status !== "archived")
      .sort((left, right) => (right.completedAt ?? right.updatedAt) - (left.completedAt ?? left.updatedAt))[0] ?? null
  );
}

function buildQuestJourneyPhaseTimings(run: QuestJourneyRun): QuestJourneyPlanState["phaseTimings"] | undefined {
  const entries = run.phaseOccurrences.flatMap((occurrence) => {
    if (!occurrence.startedAt && !occurrence.completedAt) return [];
    return [
      [
        String(occurrence.phaseIndex),
        {
          ...(occurrence.startedAt ? { startedAt: occurrence.startedAt } : {}),
          ...(occurrence.completedAt ? { endedAt: occurrence.completedAt } : {}),
        },
      ] as const,
    ];
  });
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as NonNullable<QuestJourneyPlanState["phaseTimings"]>;
}
