import type { BoardListFields, BoardRow, BoardRowSessionStatus, BrowserIncomingMessage } from "../session-types.js";
import { versionsFor, type KeyedListSync, type KeyedListVersions } from "./keyed-list-versions.js";

type BoardUpdate = Extract<BrowserIncomingMessage, { type: "board_updated" }>;

type StatusEntry = [string, BoardRowSessionStatus];

/** Board lists browsers may hold stay usable for about this many changes, to cover a phone away for a while. */
const RECENT_BOARD_VERSIONS = 16;

const completedBoardVersions = new WeakMap<object, KeyedListVersions<BoardRow>>();

const rowStatusVersions = new WeakMap<object, KeyedListVersions<StatusEntry>>();

/** Hashes of the board lists a browser named as held. */
export interface HeldBoardLists {
  completed_board?: string;
  row_session_statuses?: string;
}

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
 * The completed board and row statuses for one browser holding the lists
 * named in `held` (a subscribe or a resync): each left out when the browser
 * holds the current one, as changes when it holds a recent one, else whole.
 * On a busy leader the completed board is hundreds of KB, and between two
 * visits usually only a finished quest or two changed it.
 */
export function boardListFields(
  session: object,
  completedBoard: readonly BoardRow[],
  rowSessionStatuses: Record<string, BoardRowSessionStatus>,
  held: HeldBoardLists | undefined,
): BoardListFields {
  return {
    ...completedBoardFields(
      versionsFor(completedBoardVersions, session, (row) => row.questId, RECENT_BOARD_VERSIONS).sync(
        browserBoardRows(completedBoard),
        held?.completed_board,
      ),
    ),
    ...rowStatusFields(
      versionsFor(rowStatusVersions, session, ([questId]) => questId, RECENT_BOARD_VERSIONS).sync(
        Object.entries(rowSessionStatuses),
        held?.row_session_statuses,
      ),
    ),
  };
}

/**
 * A board update for a session's browsers, with its completed board and row
 * statuses sent as what changed since the session's previous update: every
 * socket holds that copy, from that update or its subscribe. A socket holding
 * another copy asks for the lists again. Most updates only change the active
 * board, and the completed board is the larger part by far.
 */
export function projectBoardUpdateForBrowsers(session: object, update: BoardUpdate): BoardUpdate {
  const { completedBoard, rowSessionStatuses, ...rest } = update;
  return {
    ...rest,
    board: browserBoardRows(update.board),
    ...(completedBoard
      ? completedBoardFields(
          versionsFor(completedBoardVersions, session, (row) => row.questId, RECENT_BOARD_VERSIONS).broadcast(
            browserBoardRows(completedBoard),
          ),
        )
      : {}),
    ...(rowSessionStatuses
      ? rowStatusFields(
          versionsFor(rowStatusVersions, session, ([questId]) => questId, RECENT_BOARD_VERSIONS).broadcast(
            Object.entries(rowSessionStatuses),
          ),
        )
      : {}),
  };
}
function completedBoardFields(sync: KeyedListSync<BoardRow>): BoardListFields {
  return {
    completedBoardHash: sync.hash,
    ...(sync.list ? { completedBoard: sync.list } : {}),
    ...(sync.delta ? { completedBoardDelta: sync.delta } : {}),
  };
}
function rowStatusFields(sync: KeyedListSync<StatusEntry>): BoardListFields {
  return {
    rowSessionStatusesHash: sync.hash,
    ...(sync.list ? { rowSessionStatuses: Object.fromEntries(sync.list) } : {}),
    ...(sync.delta ? { rowSessionStatusesDelta: sync.delta } : {}),
  };
}
