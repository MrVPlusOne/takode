import type { BoardRowData } from "../components/BoardTable.js";
import type { AppState } from "../store-types.js";
import type {
  BoardParticipantStatus,
  BoardRowSessionStatus,
  QuestmasterTask,
  SdkSessionInfo,
  SessionState,
} from "../types.js";
import { coalesceSessionViewModel } from "./session-view-model.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

export type DiffTargetResolution =
  | {
      kind: "session";
      source: "current-session" | "leader" | "quest-worker";
      sessionId: string;
      label: string;
      title: string;
      questId?: string;
      warning?: string;
    }
  | {
      kind: "unavailable";
      source: "quest-worker";
      questId: string;
      label: string;
      title: string;
      message: string;
    };

type WorkerCandidate = {
  sessionId?: string;
  sessionNum?: number | null;
  name?: string;
  status?: BoardParticipantStatus["status"];
};

export function resolveDiffTarget(
  state: AppState,
  currentSessionId: string | null | undefined,
  threadKey: string | null | undefined,
): DiffTargetResolution | null {
  if (!currentSessionId) return null;
  if (!isLeaderSession(state, currentSessionId)) return currentSessionDiffTarget(currentSessionId);

  const normalizedThreadKey = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
  if (normalizedThreadKey === MAIN_THREAD_KEY || normalizedThreadKey === ALL_THREADS_KEY) {
    return leaderDiffTarget(currentSessionId);
  }
  if (!isQuestThreadKey(normalizedThreadKey)) return leaderDiffTarget(currentSessionId);

  return resolveQuestWorkerDiffTarget(state, currentSessionId, normalizedThreadKey);
}

export function diffTargetSessionId(target: DiffTargetResolution | null): string | null {
  return target?.kind === "session" ? target.sessionId : null;
}

function currentSessionDiffTarget(sessionId: string): DiffTargetResolution {
  return {
    kind: "session",
    source: "current-session",
    sessionId,
    label: "Session diff",
    title: "Show diffs",
  };
}

function leaderDiffTarget(sessionId: string): DiffTargetResolution {
  return {
    kind: "session",
    source: "leader",
    sessionId,
    label: "Leader diff",
    title: "Show leader diffs",
  };
}

function resolveQuestWorkerDiffTarget(state: AppState, leaderSessionId: string, questId: string): DiffTargetResolution {
  const quest = findQuestById(state.quests, questId);
  const boardRow = findBoardRow(state.sessionBoards.get(leaderSessionId), questId);
  const completedBoardRow = findBoardRow(state.sessionCompletedBoards.get(leaderSessionId), questId);
  const rowStatus = findRowStatus(state.sessionBoardRowStatuses.get(leaderSessionId), questId);
  const candidate = resolveWorkerCandidate(rowStatus?.worker, boardRow ?? completedBoardRow, quest);
  const title = `Show ${questId} worker diff`;

  if (!candidate.sessionId && candidate.sessionNum == null) {
    return {
      kind: "unavailable",
      source: "quest-worker",
      questId,
      label: `${questId} worker diff unavailable`,
      title,
      message: `No worker session is assigned to ${questId}.`,
    };
  }

  const worker = findSessionByCandidate(state, candidate);
  if (!worker.sessionId) {
    return {
      kind: "unavailable",
      source: "quest-worker",
      questId,
      label: `${questId} worker diff unavailable`,
      title,
      message: `The worker session for ${questId} is not available in this browser state.`,
    };
  }

  const sessionVm = coalesceSessionViewModel(worker.session, worker.sdkSession);
  const workerLabel = formatWorkerLabel(candidate, worker.sessionId);
  const stateWarning = worker.sdkSession?.archived
    ? "Worker session is archived."
    : candidate.status === "archived"
      ? "Worker session is archived."
      : candidate.status === "disconnected"
        ? "Worker session is disconnected."
        : undefined;

  if (!sessionVm?.cwd) {
    return {
      kind: "unavailable",
      source: "quest-worker",
      questId,
      label: `${questId} worker diff unavailable`,
      title,
      message: `${workerLabel} does not have a working directory available for diff inspection.`,
    };
  }

  return {
    kind: "session",
    source: "quest-worker",
    sessionId: worker.sessionId,
    questId,
    label: `${questId} worker diff${workerLabel ? ` (${workerLabel})` : ""}`,
    title,
    warning: stateWarning,
  };
}

function isQuestThreadKey(threadKey: string): boolean {
  return /^q-\d+$/i.test(threadKey);
}

function isLeaderSession(state: AppState, sessionId: string): boolean {
  return (
    state.sessions.get(sessionId)?.isOrchestrator === true ||
    state.sdkSessions.some((session) => session.sessionId === sessionId && session.isOrchestrator === true)
  );
}

function findQuestById(quests: QuestmasterTask[], questId: string): QuestmasterTask | undefined {
  const normalizedQuestId = questId.toLowerCase();
  return quests.find((quest) => quest.questId.toLowerCase() === normalizedQuestId);
}

function findBoardRow(rows: BoardRowData[] | undefined, questId: string): BoardRowData | undefined {
  const normalizedQuestId = questId.toLowerCase();
  return rows?.find((row) => row.questId.toLowerCase() === normalizedQuestId);
}

function findRowStatus(
  statuses: Record<string, BoardRowSessionStatus> | undefined,
  questId: string,
): BoardRowSessionStatus | undefined {
  return statuses?.[questId] ?? statuses?.[questId.toLowerCase()];
}

function resolveWorkerCandidate(
  rowWorker: BoardParticipantStatus | undefined,
  boardRow: BoardRowData | undefined,
  quest: QuestmasterTask | undefined,
): WorkerCandidate {
  if (rowWorker) {
    return {
      sessionId: rowWorker.sessionId,
      sessionNum: rowWorker.sessionNum,
      name: rowWorker.name,
      status: rowWorker.status,
    };
  }
  if (boardRow?.worker || boardRow?.workerNum != null) {
    return { sessionId: boardRow.worker, sessionNum: boardRow.workerNum };
  }
  if (quest?.status === "in_progress") {
    return { sessionId: quest.sessionId };
  }
  return {};
}

function findSessionByCandidate(
  state: AppState,
  candidate: WorkerCandidate,
): { sessionId: string | null; session?: SessionState; sdkSession?: SdkSessionInfo } {
  const sdkSession = candidate.sessionId
    ? state.sdkSessions.find((session) => session.sessionId === candidate.sessionId)
    : candidate.sessionNum != null
      ? state.sdkSessions.find((session) => session.sessionNum === candidate.sessionNum)
      : undefined;
  const sessionEntry =
    candidate.sessionId && state.sessions.has(candidate.sessionId)
      ? ([candidate.sessionId, state.sessions.get(candidate.sessionId)] as const)
      : undefined;
  const sessionId = sdkSession?.sessionId ?? sessionEntry?.[0] ?? null;
  return {
    sessionId,
    session: sessionEntry?.[1],
    sdkSession,
  };
}

function formatWorkerLabel(candidate: WorkerCandidate, sessionId: string): string {
  const parts: string[] = [];
  if (candidate.sessionNum != null) parts.push(`#${candidate.sessionNum}`);
  if (candidate.name) parts.push(candidate.name);
  return parts.join(" ") || sessionId.slice(0, 8);
}
