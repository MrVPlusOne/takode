import { describe, expect, it, vi } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { WsBridgeSyncedProjectionController } from "./ws-bridge-synced-projections.js";

function leaderSession(id: string, questId: string) {
  return {
    id,
    state: {
      backend_type: "claude",
      isOrchestrator: true,
      leaderOpenThreadTabs: {
        version: 1,
        orderedOpenThreadKeys: [questId],
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
    getBackendConnected: () => false,
    getSessionStatus: () => null,
    getLastActivityAt: () => undefined,
    getLastUserMessageAt: () => undefined,
    getLastMessagePreviewAt: () => undefined,
    persistSession,
  });
}

describe("leader thread tab projection invalidation", () => {
  it("ignores closed historical rows and resolved records", () => {
    const leader = leaderSession("leader", "q-2");
    leader.completedBoard.set("q-1", {
      questId: "q-1",
      title: "Historical",
      status: "MEMORY",
      createdAt: 1,
      completedAt: 2,
    });
    leader.attentionRecords.push({
      questId: "q-1",
      threadKey: "q-1",
      route: { threadKey: "q-1", questId: "q-1" },
      state: "resolved",
      type: "needs_input",
      priority: "needs_input",
    });
    leader.notifications.push({ questId: "q-1", threadKey: "q-1", done: true });
    const sessions = new Map([[leader.id, leader]]);
    const controller = controllerFor(sessions);
    const socket = { data: { kind: "browser", sessionId: "carrier" }, send: vi.fn(), readyState: 1 } as any;
    controller.replaceSubscriptions(socket, [{ projection: LEADER_THREAD_TABS_PROJECTION, key: leader.id }]);

    expect(controller.invalidateLeaderThreadTabsForQuestIds(["q-1"])).toBe(0);

    leader.attentionRecords[0].state = "unresolved";
    expect(controller.invalidateLeaderThreadTabsForQuestIds(["q-1"])).toBe(1);
  });

  it("invalidates retained leaders when an unarchived worker claim or leader row becomes visible", () => {
    const retained = leaderSession("leader-retained", "q-1");
    const worker = {
      ...leaderSession("worker", "q-9"),
      state: {
        backend_type: "claude",
        isOrchestrator: false,
        claimedQuestId: "q-1",
        claimedQuestStatus: "in_progress",
        claimedQuestLeaderSessionId: "leader-source",
      },
    };
    const sourceLeader = leaderSession("leader-source", "q-9");
    sourceLeader.board.set("q-1", {
      questId: "q-1",
      status: "WORKING",
      createdAt: 10,
      updatedAt: 10,
    });
    const sessions = new Map([
      [retained.id, retained],
      [worker.id, worker],
      [sourceLeader.id, sourceLeader],
    ]);
    const controller = controllerFor(sessions);
    const socket = { data: { kind: "browser", sessionId: "carrier" }, send: vi.fn(), readyState: 1 } as any;
    controller.replaceSubscriptions(socket, [{ projection: LEADER_THREAD_TABS_PROJECTION, key: retained.id }]);

    expect(controller.invalidateLeaderThreadTabsForSessionQuestState(worker.id)).toBe(1);
    expect(controller.invalidateLeaderThreadTabsForSessionQuestState(sourceLeader.id)).toBe(1);
  });

  it("checks subscriptions before scanning a leader for quest references", () => {
    const subscribed = leaderSession("leader-subscribed", "q-1");
    const sessions = new Map([[subscribed.id, subscribed]]);
    const controller = controllerFor(sessions);
    const socket = { data: { kind: "browser", sessionId: "carrier" }, send: vi.fn(), readyState: 1 } as any;
    controller.replaceSubscriptions(socket, [{ projection: LEADER_THREAD_TABS_PROJECTION, key: subscribed.id }]);

    let unsubscribedReferenceScans = 0;
    const unsubscribed = leaderSession("leader-unsubscribed", "q-1");
    Object.defineProperty(unsubscribed.state.leaderOpenThreadTabs, "orderedOpenThreadKeys", {
      configurable: true,
      get: () => {
        unsubscribedReferenceScans += 1;
        return ["q-1"];
      },
    });
    sessions.set(unsubscribed.id, unsubscribed);

    expect(controller.invalidateLeaderThreadTabsForQuestIds(["q-1"])).toBe(1);
    expect(unsubscribedReferenceScans).toBe(0);
  });
});

describe("leader thread tab edge promotion", () => {
  it("promotes every visible referencing leader, including unsubscribed leaders, exactly once", () => {
    const source = leaderSession("leader-source", "q-42");
    source.state.leaderOpenThreadTabs.orderedOpenThreadKeys = ["q-a", "q-42", "q-b"];
    source.state.leaderOpenThreadTabs.updatedAt = 100;
    source.board.set("q-42", {
      questId: "q-42",
      title: "Current work",
      status: "WORKING",
      createdAt: 200,
      updatedAt: 200,
      threadTabActivatedAt: 200,
    });
    const historical = leaderSession("leader-historical", "q-42");
    historical.state.leaderOpenThreadTabs.orderedOpenThreadKeys = ["q-a", "q-42", "q-b"];
    historical.state.leaderOpenThreadTabs.updatedAt = 100;
    const unrelated = leaderSession("leader-unrelated", "q-other");
    const sessions = new Map([
      [source.id, source],
      [historical.id, historical],
      [unrelated.id, unrelated],
    ]);
    const persistSession = vi.fn();
    const controller = controllerFor(sessions, persistSession);

    expect(controller.promoteLeaderThreadTabForQuest("q-42", 200, source.id)).toBe(2);
    expect(source.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-42", "q-a", "q-b"]);
    expect(historical.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-42", "q-a", "q-b"]);
    expect(unrelated.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-other"]);
    expect(persistSession.mock.calls.map(([session]) => session.id).sort()).toEqual([
      "leader-historical",
      "leader-source",
    ]);

    persistSession.mockClear();
    expect(controller.promoteLeaderThreadTabForQuest("q-42", 200, source.id)).toBe(0);
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("does not replay an older activation over a newer manual order", () => {
    const historical = leaderSession("leader-historical", "q-42");
    historical.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-a", "q-42", "q-b"],
      closedThreadTombstones: [],
      updatedAt: 300,
      explicitOrderUpdatedAt: 300,
    };
    const sessions = new Map([[historical.id, historical]]);
    const persistSession = vi.fn();
    const controller = controllerFor(sessions, persistSession);

    expect(controller.promoteLeaderThreadTabForQuest("q-42", 200, "leader-source")).toBe(0);
    expect(historical.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-a", "q-42", "q-b"]);
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("uses cross-session current scheduled state to protect a retained leader tombstone", () => {
    // The retained observer has no local row; the current queued run lives on another leader.
    const observer = leaderSession("leader-observer", "q-cross");
    observer.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: [],
      closedThreadTombstones: [{ threadKey: "q-cross", closedAt: 100 }],
      updatedAt: 100,
    };
    const currentLeader = leaderSession("leader-current", "q-other");
    currentLeader.board.set("q-cross", {
      questId: "q-cross",
      status: "QUEUED",
      createdAt: 200,
      updatedAt: 200,
    });
    const sessions = new Map([
      [observer.id, observer],
      [currentLeader.id, currentLeader],
    ]);
    const persistSession = vi.fn();
    const controller = controllerFor(sessions, persistSession);

    expect(controller.getLeaderThreadTabMutationPolicy(observer.id, "q-cross")).toMatchObject({
      scheduled: true,
      neverStartedScheduled: true,
      canClose: true,
    });
    expect(controller.promoteLeaderThreadTabForAttention(observer.id, "q-cross", 300, "review")).toBe(false);
    expect(observer.state.leaderOpenThreadTabs.closedThreadTombstones).toEqual([
      { threadKey: "q-cross", closedAt: 100 },
    ]);
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("promotes completed tabs while keeping never-started schedules low and closed", () => {
    const leader = leaderSession("leader-attention", "q-42");
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-43", "q-42"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    leader.board.set("q-43", {
      questId: "q-43",
      status: "QUEUED",
      createdAt: 50,
      updatedAt: 50,
    });
    leader.completedBoard.set("q-42", {
      questId: "q-42",
      status: "MEMORY",
      createdAt: 40,
      completedAt: 80,
      updatedAt: 80,
    });
    const sessions = new Map([[leader.id, leader]]);
    const persistSession = vi.fn();
    const controller = controllerFor(sessions, persistSession);

    expect(controller.promoteLeaderThreadTabForAttention(leader.id, "q-42", 200, "review")).toBe(true);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-1", "q-42", "q-43"]);
    expect(controller.promoteLeaderThreadTabForAttention(leader.id, "q-43", 210, "review")).toBe(false);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-1", "q-42", "q-43"]);

    leader.state.leaderOpenThreadTabs = {
      ...leader.state.leaderOpenThreadTabs,
      orderedOpenThreadKeys: ["q-1", "q-42"],
      closedThreadTombstones: [{ threadKey: "q-43", closedAt: 220 }],
      updatedAt: 220,
    };
    expect(controller.promoteLeaderThreadTabForAttention(leader.id, "q-43", 230, "review")).toBe(false);
    expect(leader.state.leaderOpenThreadTabs.closedThreadTombstones).toEqual([{ threadKey: "q-43", closedAt: 220 }]);

    leader.state.leaderOpenThreadTabs = {
      ...leader.state.leaderOpenThreadTabs,
      orderedOpenThreadKeys: ["q-1", "q-42", "q-43"],
      updatedAt: 250,
    };
    expect(
      controller.promoteLeaderThreadTabForMessageAttention(leader.id, {
        type: "user_message",
        id: "rework-q-42",
        content: "Please ask the agent to fix this reopened quest.",
        timestamp: 300,
        threadKey: "q-42",
        questId: "q-42",
      }),
    ).toBe(true);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-42", "q-1", "q-43"]);

    leader.completedBoard.delete("q-42");
    leader.board.set("q-42", {
      questId: "q-42",
      status: "WORKING",
      createdAt: 310,
      updatedAt: 310,
    });
    leader.state.leaderOpenThreadTabs = {
      ...leader.state.leaderOpenThreadTabs,
      orderedOpenThreadKeys: ["q-1", "q-42", "q-43"],
      updatedAt: 320,
    };
    expect(controller.promoteLeaderThreadTabForAttention(leader.id, "q-42", 400, "review")).toBe(false);
    expect(leader.state.leaderOpenThreadTabs.orderedOpenThreadKeys).toEqual(["q-1", "q-42", "q-43"]);
  });
});
