import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());
const mockShouldSettingsRuleApprove = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("node:crypto", () => ({ randomUUID: () => "test-uuid" }));
vi.mock("./bridge/settings-rule-matcher.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./bridge/settings-rule-matcher.js")>();
  return {
    ...original,
    shouldSettingsRuleApprove: mockShouldSettingsRuleApprove,
  };
});

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  notifyUser as notifyUserController,
  recordThreadReadyUnreadNotifications,
} from "./bridge/session-registry-controller.js";
import { SessionStore } from "./session-store.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

function createMockSocket(data: SocketData) {
  return {
    data,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function makeCliSocket(sessionId: string) {
  return createMockSocket({ kind: "cli", sessionId });
}

function makeBrowserSocket(sessionId: string) {
  return createMockSocket({ kind: "browser", sessionId });
}

function getNotificationTestDeps(bridge: WsBridge) {
  return {
    isHerdedWorkerSession: (session: any) => !!(bridge as any).launcher?.getSession(session.id)?.herdedBy,
    broadcastToBrowsers: (session: any, msg: any) => bridge.broadcastToSession(session.id, msg),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    emitTakodeEvent: (sessionId: string, type: string, data: Record<string, unknown>) =>
      bridge.emitTakodeEvent(sessionId, type as any, data as any),
    scheduleNotification: () => undefined,
  };
}

function sentMessages(socket: { send: ReturnType<typeof vi.fn> }) {
  return socket.send.mock.calls.map((call) => JSON.parse(String(call[0])));
}

describe("notification status fanout", () => {
  it("broadcasts lightweight notification status globally without full inbox fanout", () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "notification-status-")));

    const workerCli = makeCliSocket("worker");
    const leaderCli = makeCliSocket("leader");
    const workerBrowser = makeBrowserSocket("worker");
    const leaderBrowser = makeBrowserSocket("leader");
    bridge.handleCLIOpen(workerCli, "worker");
    bridge.handleCLIOpen(leaderCli, "leader");
    bridge.handleBrowserOpen(workerBrowser, "worker");
    bridge.handleBrowserOpen(leaderBrowser, "leader");
    workerBrowser.send.mockClear();
    leaderBrowser.send.mockClear();

    const result = notifyUserController(
      bridge.getSession("worker")!,
      "needs-input",
      "Need a decision",
      getNotificationTestDeps(bridge),
    );

    expect(result.ok).toBe(true);
    const workerMessages = sentMessages(workerBrowser);
    const leaderMessages = sentMessages(leaderBrowser);
    expect(workerMessages.some((msg) => msg.type === "notification_update" && Array.isArray(msg.notifications))).toBe(
      true,
    );
    expect(leaderMessages.some((msg) => msg.type === "notification_update")).toBe(false);
    const globalStatus = leaderMessages.find((msg) => msg.type === "session_activity_update");
    expect(globalStatus).toMatchObject({
      session_id: "worker",
      session: {
        notificationUrgency: "needs-input",
        activeNotificationCount: 1,
        notificationStatusVersion: 1,
      },
    });
    expect(typeof globalStatus.session.notificationStatusUpdatedAt).toBe("number");
    expect(globalStatus.session.notifications).toBeUndefined();
  });

  it("fans later Thread Ready count changes through compact summary and scoped projection", async () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "thread-ready-status-")));

    const workerCli = makeCliSocket("worker");
    const leaderCli = makeCliSocket("leader");
    const workerBrowser = makeBrowserSocket("worker");
    const leaderBrowser = makeBrowserSocket("leader");
    bridge.handleCLIOpen(workerCli, "worker");
    bridge.handleCLIOpen(leaderCli, "leader");
    bridge.handleBrowserOpen(workerBrowser, "worker");
    bridge.handleBrowserOpen(leaderBrowser, "leader");
    await bridge.handleBrowserMessage(
      leaderBrowser,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "worker" }],
      }),
    );

    const session = bridge.getSession("worker")!;
    session.state.isOrchestrator = true;
    const deps = getNotificationTestDeps(bridge);
    const ready = (questId: string, timestamp: number) => ({
      kind: "ready" as const,
      label: "Thread Ready" as const,
      threadKey: questId,
      questId,
      summary: `${questId} complete`,
      messageId: `message-${questId}`,
      timestamp,
      updatedAt: timestamp,
    });

    expect(recordThreadReadyUnreadNotifications(session, [ready("q-1977", 11_000)], deps)).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();
    workerBrowser.send.mockClear();
    leaderBrowser.send.mockClear();

    // attentionReason is already "review", so only the notification-status
    // change can carry the second unread count to the other browser socket.
    expect(recordThreadReadyUnreadNotifications(session, [ready("q-1978", 12_000)], deps)).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();

    const workerMessages = sentMessages(workerBrowser);
    const leaderMessages = sentMessages(leaderBrowser);
    expect(workerMessages.some((msg) => msg.type === "notification_update")).toBe(true);
    expect(leaderMessages.some((msg) => msg.type === "notification_update")).toBe(false);
    expect(leaderMessages.find((msg) => msg.type === "session_activity_update")).toMatchObject({
      session_id: "worker",
      session: {
        attentionReason: "review",
        notificationUrgency: "review",
        activeNotificationCount: 2,
        activeReviewNotificationCount: 2,
        notificationStatusVersion: 2,
      },
    });
    expect(leaderMessages.find((msg) => msg.type === "synced_projection_update")).toMatchObject({
      projection: "session-attention",
      key: "worker",
      value: { attentionReason: "review", status: { urgency: "review", count: 2 } },
    });
  });
});
