import { describe, expect, it } from "vitest";
import type { BoardListFields, BoardRow } from "../session-types.js";
import { receiveSyncedList } from "../../src/utils/synced-lists.js";
import { boardListFields, browserBoardRows, projectBoardUpdateForBrowsers } from "./browser-board-rows.js";

// Every work-board change used to re-send the whole completed board, hundreds of
// KB on a busy leader, most of it debrief text browsers never read. Browsers now
// get rows without the parked completion, and the completed board only as what
// changed since a copy they hold.

function row(questId: string, extra: Partial<BoardRow> = {}): BoardRow {
  return { questId, title: questId, createdAt: 1, updatedAt: 1, ...extra } as BoardRow;
}

const LANDED = row("q-1", {
  completedAt: 2,
  landing: {
    entryId: "e-1",
    workerSessionId: "w",
    workPhaseOccurrenceId: "o",
    branch: "main",
    tip: "abc",
    outcome: "landed",
    completion: { verificationItems: [], debrief: "Long debrief", debriefTldr: "TLDR", completedAt: 2 },
  },
});

function update(board: BoardRow[], completedBoard: BoardRow[]) {
  return { type: "board_updated" as const, board, completedBoard, rowSessionStatuses: {} };
}

describe("browserBoardRows", () => {
  it("drops only the parked completion and leaves other rows untouched", () => {
    const plain = row("q-2");
    const [stripped, same] = browserBoardRows([LANDED, plain]);
    expect(stripped.landing).toEqual({ ...LANDED.landing, completion: undefined });
    expect(stripped.landing).not.toHaveProperty("completion");
    expect(same).toBe(plain);
    // The stored row keeps its completion for the server to apply.
    expect(LANDED.landing?.completion?.debrief).toBe("Long debrief");
  });
});

/** The completed board a browser ends with after a board message, through its real receiving code. */
function receiveCompletedBoard(browser: string, fields: BoardListFields): BoardRow[] | null {
  return receiveSyncedList(
    "completed_board",
    browser,
    JSON.parse(
      JSON.stringify({
        list: fields.completedBoard,
        delta: fields.completedBoardDelta,
        hash: fields.completedBoardHash,
      }),
    ),
    (row: BoardRow) => row.questId,
  );
}

describe("projectBoardUpdateForBrowsers", () => {
  it("sends the completed board as what changed since the session's previous update", () => {
    const session = {};
    const first = projectBoardUpdateForBrowsers(session, update([row("q-3")], [LANDED]));
    expect(first.completedBoard).toEqual(browserBoardRows([LANDED]));

    expect(receiveCompletedBoard("live", first)).toEqual(browserBoardRows([LANDED]));

    // An active-board change with the same completed board names it by hash only.
    const second = projectBoardUpdateForBrowsers(session, update([row("q-3", { updatedAt: 5 })], [LANDED]));
    expect(second).not.toHaveProperty("completedBoard");
    expect(second).not.toHaveProperty("completedBoardDelta");
    expect(second.board).toEqual([row("q-3", { updatedAt: 5 })]);

    expect(receiveCompletedBoard("live", second)).toEqual(browserBoardRows([LANDED]));

    // A quest finishing adds its row first: only that row travels, with the order.
    const done = row("q-3", { completedAt: 6 });
    const third = projectBoardUpdateForBrowsers(session, update([], [done, LANDED]));
    expect(third).not.toHaveProperty("completedBoard");
    expect(third.completedBoardDelta).toMatchObject({
      upserts: [done],
      removed: [],
      order: ["q-3", "q-1"],
    });
    expect(receiveCompletedBoard("live", third)).toEqual(browserBoardRows([done, LANDED]));
  });

  it("sends a returning browser only what changed since the copy it names, and a stale one the whole board", () => {
    const session = {};
    const rows = [row("q-1"), row("q-2")];
    const before = boardListFields(session, rows, {}, undefined);
    expect(receiveCompletedBoard("phone", before)).toEqual(rows);

    const after = [row("q-4"), row("q-1"), row("q-2", { title: "renamed" })];
    const statuses = { "q-4": { worker: { status: "running" } } } as never;
    const fields = boardListFields(session, after, statuses, {
      completed_board: before.completedBoardHash,
    });
    expect(fields.completedBoard).toBeUndefined();
    expect(fields.completedBoardDelta?.upserts).toEqual([after[0], after[2]]);
    expect(receiveCompletedBoard("phone", fields)).toEqual(after);
    expect(boardListFields(session, after, statuses, { completed_board: "unknown" }).completedBoard).toEqual(after);
  });

  it("tracks each session separately", () => {
    const leaderA = {};
    const leaderB = {};
    projectBoardUpdateForBrowsers(leaderA, update([], [LANDED]));
    expect(projectBoardUpdateForBrowsers(leaderB, update([], [LANDED])).completedBoard).toBeDefined();
  });
});
