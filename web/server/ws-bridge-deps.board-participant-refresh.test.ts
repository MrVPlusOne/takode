import { describe, expect, it, vi } from "vitest";
import { broadcastGlobalWithBoardParticipantRefresh } from "./ws-bridge-deps.js";

function makeHost() {
  const leader = {
    id: "leader-1",
    state: {},
    board: new Map([
      [
        "q-1761",
        {
          questId: "q-1761",
          title: "Restore reviewer chip",
          worker: "worker-1",
          workerNum: 2402,
          status: "CODE_REVIEWING",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    ]),
    completedBoard: new Map(),
  };
  const reviewer = { id: "reviewer-1", state: {}, board: new Map(), completedBoard: new Map() };
  const rowSessionStatuses = {
    "q-1761": {
      worker: { sessionId: "worker-1", sessionNum: 2402, status: "idle" },
      reviewer: { sessionId: "reviewer-1", sessionNum: 2403, status: "running" },
    },
  };
  return {
    leader,
    host: {
      sessions: new Map([
        [leader.id, leader],
        [reviewer.id, reviewer],
      ]),
      broadcastToBrowsers: vi.fn(),
      getBoardRowSessionStatuses: vi.fn(() => rowSessionStatuses),
    },
  };
}

describe("broadcastGlobalWithBoardParticipantRefresh", () => {
  // Reviewer lifecycle events do not mutate the Work Board row itself. Each event
  // must therefore republish the server-computed participant projection.
  it.each([
    "session_created",
    "session_archived",
    "session_deleted",
  ] as const)("refreshes server-authored board participant statuses after %s", (type) => {
    const { host, leader } = makeHost();

    broadcastGlobalWithBoardParticipantRefresh(host, { type, session_id: "reviewer-1" });

    expect(host.broadcastToBrowsers).toHaveBeenCalledWith(
      leader,
      expect.objectContaining({
        type: "board_updated",
        board: [expect.objectContaining({ questId: "q-1761", workerNum: 2402 })],
        rowSessionStatuses: {
          "q-1761": expect.objectContaining({
            reviewer: expect.objectContaining({ sessionId: "reviewer-1", sessionNum: 2403 }),
          }),
        },
      }),
    );
  });

  it("does not rebroadcast board state for unrelated global messages", () => {
    const { host } = makeHost();

    broadcastGlobalWithBoardParticipantRefresh(host, { type: "quest_list_updated" });

    expect(host.broadcastToBrowsers).toHaveBeenCalledTimes(2);
    expect(host.getBoardRowSessionStatuses).not.toHaveBeenCalled();
  });
});
