import { describe, expect, it, vi } from "vitest";
import { WsBridgeSyncedProjectionController } from "./ws-bridge-synced-projections.js";

function leaderSession(id: string, openThreadKeys: string[]) {
  return {
    id,
    state: {
      backend_type: "claude",
      isOrchestrator: true,
      leaderOpenThreadTabs: {
        version: 1,
        orderedOpenThreadKeys: openThreadKeys,
        closedThreadTombstones: [],
        updatedAt: 1,
      },
    },
    board: new Map(),
    completedBoard: new Map(),
    attentionRecords: [],
    notifications: [],
    messageHistory: [],
    searchDataOnly: false,
  } as any;
}

function controllerFor(sessions: Map<string, any>, persistSession = vi.fn()) {
  return new WsBridgeSyncedProjectionController({
    getSession: (sessionId) => sessions.get(sessionId),
    listSessions: () => sessions.values(),
    getLauncherSessionInfo: () => null,
    getSessionName: () => undefined,
    getPendingTimerCount: () => 0,
    getWaitingFor: () => null,
    getBackendConnected: () => false,
    getSessionStatus: () => null,
    getLastActivityAt: () => undefined,
    getLastUserMessageAt: () => undefined,
    getLastMessagePreviewAt: () => undefined,
    persistSession,
  });
}

describe("closeLeaderThreadTab", () => {
  it("closes another leader's closable tab through the tab close command", () => {
    // The attention lists close tabs of leaders the browser is not viewing;
    // the result must match the tab's own close button: removed and persisted.
    const leader = leaderSession("leader", ["q-1", "q-2"]);
    const persist = vi.fn();
    const controller = controllerFor(new Map([[leader.id, leader]]), persist);

    expect(controller.closeLeaderThreadTab("leader", "Q-1")).toBe("closed");
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-2"]);
    expect(persist).toHaveBeenCalledWith(leader);
  });

  it("keeps a tab whose quest is active, and reports tabs that are not open or not a leader's", () => {
    // The server decides closability, so a stale menu cannot close active work.
    const leader = leaderSession("leader", ["q-1"]);
    leader.board.set("q-1", { questId: "q-1", title: "Active", status: "WORKING", createdAt: 1, updatedAt: 1 });
    const worker = { ...leaderSession("worker", ["q-1"]), state: { backend_type: "claude", isOrchestrator: false } };
    const persist = vi.fn();
    const controller = controllerFor(
      new Map([
        [leader.id, leader],
        [worker.id, worker],
      ]),
      persist,
    );

    expect(controller.closeLeaderThreadTab("leader", "q-1")).toBe("not-closable");
    expect(controller.closeLeaderThreadTab("leader", "q-9")).toBe("not-open");
    expect(controller.closeLeaderThreadTab("leader", "main")).toBe("not-open");
    expect(controller.closeLeaderThreadTab("worker", "q-1")).toBe("not-found");
    expect(controller.closeLeaderThreadTab("missing", "q-1")).toBe("not-found");
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-1"]);
    expect(persist).not.toHaveBeenCalled();
  });
});
