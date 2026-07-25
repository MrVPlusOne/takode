import type { AppState } from "../store-types.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "./thread-projection.js";

export type DiffTargetResolution =
  | {
      kind: "session";
      source: "current-session" | "leader";
      sessionId: string;
      label: string;
      title: string;
    }
  | {
      kind: "quest-commits";
      source: "quest-commits";
      questId: string;
      label: string;
      title: string;
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

  return resolveQuestCommitDiffTarget(normalizedThreadKey);
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

function resolveQuestCommitDiffTarget(questId: string): DiffTargetResolution {
  return {
    kind: "quest-commits",
    source: "quest-commits",
    questId,
    label: `${questId} recorded commits`,
    title: `Show ${questId} recorded commits`,
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
