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
  clearAttentionAndMarkRead,
  markSessionUnread,
  recordThreadReadyUnreadNotifications,
} from "./bridge/session-registry-controller.js";
import { createLauncherHerdChangeHandler } from "./herd-change-handler.js";
import { trafficStats } from "./traffic-stats.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

function browserSocket(sessionId: string) {
  return {
    data: { kind: "browser", sessionId } satisfies SocketData,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function messages(socket: ReturnType<typeof browserSocket>) {
  return socket.send.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

function notificationDeps(bridge: WsBridge) {
  return {
    broadcastToBrowsers: (session: any, message: any) => bridge.broadcastToSession(session.id, message),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
  };
}

function ready(questId: string, timestamp: number) {
  return {
    kind: "ready" as const,
    label: "Thread Ready" as const,
    threadKey: questId,
    questId,
    summary: `${questId} complete`,
    messageId: `message-${questId}`,
    timestamp,
    updatedAt: timestamp,
  };
}

describe("WsBridge synchronized projections", () => {
  it("scopes direct updates, keeps inbox owner-only, resyncs, and snapshots every reconnect", async () => {
    const bridge = new WsBridge();
    const worker = bridge.getOrCreateSession("worker");
    const carrierSession = bridge.getOrCreateSession("carrier");
    const otherSession = bridge.getOrCreateSession("other-carrier");
    const owner = browserSocket("worker");
    const carrier = browserSocket("carrier");
    const otherCarrier = browserSocket("other-carrier");
    worker.browserSockets.add(owner);
    carrierSession.browserSockets.add(carrier);
    otherSession.browserSockets.add(otherCarrier);

    await bridge.handleBrowserMessage(
      carrier,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "worker" }],
      }),
    );
    await bridge.handleBrowserMessage(
      otherCarrier,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "other-carrier" }],
      }),
    );

    const initial = messages(carrier);
    const snapshotIndex = initial.findIndex((message: any) => message.type === "synced_projection_snapshot");
    const ackIndex = initial.findIndex((message: any) => message.type === "synced_projection_subscriptions_ack");
    const stateIndex = initial.findIndex((message: any) => message.type === "state_snapshot");
    expect(snapshotIndex).toBeGreaterThanOrEqual(0);
    expect(ackIndex).toBeGreaterThan(snapshotIndex);
    expect(stateIndex).toBeGreaterThan(ackIndex);
    expect(stateIndex).toBeGreaterThan(snapshotIndex);
    expect(initial[ackIndex]).toEqual({
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: "session-attention", key: "worker" }],
      complete: true,
    });
    const firstSnapshot = initial[snapshotIndex];
    expect(firstSnapshot).toMatchObject({
      projection: "session-attention",
      key: "worker",
      revision: 1,
      value: { attentionReason: null, status: null },
    });
    owner.send.mockClear();
    carrier.send.mockClear();
    otherCarrier.send.mockClear();

    expect(recordThreadReadyUnreadNotifications(worker, [ready("q-1", 100)], notificationDeps(bridge))).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();
    owner.send.mockClear();
    carrier.send.mockClear();
    otherCarrier.send.mockClear();

    expect(recordThreadReadyUnreadNotifications(worker, [ready("q-2", 200)], notificationDeps(bridge))).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();

    const ownerMessages = messages(owner);
    const carrierMessages = messages(carrier);
    expect(ownerMessages.some((message: any) => message.type === "notification_update")).toBe(true);
    expect(carrierMessages.some((message: any) => message.type === "notification_update")).toBe(false);
    expect(messages(otherCarrier).some((message: any) => message.type === "synced_projection_update")).toBe(false);
    const update = carrierMessages.find((message: any) => message.type === "synced_projection_update");
    expect(update).toMatchObject({
      generation: firstSnapshot.generation,
      revision: 3,
      value: { attentionReason: "review", status: { urgency: "review", count: 2 } },
    });
    expect(update.seq).toBeUndefined();
    expect(
      [...worker.eventBuffer, ...carrierSession.eventBuffer, ...otherSession.eventBuffer].some((event) => {
        const messageType = (event.message as { type: string }).type;
        return messageType === "synced_projection_update" || messageType === "synced_projection_snapshot";
      }),
    ).toBe(false);

    carrier.send.mockClear();
    await bridge.handleBrowserMessage(
      carrier,
      JSON.stringify({ type: "synced_projection_resync", projection: "session-attention", key: "worker" }),
    );
    expect(messages(carrier)).toEqual([
      expect.objectContaining({
        type: "synced_projection_snapshot",
        generation: firstSnapshot.generation,
        revision: 3,
      }),
    ]);

    bridge.handleBrowserClose(carrier);
    const reconnected = browserSocket("carrier");
    carrierSession.browserSockets.add(reconnected);
    await bridge.handleBrowserMessage(
      reconnected,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [
          {
            projection: "session-attention",
            key: "worker",
            generation: firstSnapshot.generation,
            revision: 3,
          },
        ],
      }),
    );
    expect(messages(reconnected).find((message: any) => message.type === "synced_projection_snapshot")).toMatchObject({
      generation: firstSnapshot.generation,
      revision: 3,
      value: { attentionReason: "review", status: { urgency: "review", count: 2 } },
    });
    expect(
      messages(reconnected).find((message: any) => message.type === "synced_projection_subscriptions_ack"),
    ).toEqual({
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: "session-attention", key: "worker" }],
      complete: true,
    });
  });

  it("recomputes direct-notification suppression when herd membership changes", async () => {
    const bridge = new WsBridge();
    const launcherSessions = new Map<string, any>([
      ["worker", { sessionId: "worker" }],
      ["leader", { sessionId: "leader", isOrchestrator: true }],
    ]);
    const launcher = {
      getSession: (sessionId: string) => launcherSessions.get(sessionId),
      getSessionNum: () => undefined,
    } as any;
    bridge.launcher = launcher;
    const worker = bridge.getOrCreateSession("worker");
    worker.notifications.push({
      id: "n-1",
      category: "needs-input",
      timestamp: 100,
      messageId: "message-1",
      done: false,
    });
    worker.notificationStatusVersion = 1;
    worker.notificationStatusUpdatedAt = 100;
    worker.attentionReason = "action";
    const socket = browserSocket("leader");
    const initial = bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-attention", key: "worker" }])
      .find((message) => message.type === "synced_projection_snapshot")!;
    expect(initial.value).toEqual({ attentionReason: "action", status: { urgency: "needs-input", count: 1 } });

    const onHerdChanged = vi.fn();
    const handleHerdChange = createLauncherHerdChangeHandler({
      dispatcher: { onHerdChanged },
      wsBridge: bridge,
      launcher,
      getSessionName: () => undefined,
    });
    launcherSessions.get("worker").herdedBy = "leader";
    handleHerdChange({ type: "membership_changed", leaderId: "leader" });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      value: { attentionReason: null, status: null },
    });

    delete launcherSessions.get("worker").herdedBy;
    handleHerdChange({ type: "membership_changed", leaderId: "leader" });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      value: { attentionReason: "action", status: { urgency: "needs-input", count: 1 } },
    });
    expect(onHerdChanged).toHaveBeenCalledTimes(2);
  });

  it("uses a new generation after restart and rejects hidden-session subscriptions", () => {
    const first = new WsBridge();
    first.getOrCreateSession("public");
    const firstSnapshot = first.getSyncedProjectionController().getSessionAttentionSnapshot("public");

    const second = new WsBridge();
    const hidden = second.getOrCreateSession("public");
    hidden.state.hidden = true;
    const socket = browserSocket("carrier");
    expect(
      second
        .getSyncedProjectionController()
        .replaceSubscriptions(socket, [{ projection: "session-attention", key: "public" }]),
    ).toEqual([{ type: "synced_projection_subscriptions_ack", subscriptions: [], complete: true }]);

    hidden.state.hidden = false;
    const secondSnapshot = second.getSyncedProjectionController().getSessionAttentionSnapshot("public");
    expect(firstSnapshot?.generation).not.toBe(secondSnapshot?.generation);
    expect(firstSnapshot?.revision).toBe(1);
    expect(secondSnapshot?.revision).toBe(1);
  });

  it("acknowledges refresh subscription completeness after accepted snapshots", async () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("carrier");
    bridge.getOrCreateSession("worker");
    const hidden = bridge.getOrCreateSession("hidden");
    hidden.state.hidden = true;
    const archived = bridge.getOrCreateSession("archived");
    archived.searchDataOnly = true;
    const socket = browserSocket("carrier");

    await bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "synced_projection_subscribe",
        subscriptions: [
          { projection: "session-attention", key: "worker" },
          { projection: "session-attention", key: "hidden" },
          { projection: "session-attention", key: "archived" },
          { projection: "session-attention", key: "missing" },
          { projection: "unsupported", key: "worker" },
        ],
      }),
    );

    expect(messages(socket)).toEqual([
      expect.objectContaining({ type: "synced_projection_snapshot", projection: "session-attention", key: "worker" }),
      {
        type: "synced_projection_subscriptions_ack",
        subscriptions: [{ projection: "session-attention", key: "worker" }],
        complete: true,
      },
    ]);
  });

  it("cleans reconnect-stale permissions before snapshotting self attention", async () => {
    const bridge = new WsBridge();
    const carrier = bridge.getOrCreateSession("carrier");
    carrier.pendingPermissions.set("stale-permission", {
      request_id: "stale-permission",
      tool_name: "Bash",
      input: { command: "pwd" },
    } as any);
    carrier.messageHistory.push({
      type: "permission_approved",
      request_id: "stale-permission",
      id: "approval-stale-permission",
      timestamp: 1,
    } as any);
    const socket = browserSocket("carrier");

    await bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "carrier" }],
      }),
    );

    expect(carrier.pendingPermissions.size).toBe(0);
    expect(messages(socket).find((message: any) => message.type === "synced_projection_snapshot")).toMatchObject({
      key: "carrier",
      value: { attentionReason: null, status: null },
    });
  });

  it("installs an archived carrier replacement before lazy history can be overtaken", async () => {
    const bridge = new WsBridge();
    const carrier = bridge.getOrCreateSession("carrier");
    carrier.searchDataOnly = true;
    const firstTarget = bridge.getOrCreateSession("first-target");
    const latestTarget = bridge.getOrCreateSession("latest-target");
    let releaseLoad!: () => void;
    const load = new Promise<null>((resolve) => {
      releaseLoad = () => resolve(null);
    });
    bridge.store = { load: vi.fn(() => load), save: vi.fn() } as any;
    const socket = browserSocket("carrier");

    const reconnect = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "first-target" }],
      }),
    );
    await Promise.resolve();
    const refresh = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "synced_projection_subscribe",
        subscriptions: [{ projection: "session-attention", key: "latest-target" }],
      }),
    );
    releaseLoad();
    await Promise.all([reconnect, refresh]);

    expect(
      messages(socket)
        .filter((message: any) => message.type === "synced_projection_subscriptions_ack")
        .map((message: any) => message.subscriptions),
    ).toEqual([
      [{ projection: "session-attention", key: "first-target" }],
      [{ projection: "session-attention", key: "latest-target" }],
    ]);

    socket.send.mockClear();
    firstTarget.attentionReason = "review";
    latestTarget.attentionReason = "review";
    bridge.persistSessionById(firstTarget.id);
    bridge.persistSessionById(latestTarget.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket)).toEqual([
      expect.objectContaining({ type: "synced_projection_update", key: "latest-target" }),
    ]);
  });

  it("serializes a slow reconnect snapshot before a newer refresh replacement", async () => {
    const bridge = new WsBridge();
    const carrier = bridge.getOrCreateSession("carrier");
    const firstTarget = bridge.getOrCreateSession("first-target");
    const latestTarget = bridge.getOrCreateSession("latest-target");
    carrier.messageHistory = Array.from({ length: 501 }, (_, index) => ({
      type: "user_message",
      content: `history-${index}`,
      timestamp: index,
      id: `history-${index}`,
    })) as any;
    const socket = browserSocket("carrier");

    const reconnect = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "first-target" }],
      }),
    );
    const refresh = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "synced_projection_subscribe",
        subscriptions: [{ projection: "session-attention", key: "latest-target" }],
      }),
    );
    await Promise.all([reconnect, refresh]);

    expect(
      messages(socket)
        .filter((message: any) => message.type === "synced_projection_subscriptions_ack")
        .map((message: any) => message.subscriptions),
    ).toEqual([
      [{ projection: "session-attention", key: "first-target" }],
      [{ projection: "session-attention", key: "latest-target" }],
    ]);

    socket.send.mockClear();
    firstTarget.attentionReason = "review";
    latestTarget.attentionReason = "review";
    bridge.persistSessionById(firstTarget.id);
    bridge.persistSessionById(latestTarget.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket)).toEqual([
      expect.objectContaining({ type: "synced_projection_update", key: "latest-target" }),
    ]);
  });

  it("preserves explicit manual unread through fresh notification status and clears it on read", async () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("worker");
    session.notificationStatusVersion = 4;
    session.notificationStatusUpdatedAt = 400;
    const socket = browserSocket("carrier");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-attention", key: "worker" }]);

    markSessionUnread(session, {
      isHerdedWorkerSession: () => false,
      broadcastToBrowsers: () => {},
      persistSession: (target) => bridge.persistSessionById(target.id),
    });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      value: { attentionReason: "review", status: { urgency: "review", count: 1 } },
    });

    clearAttentionAndMarkRead(session, {
      broadcastToBrowsers: () => {},
      persistSession: (target) => bridge.persistSessionById(target.id),
    });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(session.manualUnread).toBe(false);
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      value: { attentionReason: null, status: null },
    });
  });

  it("invalidates through central activity changes and records live update traffic", async () => {
    trafficStats.reset();
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("worker");
    const socket = browserSocket("carrier");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-attention", key: "worker" }]);
    socket.send.mockClear();

    session.attentionReason = "review";
    (bridge as any).onSessionActivityStateChanged(session.id, "test_attention_change");
    await bridge.getSyncedProjectionController().flushForTest();
    await Promise.resolve();

    expect(messages(socket)).toEqual([
      expect.objectContaining({
        type: "synced_projection_update",
        value: expect.objectContaining({ attentionReason: "review" }),
      }),
    ]);
    expect(trafficStats.snapshot().buckets).toContainEqual(
      expect.objectContaining({
        channel: "browser",
        direction: "out",
        messageType: "synced_projection_update",
      }),
    );
    trafficStats.reset();
  });

  it("removes closed carriers and prunes subscribers whose sends are dropped", async () => {
    const bridge = new WsBridge();
    const carrierSession = bridge.getOrCreateSession("carrier");
    const target = bridge.getOrCreateSession("target");
    const closed = browserSocket("carrier");
    carrierSession.browserSockets.add(closed);
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(closed, [{ projection: "session-attention", key: "target" }]);
    bridge.closeSession("carrier");
    closed.send.mockClear();

    target.attentionReason = "review";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(closed.send).not.toHaveBeenCalled();

    const failing = browserSocket("other-carrier");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(failing, [{ projection: "session-attention", key: "target" }]);
    failing.send.mockReturnValue(0);
    target.attentionReason = "error";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(failing.send).toHaveBeenCalledTimes(1);

    target.attentionReason = "action";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(failing.send).toHaveBeenCalledTimes(1);
    expect(bridge.getSyncedProjectionController().getMetrics().deliveryErrors).toBe(1);
  });

  it("keeps a backpressured subscriber because Bun enqueued the payload", async () => {
    const bridge = new WsBridge();
    const target = bridge.getOrCreateSession("target");
    const socket = browserSocket("carrier");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-attention", key: "target" }]);
    socket.send.mockReturnValue(-1);

    target.attentionReason = "review";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();
    target.attentionReason = "error";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();

    expect(socket.send).toHaveBeenCalledTimes(2);
    expect(bridge.getSyncedProjectionController().getMetrics().deliveryErrors).toBe(0);
  });

  it("prunes a subscriber when a resync snapshot cannot be sent", async () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("carrier");
    const target = bridge.getOrCreateSession("target");
    const socket = browserSocket("carrier");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-attention", key: "target" }]);
    socket.send.mockReturnValue(0);

    await bridge.handleBrowserMessage(
      socket,
      JSON.stringify({ type: "synced_projection_resync", projection: "session-attention", key: "target" }),
    );
    expect(socket.send).toHaveBeenCalledTimes(1);

    target.attentionReason = "review";
    bridge.persistSessionById(target.id);
    await bridge.getSyncedProjectionController().flushForTest();
    expect(socket.send).toHaveBeenCalledTimes(1);
  });
});
