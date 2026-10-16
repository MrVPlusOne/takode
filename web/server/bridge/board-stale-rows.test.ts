import { describe, expect, it, vi } from "vitest";
import { getBoardQueueWarnings } from "./board-watchdog-controller.js";
import { preferRowsOnRunningLeaders } from "./board-stale-rows.js";
import { getBoardWatchdogDeps } from "../ws-bridge-deps.js";

function leader(id: string, rows: Array<Record<string, unknown>>, paused = false) {
  return {
    id,
    state: { pause: paused ? { pausedAt: 1, queuedMessages: [] } : null },
    board: new Map(rows.map((row) => [row.questId as string, { createdAt: 1, updatedAt: 1, ...row }])),
    completedBoard: new Map(),
    boardDispatchStates: new Map(),
    boardStallStates: new Map(),
  };
}

describe("preferRowsOnRunningLeaders", () => {
  const stopped = new Set(["paused"]);
  const isStopped = (id: string) => stopped.has(id);

  it("drops rows on stopped leaders when a running leader also has one", () => {
    const rows = [{ leaderSessionId: "paused" }, { leaderSessionId: "running" }];
    expect(preferRowsOnRunningLeaders(rows, isStopped)).toEqual([{ leaderSessionId: "running" }]);
  });

  it("keeps a stopped leader's rows when no running leader has the quest", () => {
    // Its worker can still finish while the leader is paused; that row keeps governing.
    const rows = [{ leaderSessionId: "paused" }];
    expect(preferRowsOnRunningLeaders(rows, isStopped)).toEqual(rows);
  });
});

describe("cross-leader wait-for dependencies", () => {
  // Leader A waits for q-1, which leader B carries in Memory (not blocking).
  // A paused leader C was left with q-1 at an obsolete User Checkpoint.
  function setup(cPaused: boolean) {
    const sessions = new Map([
      ["a", leader("a", [{ questId: "q-2", status: "QUEUED", waitFor: ["q-1"] }])],
      ["b", leader("b", [{ questId: "q-1", status: "MEMORY" }])],
      ["c", leader("c", [{ questId: "q-1", status: "USER_CHECKPOINTING" }], cPaused)],
    ]);
    const launcherInfo = new Map(
      ["a", "b", "c"].map((id, index) => [id, { sessionId: id, sessionNum: index + 1, isOrchestrator: true }]),
    );
    const deps = getBoardWatchdogDeps({
      sessions,
      launcher: { getSession: (id: string) => launcherInfo.get(id), listSessions: () => [...launcherInfo.values()] },
      getSessionNotificationDeps: () => ({}),
      emitTakodeEvent: vi.fn(),
    });
    return getBoardQueueWarnings(sessions.get("a"), deps as any);
  }

  it("ignores the row left on a paused leader", () => {
    expect(setup(true)).toEqual([expect.objectContaining({ questId: "q-2", kind: "dispatchable" })]);
  });

  it("still waits while that leader is running", () => {
    expect(setup(false)).toEqual([]);
  });
});
