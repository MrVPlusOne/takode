import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("node:crypto", () => ({ randomUUID: () => "test-uuid" }));

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markNotificationDone,
  notifyUser as notifyUserController,
  recordAnswerUnreadNotifications,
} from "./bridge/session-registry-controller.js";
import { receiveSyncedList } from "../src/utils/synced-lists.js";
import type { SessionNotification } from "./session-types.js";
import { SessionStore } from "./session-store.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";

function createMockSocket(data: SocketData) {
  return {
    data,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function makeCliSocket(sessionId: string) {
  return createClaudeSdkTestBackend(sessionId);
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
    workerCli.attach(bridge);
    leaderCli.attach(bridge);
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
    expect(workerMessages.some((msg) => msg.type === "session_update" && "attentionReason" in msg.session)).toBe(false);
    expect(leaderMessages.some((msg) => msg.type === "notification_update")).toBe(false);
    const globalStatuses = leaderMessages.filter((msg) => msg.type === "session_activity_update");
    expect(globalStatuses).toHaveLength(1);
    const globalStatus = globalStatuses[0];
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

  // Every inbox change used to resend the whole list, mostly resolved entries
  // (about 100 KB on a busy leader). After the first update, each update
  // carries only what changed since the previous one, and a browser applying
  // them in order holds exactly the server's list.
  it("sends later inbox changes as deltas that rebuild the server's exact list", () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "notification-delta-")));
    makeCliSocket("worker").attach(bridge);
    const browser = makeBrowserSocket("worker");
    bridge.handleBrowserOpen(browser, "worker");
    browser.send.mockClear();
    const session = bridge.getSession("worker")!;
    const deps = getNotificationTestDeps(bridge);

    const first = notifyUserController(session, "needs-input", "First question", deps);
    notifyUserController(session, "needs-input", "Second question", deps);
    markNotificationDone(session, first.notificationId!, true, deps);

    const updates = sentMessages(browser).filter((msg) => msg.type === "notification_update");
    expect(updates).toHaveLength(3);
    expect(updates[0].notifications).toHaveLength(1);
    expect(updates[1]).not.toHaveProperty("notifications");
    expect(updates[1].notificationsDelta.upserts.map((n: { summary: string }) => n.summary)).toEqual([
      "Second question",
    ]);
    expect(updates[2].notificationsDelta).toMatchObject({ upserts: [{ id: first.notificationId, done: true }] });

    let held: SessionNotification[] | null = null;
    for (const update of updates) {
      held = receiveSyncedList<SessionNotification>(
        "notifications",
        "worker",
        { list: update.notifications, delta: update.notificationsDelta, hash: update.notificationsHash },
        (notification) => notification.id,
      );
      expect(held).not.toBeNull();
    }
    expect(held).toEqual(JSON.parse(JSON.stringify(session.notifications)));
  });

  // A browser whose copy did not fit an update asks for the list again over its socket.
  it("answers a list resync over the socket with the list as the browser should hold it", async () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "notification-resync-")));
    makeCliSocket("worker").attach(bridge);
    const browser = makeBrowserSocket("worker");
    bridge.handleBrowserOpen(browser, "worker");
    const session = bridge.getSession("worker")!;
    notifyUserController(session, "needs-input", "Question", getNotificationTestDeps(bridge));
    browser.send.mockClear();

    await bridge.handleBrowserMessage(
      browser,
      JSON.stringify({ type: "list_resync", list: "notifications", held: "x" }),
    );

    const [answer] = sentMessages(browser);
    expect(answer).toMatchObject({
      type: "notification_update",
      notifications: [{ summary: "Question" }],
      activeNeedsInputNotificationCount: 1,
    });
  });

  // The page showing a session marks it read on every session-list change; over
  // its socket that does exactly what `PATCH /sessions/:id/read` in session-view mode does.
  it("clears unread state for a session_read message like the session-view read request", async () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "session-read-")));
    makeCliSocket("worker").attach(bridge);
    const browser = makeBrowserSocket("worker");
    bridge.handleBrowserOpen(browser, "worker");
    const session = bridge.getSession("worker")!;
    session.attentionReason = "review";
    session.manualUnread = true;

    await bridge.handleBrowserMessage(browser, JSON.stringify({ type: "session_read", mode: "session-view" }));

    expect(session.attentionReason).toBeNull();
    expect(session.manualUnread).toBe(false);
    expect(session.lastReadAt).toEqual(expect.any(Number));
  });

  it("fans later answer unread count changes through compact summary and scoped projection", async () => {
    const bridge = new WsBridge();
    bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "thread-ready-status-")));

    const workerCli = makeCliSocket("worker");
    const leaderCli = makeCliSocket("leader");
    const workerBrowser = makeBrowserSocket("worker");
    const leaderBrowser = makeBrowserSocket("leader");
    workerCli.attach(bridge);
    leaderCli.attach(bridge);
    bridge.handleBrowserOpen(workerBrowser, "worker");
    bridge.handleBrowserOpen(leaderBrowser, "leader");
    await bridge.handleBrowserMessage(
      leaderBrowser,
      JSON.stringify({
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
        synced_projection_subscriptions: [{ projection: "session-attention", key: "worker" }],
      }),
    );

    const session = bridge.getSession("worker")!;
    session.state.isOrchestrator = true;
    const deps = getNotificationTestDeps(bridge);
    // A settled leader answer authored in the quest thread.
    const answer = (questId: string, timestamp: number) =>
      ({
        type: "assistant",
        message: { id: `message-${questId}`, content: [{ type: "text", text: `${questId} complete` }] },
        parent_tool_use_id: null,
        timestamp,
        threadKey: questId,
        questId,
        threadAnswer: { version: 2, answerUserMessageIds: ["u1"], authoredThreadKey: questId },
      }) as any;

    expect(recordAnswerUnreadNotifications(session, [answer("q-1977", 11_000)], deps)).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();
    workerBrowser.send.mockClear();
    leaderBrowser.send.mockClear();

    // attentionReason is already "review", so only the notification-status
    // change can carry the second unread count to the other browser socket.
    expect(recordAnswerUnreadNotifications(session, [answer("q-1978", 12_000)], deps)).toBe(true);
    await bridge.getSyncedProjectionController().flushForTest();

    const workerMessages = sentMessages(workerBrowser);
    const leaderMessages = sentMessages(leaderBrowser);
    expect(workerMessages.some((msg) => msg.type === "notification_update")).toBe(true);
    expect(leaderMessages.some((msg) => msg.type === "notification_update")).toBe(false);
    expect(leaderMessages.find((msg) => msg.type === "session_activity_update")).toMatchObject({
      session_id: "worker",
      session: {
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
    expect(leaderMessages.filter((msg) => msg.type === "session_activity_update")).toHaveLength(1);
    expect(workerMessages.some((msg) => msg.type === "session_update" && "attentionReason" in msg.session)).toBe(false);
  });
});
