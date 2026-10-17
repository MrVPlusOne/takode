import { describe, expect, it } from "vitest";
import type { BoardRow } from "../session-types.js";
import { browserBoardRows, projectBoardUpdateForBrowsers } from "./browser-board-rows.js";

// Every work-board change used to re-send the whole completed board, hundreds of
// KB on a busy leader, most of it debrief text browsers never read. Browsers now
// get rows without the parked completion, and the completed board only when it
// changed since the session's previous board update.

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

describe("projectBoardUpdateForBrowsers", () => {
  it("sends the completed board only when it changed since the session's previous update", () => {
    const session = {};
    const first = projectBoardUpdateForBrowsers(session, update([row("q-3")], [LANDED]));
    expect(first.completedBoard).toEqual(browserBoardRows([LANDED]));

    // An active-board change with the same completed board leaves it out.
    const second = projectBoardUpdateForBrowsers(session, update([row("q-3", { updatedAt: 5 })], [LANDED]));
    expect(second).not.toHaveProperty("completedBoard");
    expect(second.board).toEqual([row("q-3", { updatedAt: 5 })]);

    // A quest finishing changes the completed board, so it is sent again.
    const done = row("q-3", { completedAt: 6 });
    const third = projectBoardUpdateForBrowsers(session, update([], [done, LANDED]));
    expect(third.completedBoard).toEqual(browserBoardRows([done, LANDED]));
  });

  it("tracks each session separately", () => {
    const leaderA = {};
    const leaderB = {};
    projectBoardUpdateForBrowsers(leaderA, update([], [LANDED]));
    expect(projectBoardUpdateForBrowsers(leaderB, update([], [LANDED])).completedBoard).toBeDefined();
  });
});
