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
  setAttention,
} from "./bridge/session-registry-controller.js";
import { markCodexTurnRecoveryActionRequired } from "./bridge/codex-interrupted-turn-recovery.js";
import { createLauncherHerdChangeHandler } from "./herd-change-handler.js";
import { buildEnrichedSessionsSnapshot } from "./routes/session-list-snapshot.js";
import { trafficStats } from "./traffic-stats.js";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
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
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "worker" }],
      }),
    );
    await bridge.handleBrowserMessage(
      otherCarrier,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
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
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "worker" }],
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
    const firstSnapshot = first.getSyncedProjectionController().getSnapshot(SESSION_ATTENTION_PROJECTION, "public");

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
    const secondSnapshot = second.getSyncedProjectionController().getSnapshot(SESSION_ATTENTION_PROJECTION, "public");
    expect(firstSnapshot?.generation).not.toBe(secondSnapshot?.generation);
    expect(firstSnapshot?.revision).toBe(1);
    expect(secondSnapshot?.revision).toBe(1);
  });

  it("keeps live terminal recovery quiet while publishing a later unrelated error", async () => {
    const bridge = new WsBridge();
    const worker = bridge.getOrCreateSession("worker");
    worker.state.codex_turn_recovery = {
      recoveryId: "recovery-owner",
      originalOwnerId: "recovery-owner",
      originalProviderTurnId: "provider-turn",
      originalHistoryIndex: 7,
      continuationOwnerId: "continuation-owner",
      threadKey: "main",
      status: "continuation_active",
      reason: "interrupted_after_activity",
      raisedAttention: false,
      attempt: 1,
      maxAttempts: 1,
      createdAt: 100,
      updatedAt: 200,
    };
    const socket = browserSocket("carrier");
    const controller = bridge.getSyncedProjectionController();
    const initial = controller
      .replaceSubscriptions(socket, [{ projection: SESSION_ATTENTION_PROJECTION, key: worker.id }])
      .find((message) => message.type === "synced_projection_snapshot");
    expect(initial?.value).toEqual({ attentionReason: null, status: null });

    const setAttentionError = vi.fn();
    markCodexTurnRecoveryActionRequired(worker, "continuation_interrupted", {
      broadcastToBrowsers: (session, message) => bridge.broadcastToSession(session.id, message),
      persistSession: (session) => bridge.persistSessionById(session.id),
      setAttentionError,
    });
    await controller.flushForTest();
    expect(worker.state.codex_turn_recovery).toMatchObject({ status: "action_required", raisedAttention: false });
    expect(worker.attentionReason).toBeNull();
    expect(setAttentionError).not.toHaveBeenCalled();
    expect(messages(socket)).toEqual([]);

    setAttention(worker, "error", { persistSession: (session) => bridge.persistSessionById(session.id) });
    await controller.flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      projection: SESSION_ATTENTION_PROJECTION,
      value: { attentionReason: "error", status: null },
    });
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
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
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
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
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

  it("retries the latest self-subscription requested during search-only lazy load", async () => {
    const bridge = new WsBridge();
    const carrier = bridge.getOrCreateSession("carrier");
    carrier.searchDataOnly = true;
    carrier.state.isOrchestrator = true;
    let releaseLoad!: () => void;
    const load = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    bridge.store = {
      load: vi.fn(async () => {
        await load;
        return { messageHistory: [], toolResults: [] };
      }),
      save: vi.fn(),
    } as any;
    const socket = browserSocket("carrier");

    const reconnect = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
        synced_projection_subscriptions: [{ projection: "session-attention", key: carrier.id }],
      }),
    );
    await Promise.resolve();
    const refresh = bridge.handleBrowserMessage(
      socket,
      JSON.stringify({
        type: "synced_projection_subscribe",
        subscriptions: [{ projection: "leader-thread-tabs", key: carrier.id }],
      }),
    );
    releaseLoad();
    await Promise.all([reconnect, refresh]);

    expect(
      messages(socket)
        .filter((message: any) => message.type === "synced_projection_subscriptions_ack")
        .map((message: any) => message.subscriptions),
    ).toEqual([[], [], [{ projection: "leader-thread-tabs", key: carrier.id }]]);
    expect(
      messages(socket).filter(
        (message: any) =>
          message.type === "synced_projection_snapshot" &&
          message.projection === "leader-thread-tabs" &&
          message.key === carrier.id,
      ),
    ).toHaveLength(1);
    expect(bridge.getSyncedProjectionController().hasSubscription(socket, "leader-thread-tabs", carrier.id)).toBe(true);
    expect(bridge.getSyncedProjectionController().hasSubscription(socket, "session-attention", carrier.id)).toBe(false);
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
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
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

  it("publishes name, timer, herd, and status changes through the bounded navigation projection", async () => {
    const bridge = new WsBridge();
    let sessionName = "Before";
    let timers: unknown[] = [];
    const launcherSessions = new Map<string, any>([
      [
        "worker",
        {
          sessionId: "worker",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 2,
          backendType: "codex",
          archived: false,
        },
      ],
      [
        "leader",
        {
          sessionId: "leader",
          state: "connected",
          cwd: "/repo",
          createdAt: 1,
          sessionNum: 1,
          backendType: "codex",
          isOrchestrator: true,
        },
      ],
    ]);
    bridge.launcher = {
      getSession: (sessionId: string) => launcherSessions.get(sessionId),
      getSessionNum: (sessionId: string) => launcherSessions.get(sessionId)?.sessionNum,
    } as any;
    bridge.sessionNameGetter = () => sessionName;
    bridge.sessionStoredNameGetter = () => sessionName;
    bridge.timerManager = { listTimers: () => timers } as any;
    const worker = bridge.getOrCreateSession("worker", "codex");
    worker.state.model = "gpt-5.6";
    worker.state.cwd = "/repo";
    worker.state.repo_root = "/repo";
    const socket = browserSocket("leader");

    const initial = bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-navigation", key: "worker" }])
      .find((message) => message.type === "synced_projection_snapshot");
    expect(initial).toMatchObject({
      projection: "session-navigation",
      key: "worker",
      value: { name: "Before", herdedBy: null, pendingTimerCount: 0, status: null },
    });

    sessionName = "After";
    bridge.invalidateSessionNavigation("worker");
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).some((message: any) => message.type === "session_name_update")).toBe(false);
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      projection: "session-navigation",
      patch: { name: "After" },
    });

    timers = [{ id: "t1" }];
    bridge.broadcastToSession("worker", { type: "timer_update", timers: timers as any });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      patch: { pendingTimerCount: 1 },
    });

    const handleHerdChange = createLauncherHerdChangeHandler({
      dispatcher: { onHerdChanged: vi.fn() },
      wsBridge: bridge,
      launcher: bridge.launcher!,
      getSessionName: () => undefined,
    });
    launcherSessions.get("worker").herdedBy = "leader";
    handleHerdChange({ type: "membership_changed", leaderId: "leader" });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      patch: { herdedBy: "leader" },
    });

    bridge.broadcastToSession("worker", { type: "status_change", status: "running" });
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket).at(-1)).toMatchObject({
      type: "synced_projection_update",
      patch: { status: "running" },
    });

    const metrics = bridge.getSyncedProjectionController().getMetrics().projections["session-navigation"];
    expect(metrics).toMatchObject({ updates: 4, deliveries: 4 });
    expect(metrics.valueBytes).toBeGreaterThan(0);
    expect(metrics.snapshotValueBytes).toBeGreaterThan(0);
    expect(metrics.updateValueBytes).toBeGreaterThan(0);
    expect(metrics.deliveredValueBytes).toBeGreaterThan(0);
  });

  it("uses the launcher-stored canonical name instead of a generic display label", () => {
    const bridge = new WsBridge();
    const launcherSession = {
      sessionId: "legacy-worker",
      state: "exited",
      cwd: "/repo",
      createdAt: 1,
      sessionNum: 9,
      backendType: "claude",
      archived: false,
      name: "Recovered launcher name",
    };
    bridge.launcher = {
      getSession: (sessionId: string) => (sessionId === launcherSession.sessionId ? launcherSession : undefined),
      getSessionNum: () => launcherSession.sessionNum,
    } as any;
    bridge.sessionNameGetter = (sessionId) => sessionId.slice(0, 8);
    bridge.sessionStoredNameGetter = () => undefined;
    const worker = bridge.getOrCreateSession(launcherSession.sessionId);
    worker.state.cwd = launcherSession.cwd;

    const snapshot = bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(browserSocket("carrier"), [
        { projection: "session-navigation", key: launcherSession.sessionId },
      ])
      .find((message) => message.type === "synced_projection_snapshot");

    expect(snapshot).toMatchObject({
      value: { name: "Recovered launcher name" },
    });
  });

  it("publishes REST turn-metric repairs to every established navigation subscriber", async () => {
    const bridge = new WsBridge();
    const launcherSession = {
      sessionId: "worker",
      state: "connected",
      cwd: "/repo",
      createdAt: 1,
      backendType: "claude",
      archived: false,
      isWorktree: false,
    };
    const launcher = {
      listSessions: () => [launcherSession],
      getSession: (sessionId: string) => (sessionId === "worker" ? launcherSession : undefined),
      getSessionNum: () => 1,
      setWorktreeCleanupState: vi.fn(),
      setLeaderProfilePortraitId: vi.fn(),
    } as any;
    bridge.launcher = launcher;
    const worker = bridge.getOrCreateSession("worker");
    worker.state.cwd = "/repo";
    const first = browserSocket("carrier-1");
    const second = browserSocket("carrier-2");
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(first, [{ projection: "session-navigation", key: "worker" }]);
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(second, [{ projection: "session-navigation", key: "worker" }]);
    first.send.mockClear();
    second.send.mockClear();

    // Simulate restored history whose exact turn metrics have not yet been
    // repaired into SessionState. The REST snapshot must publish that repair,
    // not silently advance only the runtime cache.
    worker.messageHistory.push(
      { type: "user_message", content: "work", timestamp: 1, id: "u-1" },
      {
        type: "assistant",
        parent_tool_use_id: null,
        message: {
          id: "a-1",
          type: "message",
          role: "assistant",
          model: "test",
          content: [],
          stop_reason: null,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
      { type: "result", data: {} } as any,
    );

    const snapshot = await buildEnrichedSessionsSnapshot({
      launcher,
      wsBridge: bridge,
      pendingWorktreeCleanups: new Map(),
    });

    expect(snapshot[0]?.sessionNavigationProjection).toMatchObject({
      revision: 2,
      value: { userTurnCount: 1, agentTurnCount: 1 },
    });
    for (const socket of [first, second]) {
      expect(messages(socket)).toEqual([
        expect.objectContaining({
          type: "synced_projection_update",
          projection: "session-navigation",
          key: "worker",
          revision: 2,
          patch: expect.objectContaining({ userTurnCount: 1, agentTurnCount: 1 }),
        }),
      ]);
    }
  });

  it("publishes bounded launcher activity changes without snapshot-only revision advances", async () => {
    const bridge = new WsBridge();
    const launcherSession = {
      sessionId: "worker",
      state: "connected",
      cwd: "/repo",
      createdAt: 1,
      backendType: "claude",
      archived: false,
      lastActivityAt: 10,
    };
    bridge.launcher = {
      getSession: (sessionId: string) => (sessionId === "worker" ? launcherSession : undefined),
      getSessionNum: () => 1,
      touchActivity: () => {
        launcherSession.lastActivityAt = 1_020;
      },
    } as any;
    bridge.getOrCreateSession("worker").state.cwd = "/repo";
    const socket = browserSocket("carrier");
    const initial = bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(socket, [{ projection: "session-navigation", key: "worker" }])
      .find((message) => message.type === "synced_projection_snapshot");
    expect(initial).toMatchObject({ revision: 1, value: { lastActivityAt: 10 } });
    socket.send.mockClear();

    launcherSession.lastActivityAt = 20;
    expect(bridge.getSyncedProjectionController().getSnapshot(SESSION_NAVIGATION_PROJECTION, "worker")).toMatchObject({
      revision: 1,
      value: { lastActivityAt: 10 },
    });
    expect(socket.send).not.toHaveBeenCalled();

    bridge.touchSessionActivity("worker");
    await bridge.getSyncedProjectionController().flushForTest();
    expect(messages(socket)).toEqual([
      expect.objectContaining({
        type: "synced_projection_update",
        revision: 2,
        patch: expect.objectContaining({ lastActivityAt: 1_020 }),
      }),
    ]);
  });

  it("broadcasts notification summaries without raw attention fallback fields", () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("target");
    bridge.getOrCreateSession("other-target");
    const subscribedCarrier = bridge.getOrCreateSession("subscribed-carrier");
    const otherCarrier = bridge.getOrCreateSession("other-carrier");
    const subscribed = browserSocket("subscribed-carrier");
    const otherSubscription = browserSocket("other-carrier");
    subscribedCarrier.browserSockets.add(subscribed);
    otherCarrier.browserSockets.add(otherSubscription);
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(subscribed, [{ projection: "session-navigation", key: "target" }]);
    bridge
      .getSyncedProjectionController()
      .replaceSubscriptions(otherSubscription, [{ projection: "session-navigation", key: "other-target" }]);
    subscribed.send.mockClear();
    otherSubscription.send.mockClear();

    bridge.broadcastGlobal({
      type: "session_activity_update",
      session_id: "target",
      session: {
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
        notificationStatusVersion: 1,
        notificationStatusUpdatedAt: 1000,
      },
    });

    const expected = {
      type: "session_activity_update",
      session_id: "target",
      session: expect.objectContaining({
        notificationUrgency: "review",
        activeNotificationCount: 1,
        activeReviewNotificationCount: 1,
      }),
    };
    expect(messages(subscribed)).toEqual([expect.objectContaining(expected)]);
    expect(messages(otherSubscription)).toEqual([expect.objectContaining(expected)]);
  });
});
