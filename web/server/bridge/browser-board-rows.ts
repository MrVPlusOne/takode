import type { BoardRow, BrowserIncomingMessage } from "../session-types.js";
import { snapshotPartHash } from "../../shared/snapshot-part-hash.js";

type BoardUpdate = Extract<BrowserIncomingMessage, { type: "board_updated" }>;

/** Hash of the completed board each session's browsers last received in a board update. */
const sentCompletedBoardHashes = new WeakMap<object, string>();

/**
 * Board rows as browsers receive them. A row's landing keeps final Memory's
 * parked completion (debrief, verification items) for the server to apply when
 * the change lands, and completed rows keep it afterwards; browsers never read
 * it, and on a busy leader it was most of the completed board's bytes.
 */
export function browserBoardRows(rows: readonly BoardRow[]): BoardRow[] {
  return rows.map((row) => {
    if (!row.landing?.completion) return row;
    const { completion: _completion, ...landing } = row.landing;
    return { ...row, landing };
  });
}

/**
 * A board update for a session's browsers. The completed board is left out
 * when it equals the one the previous update sent: every socket of the session
 * holds that copy, from that update or, if it subscribed later, from its state
 * snapshot, which always carries the current one or matches the browser's own.
 * Most updates only change the active board, and the completed board is the
 * larger part by far.
 */
export function projectBoardUpdateForBrowsers(session: object, update: BoardUpdate): BoardUpdate {
  const board = browserBoardRows(update.board);
  if (!update.completedBoard) return { ...update, board };
  const completedBoard = browserBoardRows(update.completedBoard);
  const hash = snapshotPartHash(completedBoard);
  if (sentCompletedBoardHashes.get(session) === hash) {
    const { completedBoard: _unchanged, ...rest } = update;
    return { ...rest, board };
  }
  sentCompletedBoardHashes.set(session, hash);
  return { ...update, board, completedBoard };
}
