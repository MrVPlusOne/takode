import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
const mockShouldSettingsRuleApprove = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("./bridge/settings-rule-matcher.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bridge/settings-rule-matcher.js")>();
  return { ...original, shouldSettingsRuleApprove: mockShouldSettingsRuleApprove };
});

import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { parseThreadStatusMarkerLine } from "../shared/thread-status-marker.js";
import { upsertBoardRow } from "./bridge/board-watchdog-controller.js";
import { notifyUser } from "./bridge/session-notification-controller.js";
import { recordLeaderThreadStatusMarkers } from "./bridge/thread-routing-reminder.js";
import type { BrowserIncomingMessage } from "./session-types.js";
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

async function subscribe(
  bridge: WsBridge,
  socket: ReturnType<typeof browserSocket>,
  key: string,
  version?: { generation: string; revision: number },
) {
  await bridge.handleBrowserMessage(
    socket,
    JSON.stringify({
      type: "session_subscribe",
      last_seq: 0,
      synced_projection_subscriptions: [
        {
          projection: LEADER_THREAD_TABS_PROJECTION,
          key,
          ...(version ?? {}),
        },
      ],
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
    }
    const generation = projectionMessages(first, "synced_projection_snapshot")[0]!.generation as string;
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
      value: { tabState: { orderedOpenThreadKeys: ["q-1"] }, tabs: [{ threadKey: "q-1" }] },
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
    expect(firstUpdates.at(-1)).toMatchObject({
      revision: 5,
      value: {
        tabState: {
          orderedOpenThreadKeys: ["q-2"],
          closedThreadTombstones: [expect.objectContaining({ threadKey: "q-1", closedAt: 40 })],
        },
      },
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
    expect(firstUpdates[0]).toMatchObject({
      revision: 6,
      value: {
        tabState: { orderedOpenThreadKeys: ["q-3", "q-2"] },
        tabs: expect.arrayContaining([
          expect.objectContaining({ threadKey: "q-3", attention: expect.objectContaining({ needsInput: true }) }),
        ]),
      },
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
    expect(firstUpdates[0]).toMatchObject({
      revision: 7,
      value: {
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
      },
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
    expect(firstUpdates[0]).toMatchObject({
      revision: 8,
      value: {
        threadStatuses: {
          "q-3": expect.objectContaining({ kind: "waiting", summary: "waiting on final validation" }),
        },
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
    await subscribe(bridge, reconnected, leader.id, { generation, revision: 8 });
    expect(projectionMessages(reconnected, "synced_projection_snapshot")).toEqual([
      expect.objectContaining({
        generation,
        revision: 8,
        value: expect.objectContaining({
          tabState: expect.objectContaining({ orderedOpenThreadKeys: ["q-3", "q-2"] }),
          threadStatuses: { "q-3": expect.objectContaining({ kind: "waiting" }) },
        }),
      }),
    ]);
  });
});
