import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));
vi.mock("node:crypto", () => ({ randomUUID: () => "test-uuid" }));

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleResultAttentionAndNotifications,
  notifyUser,
  recordAnswerUnreadNotifications,
} from "./bridge/session-registry-controller.js";
import { SessionStore } from "./session-store.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";
import { createClaudeSdkTestBackend } from "./claude-sdk-test-helpers.js";

// Attention alerts tell every browser that a tab got a needs-input prompt for the user
// or newly turned unread; each browser then decides whether to play a sound.

function makeBrowserSocket(sessionId: string) {
  return { data: { kind: "browser", sessionId } as SocketData, send: vi.fn(), close: vi.fn(), readyState: 1 } as any;
}

function alertsSent(socket: { send: ReturnType<typeof vi.fn> }) {
  return socket.send.mock.calls
    .map((call) => JSON.parse(String(call[0])))
    .filter((msg) => msg.type === "attention_alert")
    .map(({ session_id, kind, thread_key }) => ({ session_id, kind, thread_key }));
}

function setup() {
  const bridge = new WsBridge();
  bridge.store = new SessionStore(mkdtempSync(join(tmpdir(), "attention-alerts-")));
  const leaders = new Set<string>(["leader"]);
  const herded = new Set<string>(["worker"]);
  for (const id of ["leader", "worker", "solo"]) createClaudeSdkTestBackend(id).attach(bridge);
  bridge.getSession("leader")!.state.isOrchestrator = true;
  // The browser shows the solo session; alerts from every session must still reach it.
  const browser = makeBrowserSocket("solo");
  bridge.handleBrowserOpen(browser, "solo");
  browser.send.mockClear();
  const deps = {
    isHerdedWorkerSession: (session: any) => herded.has(session.id),
    getLauncherSessionInfo: (sessionId: string) => ({ isOrchestrator: leaders.has(sessionId) }),
    broadcastToBrowsers: (session: any, msg: any) => bridge.broadcastToSession(session.id, msg),
    persistSession: (session: any) => bridge.persistSessionById(session.id),
    emitTakodeEvent: () => undefined,
    scheduleNotification: () => undefined,
  };
  return { bridge, browser, deps };
}

function leaderAnswer(threadKey: string, id: string) {
  return {
    type: "assistant",
    message: { id, content: [{ type: "text", text: `${threadKey} done` }] },
    parent_tool_use_id: null,
    timestamp: Date.now(),
    threadKey,
    questId: threadKey,
    threadAnswer: { version: 2, answerUserMessageIds: ["u1"], authoredThreadKey: threadKey },
  } as any;
}

describe("attention alerts", () => {
  it("alerts every browser about a user's needs-input prompt, but not a worker's question to its leader", () => {
    const { bridge, browser, deps } = setup();

    notifyUser(bridge.getSession("leader")!, "needs-input", "Pick one", deps, { threadRoute: { threadKey: "q-7" } });
    notifyUser(bridge.getSession("solo")!, "needs-input", "Which file?", deps);
    notifyUser(bridge.getSession("worker")!, "needs-input", "Leader, which file?", deps);

    expect(alertsSent(browser)).toEqual([
      { session_id: "leader", kind: "needs-input", thread_key: "q-7" },
      { session_id: "solo", kind: "needs-input", thread_key: undefined },
    ]);
  });

  it("alerts once when a leader thread tab turns unread, not for more results in the same tab", () => {
    const { bridge, browser, deps } = setup();
    const leader = bridge.getSession("leader")!;

    recordAnswerUnreadNotifications(leader, [leaderAnswer("q-1", "a1"), leaderAnswer("q-1", "a2")], deps);
    recordAnswerUnreadNotifications(leader, [leaderAnswer("q-2", "a3")], deps);
    // Reading q-1 and getting a new answer there makes it newly unread again.
    for (const notification of leader.notifications) {
      if (notification.threadKey === "q-1") notification.done = true;
    }
    recordAnswerUnreadNotifications(leader, [leaderAnswer("q-1", "a4")], deps);

    expect(alertsSent(browser)).toEqual([
      { session_id: "leader", kind: "result", thread_key: "q-1" },
      { session_id: "leader", kind: "result", thread_key: "q-2" },
      { session_id: "leader", kind: "result", thread_key: "q-1" },
    ]);
  });

  it("alerts when an ordinary session turns unread after a turn, not while it is already unread", () => {
    const { bridge, browser, deps } = setup();
    const solo = bridge.getSession("solo")!;
    const result = { type: "result", subtype: "success", is_error: false } as any;

    handleResultAttentionAndNotifications(solo, result, "user", deps);
    handleResultAttentionAndNotifications(solo, result, "user", deps);
    // A leader's own turn end is not an unread tab; its answers are.
    handleResultAttentionAndNotifications(bridge.getSession("leader")!, result, "user", deps);

    expect(alertsSent(browser)).toEqual([{ session_id: "solo", kind: "result", thread_key: undefined }]);
  });

  it("does not count a review on an already unread session as newly unread", () => {
    const { bridge, browser, deps } = setup();
    const solo = bridge.getSession("solo")!;

    notifyUser(solo, "review", "Ready", deps);
    notifyUser(solo, "review", "Ready again", deps);

    expect(alertsSent(browser)).toEqual([{ session_id: "solo", kind: "result", thread_key: undefined }]);
  });
});
