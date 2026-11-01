import { describe, expect, it, vi } from "vitest";
import type { BrowserOutgoingMessage, SessionNotification } from "../session-types.js";
import { ingestUserMessage } from "./adapter-browser-routing-controller.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

/**
 * Replying in a thread reads it, as in Slack (Jiayi's pick, Oct 31): sending a message or answering
 * a question in one of a leader's threads marks that thread's earlier unread answers, reports and
 * results read. Before this, an answer that never stayed on screen for a second (for example just
 * below a question the user answered from a phone alert) stayed unread after the user replied.
 */
describe("replying in a thread reads its earlier results", () => {
  it("reads the thread's earlier results when the user sends a message there", async () => {
    const target = session([
      review("n-1", { threadKey: "topic:aa11bb22", timestamp: 100 }),
      review("n-2", { threadKey: "topic:aa11bb22", timestamp: 200, unreadReason: "report" }),
      review("n-3", { threadKey: "q-7", timestamp: 150 }),
      question("n-4", { threadKey: "topic:aa11bb22", timestamp: 120 }),
      review("n-5", { threadKey: "topic:aa11bb22", timestamp: 2_000_000_000_000 }),
    ]);
    const runtime = deps();
    await ingestUserMessage(target, message({ threadKey: "topic:aa11bb22" }), runtime);
    // Its answers and reports from before the reply are read; another thread's answer, an open
    // question and a result written after the reply are not.
    expect(doneIds(target)).toEqual(["n-1", "n-2"]);
    expect((target.notifications as SessionNotification[]).find((n) => n.id === "n-1")?.doneAt).toEqual(
      expect.any(Number),
    );
    expect(runtime.broadcastToBrowsers).toHaveBeenCalledWith(
      target,
      expect.objectContaining({ type: "notification_update" }),
    );
    expect(runtime.persistSession).toHaveBeenCalledWith(target);
  });

  it("reads a quest's thread whose results name only the quest, including a finished quest's", async () => {
    const target = session([
      review("n-1", { questId: "q-42", timestamp: 100 }),
      review("n-2", { threadKey: "Q-42", timestamp: 110, unreadReason: "quest-complete" }),
      review("n-3", { timestamp: 120 }),
    ]);
    await ingestUserMessage(target, message({ threadKey: "q-42" }), deps());
    expect(doneIds(target)).toEqual(["n-1", "n-2"]);
  });

  it("reads before the message is committed, as for a Codex leader", async () => {
    // A Codex leader's message is stored later (`commit: false`); the reply still reads the thread.
    const target = session([review("n-1", { threadKey: "q-42", timestamp: 100 })]);
    await ingestUserMessage(target, message({ threadKey: "q-42" }), deps(), { commit: false });
    expect(doneIds(target)).toEqual(["n-1"]);
  });

  it("reads nothing for messages the user didn't write, or outside a leader", async () => {
    // A timer firing or herd delivery is not the user replying; a worker's notifications are its
    // own business.
    const timer = session([review("n-1", { threadKey: "q-42", timestamp: 100 })]);
    await ingestUserMessage(
      timer,
      message({ threadKey: "q-42", agentSource: { sessionId: "timer:t1", sessionLabel: "Timer t1" } }),
      deps(),
    );
    expect(doneIds(timer)).toEqual([]);
    const worker = session([review("n-1", { threadKey: "q-42", timestamp: 100 })]);
    await ingestUserMessage(worker, message({ threadKey: "q-42" }), deps(false));
    expect(doneIds(worker)).toEqual([]);
  });

  it("does nothing when the thread has nothing unread", async () => {
    const target = session([review("n-1", { threadKey: "q-42", timestamp: 100, done: true })]);
    const runtime = deps();
    await ingestUserMessage(target, message({ threadKey: "q-42" }), runtime);
    expect(runtime.persistSession).not.toHaveBeenCalled();
  });
});

function review(id: string, fields: Partial<SessionNotification>): SessionNotification {
  return { id, category: "review", summary: "", done: false, unreadReason: "answer", ...fields } as SessionNotification;
}

function question(id: string, fields: Partial<SessionNotification>): SessionNotification {
  return { id, category: "needs-input", summary: "", done: false, ...fields } as SessionNotification;
}

function message(fields: Partial<Extract<BrowserOutgoingMessage, { type: "user_message" }>>) {
  return { type: "user_message" as const, content: "Thanks, go ahead.", ...fields };
}

function doneIds(target: AdapterBrowserRoutingSessionLike): string[] {
  return (target.notifications as SessionNotification[]).filter((n) => n.done).map((n) => n.id);
}

function session(notifications: SessionNotification[]): AdapterBrowserRoutingSessionLike {
  return {
    id: "leader",
    backendType: "claude-sdk",
    state: { session_id: "leader", cwd: "/tmp", backend_state: "connected" },
    messageHistory: [],
    notifications,
    pendingPermissions: new Map(),
    pendingMessages: [],
    pendingCodexTurns: [],
    pendingCodexInputs: [],
    forceCompactPending: false,
    isGenerating: false,
    lastUserMessageDateTag: "",
    consecutiveAdapterFailures: 0,
    codexAdapter: null,
    claudeSdkAdapter: null,
  } as unknown as AdapterBrowserRoutingSessionLike;
}

function deps(isOrchestrator = true) {
  return {
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator })),
    nextUserMessageId: vi.fn(() => "user-1"),
    promoteLeaderThreadTabForMessageAttention: vi.fn(),
    touchUserMessage: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    refreshBrowserConversationViews: vi.fn(),
    invalidateLeaderThreadTabsForSession: vi.fn(() => true),
    emitTakodeEvent: vi.fn(),
  } as unknown as AdapterBrowserRoutingDeps;
}
