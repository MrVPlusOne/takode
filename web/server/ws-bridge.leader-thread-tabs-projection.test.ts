import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
const mockShouldSettingsRuleApprove = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("./bridge/settings-rule-matcher.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bridge/settings-rule-matcher.js")>();
  return { ...original, shouldSettingsRuleApprove: mockShouldSettingsRuleApprove };
});

import {
  applyLeaderThreadTabsProjectionPatch,
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { parseThreadStatusMarkerLine } from "../shared/thread-status-marker.js";
import { removeBoardRows, upsertBoardRow } from "./bridge/board-watchdog-controller.js";
import { notifyUser } from "./bridge/session-notification-controller.js";
import { recordLeaderThreadStatusMarkers } from "./bridge/thread-routing-reminder.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { getWorkBoardStateDeps } from "./ws-bridge-deps.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

function browserSocket(sessionId: string) {
  return {
    data: { kind: "browser", sessionId } satisfies SocketData,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function messages(socket: ReturnType<typeof browserSocket>): Array<Record<string, any>> {
  return socket.send.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

function projectionMessages(socket: ReturnType<typeof browserSocket>, type = "synced_projection_update") {
  return messages(socket).filter(
    (message) => message.type === type && message.projection === LEADER_THREAD_TABS_PROJECTION,
  );
}

function applyProjectionMessages(
  previous: LeaderThreadTabsProjectionValue,
  updates: Array<Record<string, any>>,
): LeaderThreadTabsProjectionValue {
  return updates.reduce<LeaderThreadTabsProjectionValue>((value, update) => {
    const next = Object.hasOwn(update, "value")
      ? (update.value as LeaderThreadTabsProjectionValue)
      : applyLeaderThreadTabsProjectionPatch(value, update.patch);
    expect(next).toBeDefined();
    return next!;
  }, previous);
}

function boardDeps(bridge: WsBridge) {
  return {
    getBoardDispatchableSignature: vi.fn(() => null),
    markNotificationDone: vi.fn(() => false),
    broadcastBoard: (session: any, board: any[], completedBoard: any[]) =>
      bridge.broadcastToSession(session.id, {
        type: "board_updated",
        board,
        completedBoard,
      } as BrowserIncomingMessage),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    notifyReview: vi.fn(),
  };
}

function notificationDeps(bridge: WsBridge) {
  return {
    broadcastToBrowsers: (session: any, message: BrowserIncomingMessage) =>
      bridge.broadcastToSession(session.id, message),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    getLauncherSessionInfo: () => ({ isOrchestrator: true }),
    isHerdedWorkerSession: () => false,
    scheduleNotification: vi.fn(),
  };
}

async function subscribe(bridge: WsBridge, socket: ReturnType<typeof browserSocket>, key: string) {
  await bridge.handleBrowserMessage(
    socket,
    JSON.stringify({
      type: "session_subscribe",
      last_seq: 0,
      history_window_section_turn_count: 10,
      history_window_visible_section_count: 3,
      synced_projection_subscriptions: [{ projection: LEADER_THREAD_TABS_PROJECTION, key }],
    }),
  );
}

async function updateTabs(
  bridge: WsBridge,
  socket: ReturnType<typeof browserSocket>,
  operation: Record<string, unknown>,
  clientMessageId: string,
) {
  await bridge.handleBrowserMessage(
    socket,
    JSON.stringify({
      type: "leader_thread_tabs_update",
      operation,
      client_msg_id: clientMessageId,
    }),
  );
  await bridge.getSyncedProjectionController().flushForTest();
}

describe("WsBridge leader thread tabs synchronized projection", () => {
  it("converges two subscribers across tab, notification, phase, and status producers without replay or duplicate updates", async () => {
    const bridge = new WsBridge();
    const leader = bridge.getOrCreateSession("leader");
    leader.state.isOrchestrator = true;
    const commandSocket = browserSocket("leader");
    leader.browserSockets.add(commandSocket);

    const firstCarrier = bridge.getOrCreateSession("carrier-1");
    const secondCarrier = bridge.getOrCreateSession("carrier-2");
    const first = browserSocket("carrier-1");
    const second = browserSocket("carrier-2");
    firstCarrier.browserSockets.add(first);
    secondCarrier.browserSockets.add(second);

    await subscribe(bridge, first, leader.id);
    await subscribe(bridge, second, leader.id);

    for (const socket of [first, second]) {
      const initial = messages(socket);
      const snapshotIndex = initial.findIndex(
        (message) =>
          message.type === "synced_projection_snapshot" && message.projection === LEADER_THREAD_TABS_PROJECTION,
      );
      const ackIndex = initial.findIndex((message) => message.type === "synced_projection_subscriptions_ack");
      const stateIndex = initial.findIndex((message) => message.type === "state_snapshot");
      expect(snapshotIndex).toBeGreaterThanOrEqual(0);
      expect(ackIndex).toBeGreaterThan(snapshotIndex);
      expect(stateIndex).toBeGreaterThan(ackIndex);
      expect(initial[snapshotIndex]).toMatchObject({
        key: leader.id,
        revision: 1,
        value: { tabState: null, tabs: [], threadStatuses: {}, activePhaseSummary: [] },
      });
      expect(initial[stateIndex]).not.toHaveProperty("leaderActivePhaseSummary");
      expect(initial[stateIndex]).not.toHaveProperty("leaderThreadStatuses");
    }
    const initialSnapshot = projectionMessages(first, "synced_projection_snapshot")[0]!;
    const generation = initialSnapshot.generation as string;
    let projectedValue = initialSnapshot.value as LeaderThreadTabsProjectionValue;
    first.send.mockClear();
    second.send.mockClear();

    await updateTabs(
      bridge,
      commandSocket,
      { type: "open", threadKey: "q-1", placement: "first", source: "user" },
      "open-q1",
    );
    let firstUpdates = projectionMessages(first);
    let secondUpdates = projectionMessages(second);
    expect(firstUpdates).toHaveLength(1);
    expect(secondUpdates).toEqual(firstUpdates);
    expect(firstUpdates[0]).toMatchObject({
      generation,
      revision: 2,
    });
    projectedValue = applyProjectionMessages(projectedValue, firstUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: [{ threadKey: "q-1" }],
    });

    first.send.mockClear();
    second.send.mockClear();
    await updateTabs(
      bridge,
      commandSocket,
      { type: "open", threadKey: "q-2", placement: "first", source: "user" },
      "open-q2",
    );
    await updateTabs(
      bridge,
      commandSocket,
      { type: "reorder", orderedOpenThreadKeys: ["q-1", "q-2"] },
      "reorder-q1-q2",
    );
    await updateTabs(bridge, commandSocket, { type: "close", threadKey: "q-1", closedAt: 40 }, "close-q1");
    firstUpdates = projectionMessages(first);
    secondUpdates = projectionMessages(second);
    expect(firstUpdates).toHaveLength(3);
    expect(secondUpdates).toEqual(firstUpdates);
    expect(firstUpdates.at(-1)).toMatchObject({ revision: 5 });
    projectedValue = applyProjectionMessages(projectedValue, firstUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: [{ threadKey: "q-2" }],
    });

    first.send.mockClear();
    second.send.mockClear();
    const notified = notifyUser(leader, "needs-input", "Confirm the projected thread", notificationDeps(bridge), {
      threadRoute: { threadKey: "q-3", questId: "q-3" },
    });
    expect(notified.ok).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();
    firstUpdates = projectionMessages(first);
    secondUpdates = projectionMessages(second);
    expect(firstUpdates).toHaveLength(1);
    expect(secondUpdates).toEqual(firstUpdates);
    expect(firstUpdates[0]).toMatchObject({ revision: 6 });
    projectedValue = applyProjectionMessages(projectedValue, firstUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: expect.arrayContaining([
        expect.objectContaining({ threadKey: "q-3", attention: expect.objectContaining({ needsInput: true }) }),
      ]),
    });

    first.send.mockClear();
    second.send.mockClear();
    upsertBoardRow(
      leader,
      {
        questId: "q-3",
        title: "Projected board row",
        status: "WORKING",
        journey: { phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1 },
        updatedAt: 80,
      },
      boardDeps(bridge),
    );
    await bridge.getSyncedProjectionController().flushForTest();
    firstUpdates = projectionMessages(first);
    expect(firstUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(firstUpdates);
    expect(firstUpdates[0]).toMatchObject({ revision: 7 });
    projectedValue = applyProjectionMessages(projectedValue, firstUpdates);
    expect(projectedValue).toMatchObject({
      tabs: expect.arrayContaining([
        expect.objectContaining({
          threadKey: "q-3",
          title: "Projected board row",
          boardStatus: "WORKING",
          active: true,
          canClose: false,
          journey: expect.objectContaining({ currentPhaseId: "work", activePhaseIndex: 1, phaseCount: 3 }),
        }),
      ]),
      activePhaseSummary: [expect.objectContaining({ label: "Work", count: 1, tone: "phase" })],
    });

    first.send.mockClear();
    second.send.mockClear();
    const marker = parseThreadStatusMarkerLine("{[(Thread Waiting: q-3 | waiting on final validation)]}")!;
    recordLeaderThreadStatusMarkers(leader, [marker], { messageId: "status-q3", timestamp: 100 });
    bridge.persistSessionById(leader.id);
    await bridge.getSyncedProjectionController().flushForTest();
    firstUpdates = projectionMessages(first);
    expect(firstUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(firstUpdates);
    expect(firstUpdates[0]).toMatchObject({ revision: 8 });
    projectedValue = applyProjectionMessages(projectedValue, firstUpdates);
    expect(projectedValue).toMatchObject({
      threadStatuses: {
        "q-3": expect.objectContaining({ kind: "waiting", summary: "waiting on final validation" }),
      },
    });

    first.send.mockClear();
    second.send.mockClear();
    const beforeNoop = bridge.getSyncedProjectionController().getMetrics().projections[LEADER_THREAD_TABS_PROJECTION]!;
    bridge.persistSessionById(leader.id);
    await bridge.getSyncedProjectionController().flushForTest();
    const afterNoop = bridge.getSyncedProjectionController().getMetrics().projections[LEADER_THREAD_TABS_PROJECTION]!;
    expect(projectionMessages(first)).toEqual([]);
    expect(projectionMessages(second)).toEqual([]);
    expect(afterNoop.updates).toBe(beforeNoop.updates);
    expect(afterNoop.deliveries).toBe(beforeNoop.deliveries);
    expect(afterNoop.dependencyEqualSuppressions).toBeGreaterThan(beforeNoop.dependencyEqualSuppressions);
    expect(afterNoop.cachedValueBytes).toBeGreaterThan(0);
    expect(afterNoop.updateValueBytes).toBeGreaterThan(0);
    expect(afterNoop.deliveredValueBytes).toBeGreaterThan(0);

    expect(
      [...leader.eventBuffer, ...firstCarrier.eventBuffer, ...secondCarrier.eventBuffer].some((event) => {
        const type = (event.message as { type?: string }).type;
        return type === "synced_projection_snapshot" || type === "synced_projection_update";
      }),
    ).toBe(false);
    expect(
      [...messages(first), ...messages(second)].some(
        (message) => message.projection === LEADER_THREAD_TABS_PROJECTION && message.seq !== undefined,
      ),
    ).toBe(false);

    bridge.handleBrowserClose(first);
    const reconnected = browserSocket("carrier-1");
    firstCarrier.browserSockets.add(reconnected);
    await subscribe(bridge, reconnected, leader.id);
    expect(projectionMessages(reconnected, "synced_projection_snapshot")).toEqual([
      expect.objectContaining({
        generation,
        revision: 8,
        value: expect.objectContaining({
          tabState: { version: 1 },
          tabs: expect.arrayContaining([expect.objectContaining({ threadKey: "q-3" })]),
          threadStatuses: { "q-3": expect.objectContaining({ kind: "waiting" }) },
        }),
      }),
    ]);
  });

  it("invalidates only visible subscribed leader projections that reference the changed quest", async () => {
    const bridge = new WsBridge();
    const openLeader = bridge.getOrCreateSession("leader-open");
    openLeader.state.isOrchestrator = true;
    openLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1"],
      closedThreadTombstones: [],
      updatedAt: 10,
    };
    const sourceLeader = bridge.getOrCreateSession("leader-source");
    sourceLeader.state.isOrchestrator = true;
    sourceLeader.board.set("q-1", {
      questId: "q-1",
      title: "Current source row",
      status: "WORKING",
      createdAt: 20,
      updatedAt: 20,
    });
    const unrelatedLeader = bridge.getOrCreateSession("leader-unrelated");
    unrelatedLeader.state.isOrchestrator = true;
    unrelatedLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-2"],
      closedThreadTombstones: [],
      updatedAt: 10,
    };
    const searchOnlyLeader = bridge.getOrCreateSession("leader-search-only");
    searchOnlyLeader.state.isOrchestrator = true;
    searchOnlyLeader.searchDataOnly = true;
    searchOnlyLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1"],
      closedThreadTombstones: [],
      updatedAt: 10,
    };

    const openCarrier = bridge.getOrCreateSession("carrier-open");
    const unrelatedCarrier = bridge.getOrCreateSession("carrier-unrelated");
    const openSocket = browserSocket(openCarrier.id);
    const unrelatedSocket = browserSocket(unrelatedCarrier.id);
    openCarrier.browserSockets.add(openSocket);
    unrelatedCarrier.browserSockets.add(unrelatedSocket);
    await subscribe(bridge, openSocket, openLeader.id);
    await subscribe(bridge, unrelatedSocket, unrelatedLeader.id);
    let openValue = projectionMessages(openSocket, "synced_projection_snapshot")[0]!
      .value as LeaderThreadTabsProjectionValue;
    openSocket.send.mockClear();
    unrelatedSocket.send.mockClear();

    const controller = bridge.getSyncedProjectionController();
    expect(controller.invalidateLeaderThreadTabsForQuestIds(["Q-1", "not-a-quest"])).toBe(1);
    await controller.flushForTest();
    expect(projectionMessages(openSocket)).toEqual([]);
    expect(projectionMessages(unrelatedSocket)).toEqual([]);
    expect(controller.invalidateLeaderThreadTabsForQuestIds(["not-a-quest"])).toBe(0);

    sourceLeader.searchDataOnly = true;
    bridge.broadcastGlobal({ type: "session_archived", session_id: sourceLeader.id });
    await controller.flushForTest();
    const openUpdates = projectionMessages(openSocket);
    expect(openUpdates).toHaveLength(1);
    openValue = applyProjectionMessages(openValue, openUpdates);
    expect(openValue).toMatchObject({
      tabs: [expect.objectContaining({ threadKey: "q-1", active: false, sourceLeaderSessionId: null })],
    });
    expect(projectionMessages(unrelatedSocket)).toEqual([]);
  });

  it("keeps historical leader subscribers on the current quest run through rework, Memory, and completion", async () => {
    // A retained thread belongs to the viewed leader, but its visual Journey and participant state
    // must follow the current quest row owned by another leader without route selection or refresh.
    const bridge = new WsBridge();
    const historicalLeader = bridge.getOrCreateSession("leader-historical");
    historicalLeader.state.isOrchestrator = true;
    historicalLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1974"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    historicalLeader.completedBoard.set("q-1974", {
      questId: "q-1974",
      title: "Historical completed run",
      status: "MEMORY",
      worker: "worker-historical",
      workerNum: 2569,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "user-checkpoint", "work", "memory"],
        activePhaseIndex: 4,
        currentPhaseId: "memory",
      },
      createdAt: 10,
      updatedAt: 90,
      completedAt: 100,
    });

    const currentLeader = bridge.getOrCreateSession("leader-current");
    currentLeader.state.isOrchestrator = true;
    currentLeader.board.set("q-1974", {
      questId: "q-1974",
      title: "Current rework run",
      status: "WORKING",
      worker: "worker-current",
      workerNum: 2580,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 1,
        currentPhaseId: "work",
      },
      createdAt: 200,
      updatedAt: 250,
    });
    const currentWorker = bridge.getOrCreateSession("worker-current");
    currentWorker.state.claimedQuestId = "q-1974";
    currentWorker.state.claimedQuestStatus = "in_progress";
    currentWorker.state.claimedQuestLeaderSessionId = currentLeader.id;

    const firstCarrier = bridge.getOrCreateSession("historical-carrier-1");
    const secondCarrier = bridge.getOrCreateSession("historical-carrier-2");
    const first = browserSocket(firstCarrier.id);
    const second = browserSocket(secondCarrier.id);
    firstCarrier.browserSockets.add(first);
    secondCarrier.browserSockets.add(second);

    await subscribe(bridge, first, historicalLeader.id);
    await subscribe(bridge, second, historicalLeader.id);

    const initial = projectionMessages(first, "synced_projection_snapshot");
    expect(initial).toHaveLength(1);
    expect(projectionMessages(second, "synced_projection_snapshot")).toEqual(initial);
    expect(initial[0]).toMatchObject({
      revision: 1,
      value: {
        tabs: [
          expect.objectContaining({
            threadKey: "q-1974",
            boardStatus: "WORKING",
            sourceLeaderSessionId: "leader-current",
            sourceRowCreatedAt: 200,
            workerSessionId: "worker-current",
            workerSessionNum: 2580,
            active: true,
            completed: false,
            canClose: false,
            journey: expect.objectContaining({
              phaseIds: ["alignment", "work", "memory"],
              currentPhaseId: "work",
              activePhaseIndex: 1,
              phaseCount: 3,
            }),
          }),
        ],
      },
    });
    const generation = initial[0]!.generation as string;
    let projectedValue = initial[0]!.value as LeaderThreadTabsProjectionValue;
    first.send.mockClear();
    second.send.mockClear();

    const boardDeps = getWorkBoardStateDeps(bridge);
    upsertBoardRow(
      currentLeader,
      {
        questId: "q-1974",
        status: "MEMORY",
        worker: "worker-current",
        workerNum: 2580,
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 2,
          currentPhaseId: "memory",
        },
        updatedAt: 300,
      },
      boardDeps,
    );
    await bridge.getSyncedProjectionController().flushForTest();

    const memoryUpdates = projectionMessages(first);
    expect(memoryUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(memoryUpdates);
    expect(memoryUpdates[0]).toMatchObject({ revision: 2 });
    projectedValue = applyProjectionMessages(projectedValue, memoryUpdates);
    expect(projectedValue).toMatchObject({
      tabs: [
        expect.objectContaining({
          boardStatus: "MEMORY",
          sourceLeaderSessionId: "leader-current",
          workerSessionNum: 2580,
          active: true,
          completed: false,
          journey: expect.objectContaining({ currentPhaseId: "memory", activePhaseIndex: 2, phaseCount: 3 }),
        }),
      ],
    });

    first.send.mockClear();
    second.send.mockClear();
    bridge.getSyncedProjectionController().invalidateLeaderThreadTabsForQuestIds(["q-1974"]);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(projectionMessages(first)).toEqual([]);
    expect(projectionMessages(second)).toEqual([]);

    bridge.completeDoneBoardRowsForQuest("q-1974");
    currentWorker.state.claimedQuestId = undefined;
    currentWorker.state.claimedQuestStatus = undefined;
    currentWorker.state.claimedQuestLeaderSessionId = undefined;
    await bridge.getSyncedProjectionController().flushForTest();

    const completedUpdates = projectionMessages(first);
    expect(completedUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(completedUpdates);
    expect(completedUpdates[0]).toMatchObject({ revision: 3 });
    projectedValue = applyProjectionMessages(projectedValue, completedUpdates);
    expect(projectedValue).toMatchObject({
      tabs: [
        expect.objectContaining({
          boardStatus: "MEMORY",
          sourceLeaderSessionId: "leader-current",
          sourceRowCreatedAt: 200,
          workerSessionId: "worker-current",
          workerSessionNum: 2580,
          active: false,
          completed: true,
          canClose: true,
          journey: expect.objectContaining({ currentPhaseId: "memory", activePhaseIndex: 2, phaseCount: 3 }),
        }),
      ],
    });

    bridge.handleBrowserClose(first);
    const reconnected = browserSocket(firstCarrier.id);
    firstCarrier.browserSockets.add(reconnected);
    await subscribe(bridge, reconnected, historicalLeader.id);
    expect(projectionMessages(reconnected, "synced_projection_snapshot")).toEqual([
      expect.objectContaining({
        generation,
        revision: 3,
        value: expect.objectContaining({
          tabs: [
            expect.objectContaining({
              threadKey: "q-1974",
              sourceLeaderSessionId: "leader-current",
              workerSessionNum: 2580,
              completed: true,
              journey: expect.objectContaining({ currentPhaseId: "memory", phaseCount: 3 }),
            }),
          ],
        }),
      }),
    ]);
  });

  it("promotes a reopened tab once and preserves its position through Memory, Waiting, completion, and reconnect", async () => {
    const bridge = new WsBridge();
    const historicalLeader = bridge.getOrCreateSession("leader-historical-edge");
    historicalLeader.state.isOrchestrator = true;
    historicalLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-1974", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    historicalLeader.completedBoard.set("q-1974", {
      questId: "q-1974",
      title: "Historical completion",
      status: "MEMORY",
      createdAt: 10,
      updatedAt: 90,
      completedAt: 100,
    });

    const currentLeader = bridge.getOrCreateSession("leader-current-edge");
    currentLeader.state.isOrchestrator = true;
    currentLeader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-1974", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    currentLeader.board.set("q-1974", {
      questId: "q-1974",
      title: "Current rework",
      status: "QUEUED",
      worker: "worker-current-edge",
      workerNum: 2583,
      createdAt: 200,
      updatedAt: 200,
      journey: {
        mode: "active",
        phaseIds: ["alignment", "work", "memory"],
        activePhaseIndex: 0,
        currentPhaseId: "alignment",
      },
    });
    const worker = bridge.getOrCreateSession("worker-current-edge");
    worker.state.claimedQuestId = "q-1974";
    worker.state.claimedQuestStatus = "in_progress";
    worker.state.claimedQuestLeaderSessionId = currentLeader.id;

    const firstCarrier = bridge.getOrCreateSession("edge-carrier-1");
    const secondCarrier = bridge.getOrCreateSession("edge-carrier-2");
    const first = browserSocket(firstCarrier.id);
    const second = browserSocket(secondCarrier.id);
    firstCarrier.browserSockets.add(first);
    secondCarrier.browserSockets.add(second);
    await subscribe(bridge, first, historicalLeader.id);
    await subscribe(bridge, second, historicalLeader.id);
    const initialSnapshot = projectionMessages(first, "synced_projection_snapshot")[0]!;
    const generation = initialSnapshot.generation as string;
    let projectedValue = initialSnapshot.value as LeaderThreadTabsProjectionValue;
    first.send.mockClear();
    second.send.mockClear();

    const deps = getWorkBoardStateDeps(bridge);
    upsertBoardRow(
      currentLeader,
      {
        questId: "q-1974",
        status: "WORKING",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 1,
          currentPhaseId: "work",
        },
        updatedAt: 300,
      },
      deps,
    );
    await bridge.getSyncedProjectionController().flushForTest();

    expect(historicalLeader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1974", "q-1", "q-2"]);
    expect(currentLeader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1974", "q-1", "q-2"]);
    const promoted = projectionMessages(first);
    expect(promoted).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(promoted);
    projectedValue = applyProjectionMessages(projectedValue, promoted);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: expect.arrayContaining([expect.objectContaining({ threadKey: "q-1974", active: true, completed: false })]),
    });

    first.send.mockClear();
    second.send.mockClear();
    upsertBoardRow(
      currentLeader,
      {
        questId: "q-1974",
        status: "MEMORY",
        journey: {
          mode: "active",
          phaseIds: ["alignment", "work", "memory"],
          activePhaseIndex: 2,
          currentPhaseId: "memory",
        },
        updatedAt: 400,
      },
      deps,
    );
    await bridge.getSyncedProjectionController().flushForTest();
    const memoryUpdates = projectionMessages(first);
    expect(memoryUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(memoryUpdates);
    projectedValue = applyProjectionMessages(projectedValue, memoryUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: expect.arrayContaining([
        expect.objectContaining({ threadKey: "q-1974", active: true, boardStatus: "MEMORY" }),
      ]),
    });

    first.send.mockClear();
    second.send.mockClear();
    const marker = parseThreadStatusMarkerLine("{[(Thread Waiting: q-1974 | waiting on completion)]}")!;
    recordLeaderThreadStatusMarkers(historicalLeader, [marker], { messageId: "waiting-edge", timestamp: 450 });
    bridge.persistSessionById(historicalLeader.id);
    await bridge.getSyncedProjectionController().flushForTest();
    const waitingUpdates = projectionMessages(first);
    expect(waitingUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(waitingUpdates);
    projectedValue = applyProjectionMessages(projectedValue, waitingUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      threadStatuses: { "q-1974": expect.objectContaining({ kind: "waiting" }) },
    });

    first.send.mockClear();
    second.send.mockClear();
    bridge.completeDoneBoardRowsForQuest("q-1974");
    await bridge.getSyncedProjectionController().flushForTest();
    const completedUpdates = projectionMessages(first);
    expect(completedUpdates).toHaveLength(1);
    expect(projectionMessages(second)).toEqual(completedUpdates);
    projectedValue = applyProjectionMessages(projectedValue, completedUpdates);
    expect(projectedValue).toMatchObject({
      tabState: { version: 1 },
      tabs: expect.arrayContaining([expect.objectContaining({ threadKey: "q-1974", active: false, completed: true })]),
    });
    const finalRevision = completedUpdates[0]!.revision as number;

    first.send.mockClear();
    second.send.mockClear();
    bridge.getSyncedProjectionController().invalidateLeaderThreadTabsForQuestIds(["q-1974"]);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(projectionMessages(first)).toEqual([]);
    expect(projectionMessages(second)).toEqual([]);

    bridge.handleBrowserClose(first);
    const reconnected = browserSocket(firstCarrier.id);
    firstCarrier.browserSockets.add(reconnected);
    await subscribe(bridge, reconnected, historicalLeader.id);
    expect(projectionMessages(reconnected, "synced_projection_snapshot")).toEqual([
      expect.objectContaining({
        generation,
        revision: finalRevision,
        value: expect.objectContaining({
          tabState: { version: 1 },
          tabs: expect.arrayContaining([expect.objectContaining({ threadKey: "q-1974", completed: true })]),
        }),
      }),
    ]);
  });

  it("promotes accepted Codex rework input exactly once at its message edge", async () => {
    const bridge = new WsBridge();
    const leader = bridge.getOrCreateSession("leader-codex-rework", "codex");
    leader.state.isOrchestrator = true;
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-42", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    leader.completedBoard.set("q-42", {
      questId: "q-42",
      title: "Completed before rework",
      status: "MEMORY",
      createdAt: 50,
      updatedAt: 90,
      completedAt: 100,
    });
    const socket = browserSocket(leader.id);
    leader.browserSockets.add(socket);
    const promote = vi.spyOn(bridge, "promoteLeaderThreadTabForMessageAttention");

    await bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "user_message",
        content: "Please ask the agent to fix the reopened quest.",
        threadKey: "q-42",
        questId: "q-42",
        client_msg_id: "rework-q-42",
      }),
    );
    await bridge.getSyncedProjectionController().flushForTest();

    expect(promote).toHaveBeenCalledTimes(1);
    expect(leader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-42", "q-1", "q-2"]);
  });

  it("keeps a buried active tab in place when completion emits its review notification", async () => {
    const bridge = new WsBridge();
    const leader = bridge.getOrCreateSession("leader-completion-review");
    leader.state.isOrchestrator = true;
    leader.state.leaderOpenThreadTabs = {
      version: 1,
      orderedOpenThreadKeys: ["q-1", "q-42", "q-2"],
      closedThreadTombstones: [],
      updatedAt: 100,
    };
    leader.board.set("q-42", {
      questId: "q-42",
      title: "Finish without demotion",
      status: "MEMORY",
      createdAt: 50,
      updatedAt: 90,
      threadTabActivatedAt: 50,
    });

    removeBoardRows(leader, ["q-42"], getWorkBoardStateDeps(bridge));
    await bridge.getSyncedProjectionController().flushForTest();

    expect(leader.state.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1", "q-42", "q-2"]);
    expect(leader.completedBoard.has("q-42")).toBe(true);
    expect(leader.notifications).toEqual([
      expect.objectContaining({ category: "review", summary: expect.stringContaining("q-42 ready for review") }),
    ]);
  });
});
