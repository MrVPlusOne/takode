import { isSessionPaused, type PauseableSession } from "../session-pause.js";
import type { BoardRow, BoardRowStaleRemoval } from "../session-types.js";
import { commitBoard, moveBoardRowToCompleted, type WorkBoardStateDeps } from "./board-watchdog-controller.js";

/**
 * A stopped leader cannot change its own board: it is archived, or paused with
 * its input held. Its rows may be left behind at an obsolete phase.
 */
export function isBoardLeaderStopped(
  launcherInfo: { archived?: boolean } | null | undefined,
  session: PauseableSession | null | undefined,
): boolean {
  return launcherInfo?.archived === true || isSessionPaused(session);
}

/**
 * Rows for one quest gathered across leaders' boards. Rows on stopped leaders'
 * boards count only when no running leader has a row for the quest, so a row
 * left behind on a paused or archived leader never blocks a running leader,
 * while a stopped leader's only row keeps its usual guards.
 */
export function preferRowsOnRunningLeaders<T extends { leaderSessionId: string }>(
  rows: T[],
  isLeaderStopped: (leaderSessionId: string) => boolean,
): T[] {
  const running = rows.filter((row) => !isLeaderStopped(row.leaderSessionId));
  return running.length > 0 ? running : rows;
}

/**
 * Move a stale row from a stopped leader's board into its board history with
 * the removal recorded on it. Unlike `board rm`, the quest did not finish
 * there, so this records no completion and leaves the leader's other rows'
 * wait-for dependencies alone. Returns null when the board has no such row.
 */
export function removeStaleBoardRow(
  session: any,
  questId: string,
  removal: BoardRowStaleRemoval,
  deps: WorkBoardStateDeps,
): BoardRow | null {
  const boardQuestId = [...session.board.keys()].find(
    (candidate: string) => candidate.toLowerCase() === questId.toLowerCase(),
  );
  const row: BoardRow | undefined = boardQuestId ? session.board.get(boardQuestId) : undefined;
  if (!boardQuestId || !row) return null;
  // The row's linked prompts belong to the obsolete checkpoint it was left at.
  const linkedNotificationIds = row.waitForInput ?? [];
  row.waitFor = undefined;
  row.waitForInput = undefined;
  row.staleRemoval = removal;
  session.boardStallStates?.delete(boardQuestId);
  const removed = moveBoardRowToCompleted(session, boardQuestId);
  for (const notificationId of linkedNotificationIds) deps.markNotificationDone(session.id, notificationId, true);
  commitBoard(session, deps, [boardQuestId]);
  return removed;
}
