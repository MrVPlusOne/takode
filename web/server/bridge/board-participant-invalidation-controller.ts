import { buildLeaderActivePhaseSummary } from "../../shared/leader-active-phase-summary.js";
import type { BoardRow, BrowserIncomingMessage } from "../session-types.js";
import { getBoardForSession, getCompletedBoardForSession } from "./board-watchdog-controller.js";
import type { Session } from "./ws-bridge-session.js";

const INVALIDATION_DELAY_MS = 50;
const REVIEWER_LIFECYCLE_TYPES = new Set(["session_created", "session_archived", "session_deleted"]);

type ReviewerLifecycleMessage = Extract<
  BrowserIncomingMessage,
  { type: "session_created" | "session_archived" | "session_deleted" }
>;

type PendingInvalidationState = {
  byLeader: Map<string, Map<string, number | string>>;
  timer: ReturnType<typeof setTimeout> | null;
};

const pendingInvalidations = new WeakMap<object, PendingInvalidationState>();

function lifecycleRelation(host: any, msg: ReviewerLifecycleMessage) {
  const launcherSession = host.launcher?.getSession?.(msg.session_id);
  const relation = msg as ReviewerLifecycleMessage & { reviewerOf?: number; herdedBy?: string };
  const reviewerOf = launcherSession?.reviewerOf ?? relation.reviewerOf;
  const leaderSessionId = launcherSession?.herdedBy ?? relation.herdedBy;
  if (typeof reviewerOf !== "number" || typeof leaderSessionId !== "string" || !leaderSessionId) return null;
  return { reviewerOf, leaderSessionId };
}

function effectiveBoardWorkerNum(host: any, row: BoardRow): number | undefined {
  const resolvedWorkerNum = row.worker ? host.launcher?.getSession?.(row.worker)?.sessionNum : undefined;
  return typeof resolvedWorkerNum === "number" ? resolvedWorkerNum : row.workerNum;
}

function matchingActiveRows(host: any, leaderSessionId: string, reviewerOf: number): BoardRow[] {
  return getBoardForSession(host.sessions, leaderSessionId).filter(
    (row) => effectiveBoardWorkerNum(host, row) === reviewerOf,
  );
}

function matchingWorkerRows(
  host: any,
  leaderSessionId: string,
  workerSessionId: string,
  workerNum?: number,
): BoardRow[] {
  return getBoardForSession(host.sessions, leaderSessionId).filter((row) => {
    if (row.worker === workerSessionId) return true;
    return typeof workerNum === "number" && effectiveBoardWorkerNum(host, row) === workerNum;
  });
}

function flushPendingInvalidations(host: any, state: PendingInvalidationState): void {
  state.timer = null;
  const pending = [...state.byLeader.entries()];
  state.byLeader.clear();

  for (const [leaderSessionId, questWorkers] of pending) {
    const session = host.sessions.get(leaderSessionId) as Session | undefined;
    if (!session) continue;
    const board = getBoardForSession(host.sessions, leaderSessionId);
    const stillRelevant = board.some(
      (row) =>
        questWorkers.get(row.questId.toLowerCase()) === effectiveBoardWorkerNum(host, row) ||
        questWorkers.get(row.questId.toLowerCase()) === row.worker,
    );
    if (!stillRelevant) continue;
    const completedBoard = getCompletedBoardForSession(host.sessions, leaderSessionId);
    host.broadcastToBrowsers(
      session,
      {
        type: "board_updated",
        board,
        completedBoard,
        ...(session.state?.leaderOpenThreadTabs ? { leaderOpenThreadTabs: session.state.leaderOpenThreadTabs } : {}),
        leaderActivePhaseSummary: buildLeaderActivePhaseSummary(board),
        rowSessionStatuses: host.getBoardRowSessionStatuses(leaderSessionId, board, completedBoard),
      },
      { skipBuffer: true, skipGlobalActivity: true },
    );
  }
}

function scheduleRelationInvalidation(host: any, leaderSessionId: string, reviewerOf: number): void {
  const rows = matchingActiveRows(host, leaderSessionId, reviewerOf);
  if (rows.length === 0) return;

  let state = pendingInvalidations.get(host);
  if (!state) {
    state = { byLeader: new Map(), timer: null };
    pendingInvalidations.set(host, state);
  }
  const questWorkers = state.byLeader.get(leaderSessionId) ?? new Map<string, number | string>();
  for (const row of rows) questWorkers.set(row.questId.toLowerCase(), reviewerOf);
  state.byLeader.set(leaderSessionId, questWorkers);
  if (state.timer) return;
  state.timer = setTimeout(() => flushPendingInvalidations(host, state!), INVALIDATION_DELAY_MS);
  const timerWithUnref = state.timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  timerWithUnref.unref?.();
}

export function scheduleBoardParticipantRefreshForSession(host: any, participantSessionId: string): void {
  const launcherSession = host.launcher?.getSession?.(participantSessionId);
  const leaderSessionId = launcherSession?.herdedBy;
  if (typeof leaderSessionId !== "string" || !leaderSessionId) return;
  const workerNum = typeof launcherSession?.sessionNum === "number" ? launcherSession.sessionNum : undefined;
  const rows = matchingWorkerRows(host, leaderSessionId, participantSessionId, workerNum);
  if (rows.length === 0) return;

  let state = pendingInvalidations.get(host);
  if (!state) {
    state = { byLeader: new Map(), timer: null };
    pendingInvalidations.set(host, state);
  }
  const questWorkers = state.byLeader.get(leaderSessionId) ?? new Map<string, number | string>();
  for (const row of rows) {
    const rowWorkerNum = effectiveBoardWorkerNum(host, row);
    questWorkers.set(row.questId.toLowerCase(), typeof rowWorkerNum === "number" ? rowWorkerNum : participantSessionId);
  }
  state.byLeader.set(leaderSessionId, questWorkers);
  if (state.timer) return;
  state.timer = setTimeout(() => flushPendingInvalidations(host, state!), INVALIDATION_DELAY_MS);
  const timerWithUnref = state.timer as ReturnType<typeof setTimeout> & { unref?: () => void };
  timerWithUnref.unref?.();
}

export function broadcastGlobalAndScheduleBoardParticipantRefresh(host: any, msg: BrowserIncomingMessage): void {
  for (const session of host.sessions.values() as Iterable<Session>) {
    host.broadcastToBrowsers(session, msg, { skipBuffer: true });
  }
  if (!REVIEWER_LIFECYCLE_TYPES.has(msg.type)) return;
  const relation = lifecycleRelation(host, msg as ReviewerLifecycleMessage);
  if (!relation) return;
  scheduleRelationInvalidation(host, relation.leaderSessionId, relation.reviewerOf);
}
