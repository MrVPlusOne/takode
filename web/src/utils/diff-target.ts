import type { AppState } from "../store-types.js";
import { resolveChatSessionNavigationSummary } from "./chat-session-navigation-summary.js";
import { buildSessionQuestBannerRow, findQuestBoardContext } from "./session-quest-banner-row.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

// Store mocks and early renders may lack board state.
const EMPTY_MAP = new Map<string, never>();

/**
 * Which diff a session's diff chip opens. A quest target shows the quest's recorded code commits and,
 * when a worker session belongs to it, that worker's own changes. There is no fallback between targets:
 * a quest without a worker shows only its commits, never the leader's diff.
 */
export type DiffTargetResolution =
  | {
      kind: "session";
      source: "current-session" | "leader";
      sessionId: string;
      label: string;
      title: string;
    }
  | {
      kind: "quest";
      questId: string;
      /** Session whose working diff belongs to the quest: the session itself for workers, the active board worker for leaders. */
      workerSessionId: string | null;
      /** Whether the changes are the viewing session's own or a worker's seen from its leader. */
      changesOwner: "self" | "worker";
      label: string;
      title: string;
    };

export function resolveDiffTarget(
  state: AppState,
  currentSessionId: string | null | undefined,
  threadKey: string | null | undefined,
): DiffTargetResolution | null {
  if (!currentSessionId) return null;
  if (!isLeaderSession(state, currentSessionId)) {
    const questId = sessionQuestId(state, currentSessionId);
    return questId
      ? questDiffTarget(questId, currentSessionId, "self")
      : {
          kind: "session",
          source: "current-session",
          sessionId: currentSessionId,
          label: "Session diff",
          title: "Show changes",
        };
  }

  const normalizedThreadKey = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
  if (
    normalizedThreadKey === MAIN_THREAD_KEY ||
    normalizedThreadKey === ALL_THREADS_KEY ||
    !isQuestThreadKey(normalizedThreadKey)
  ) {
    return {
      kind: "session",
      source: "leader",
      sessionId: currentSessionId,
      label: "Leader diff",
      title: "Show leader changes",
    };
  }
  return questDiffTarget(
    normalizedThreadKey,
    activeBoardWorker(state, currentSessionId, normalizedThreadKey),
    "worker",
  );
}

export function diffTargetSessionId(target: DiffTargetResolution | null): string | null {
  if (!target) return null;
  return target.kind === "session" ? target.sessionId : target.workerSessionId;
}

function questDiffTarget(
  questId: string,
  workerSessionId: string | null,
  changesOwner: "self" | "worker",
): DiffTargetResolution {
  return {
    kind: "quest",
    questId,
    workerSessionId,
    changesOwner,
    label: `${questId} diff`,
    title: `Show ${questId} commits and changes`,
  };
}

/** The same quest the session's quest banner shows. */
function sessionQuestId(state: AppState, sessionId: string): string | null {
  const summary = resolveChatSessionNavigationSummary(state, sessionId);
  const row = buildSessionQuestBannerRow({
    sessionId,
    sessionNum: summary.sessionNum,
    claimedQuestId: summary.claimedQuestId,
    claimedQuestTitle: summary.claimedQuestTitle,
    claimedQuestStatus: summary.claimedQuestStatus,
    claimedQuestLeaderSessionId: summary.claimedQuestLeaderSessionId,
    herdedBy: summary.herdedBy,
    quests: state.quests ?? [],
    sessionBoards: state.sessionBoards ?? EMPTY_MAP,
    sessionCompletedBoards: state.sessionCompletedBoards ?? EMPTY_MAP,
    rowStatuses: state.sessionBoardRowStatuses ?? EMPTY_MAP,
  });
  return row?.questId ?? null;
}

/**
 * Only an active board row ties a worker's current diff to the quest. A completed quest's worker may have
 * moved on to other work, so its diff no longer belongs to that quest.
 */
function activeBoardWorker(state: AppState, leaderSessionId: string, questId: string): string | null {
  const { row, rowStatus } = findQuestBoardContext({
    questId,
    leaderSessionId,
    sessionBoards: new Map([[leaderSessionId, state.sessionBoards?.get(leaderSessionId) ?? []]]),
    sessionCompletedBoards: new Map(),
    rowStatuses: state.sessionBoardRowStatuses ?? EMPTY_MAP,
  });
  if (!row || row.completedAt !== undefined) return null;
  return row.worker ?? rowStatus?.worker?.sessionId ?? null;
}

function isQuestThreadKey(threadKey: string): boolean {
  return /^q-\d+$/i.test(threadKey);
}

function isLeaderSession(state: AppState, sessionId: string): boolean {
  return (
    state.sessions?.get(sessionId)?.isOrchestrator === true ||
    !!state.sdkSessions?.some((session) => session.sessionId === sessionId && session.isOrchestrator === true)
  );
}
