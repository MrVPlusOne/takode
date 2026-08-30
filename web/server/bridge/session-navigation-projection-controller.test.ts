import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import type { Session } from "./ws-bridge-session.js";
import {
  SessionNavigationProjectionSourceController,
  suppressProjectedSessionNavigationActivityFields,
} from "./session-navigation-projection-controller.js";

function makeSession(history: BrowserIncomingMessage[] = []): Session {
  return {
    id: "session-1",
    backendType: "claude",
    state: { is_compacting: false } as Session["state"],
    messageHistory: history,
    browserSockets: new Set(),
    pendingPermissions: new Map(),
    isGenerating: false,
  } as unknown as Session;
}

function makeController(session: Session) {
  let connected = true;
  let lastActivityAt: number | undefined;
  const deriveSessionStatus = vi.fn(() => (connected ? (session.isGenerating ? "running" : "idle") : null));
  const controller = new SessionNavigationProjectionSourceController({
    getSession: (sessionId) => (sessionId === session.id ? session : undefined),
    getLauncherSessionInfo: () =>
      lastActivityAt === undefined
        ? undefined
        : { sessionId: session.id, state: "connected", cwd: "/repo", createdAt: 1, lastActivityAt },
    getStoredSessionName: () => "Projected name",
    getPendingTimerCount: () => 2,
    getBackendConnected: () => connected,
    deriveSessionStatus,
  });
  return {
    controller,
    deriveSessionStatus,
    setConnected(value: boolean) {
      connected = value;
    },
    setLastActivityAt(value: number | undefined) {
      lastActivityAt = value;
    },
  };
}

describe("SessionNavigationProjectionSourceController", () => {
  it("preserves the exact human-only activity timestamp across append-only history updates", () => {
    const human = { type: "user_message", content: "human", timestamp: 100, id: "u-1" } as const;
    const injected = {
      type: "user_message",
      content: "timer",
      timestamp: 200,
      id: "u-2",
      agentSource: { sessionId: "timer:t1" },
    } as const;
    const session = makeSession([human, injected] as BrowserIncomingMessage[]);
    session.lastUserMessage = "timer";
    const { controller } = makeController(session);

    expect(controller.getLastUserMessageAt(session.id)).toBe(100);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);

    session.messageHistory.push({
      type: "user_message",
      content: "child prompt",
      timestamp: 250,
      id: "u-child",
      agentSource: { sessionId: "codex-child:child-1" },
      codexSubagent: { childId: "child-1", rootTurnId: "root-1" },
    } as BrowserIncomingMessage);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);

    // Appended non-human traffic must reuse the cached human authority rather
    // than promoting leader/timer injections into sidebar activity ordering.
    session.messageHistory.push({ type: "assistant", message: { content: [] } } as unknown as BrowserIncomingMessage);
    expect(controller.getLastUserMessageAt(session.id)).toBe(100);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);

    session.messageHistory.push({ type: "user_message", content: "next", timestamp: 300, id: "u-3" });
    session.lastUserMessage = "next";
    expect(controller.getLastUserMessageAt(session.id)).toBe(300);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(300);

    // History replacement/revert invalidates the append-only cache and repairs
    // from the new authoritative sequence even when its length is unchanged.
    session.messageHistory = [
      { type: "user_message", content: "replacement", timestamp: 400, id: "u-4" },
      injected,
      { type: "assistant", message: { content: [] } } as unknown as BrowserIncomingMessage,
      { type: "result", data: {} } as unknown as BrowserIncomingMessage,
    ];
    session.lastUserMessage = "timer";
    expect(controller.getLastUserMessageAt(session.id)).toBe(400);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);
  });

  it("pairs a pending Codex preview with its timestamp before history commit", () => {
    const session = makeSession([{ type: "user_message", content: "human", timestamp: 100, id: "u-1" }]);
    session.lastUserMessage = "[reply] queued context";
    session.pendingCodexInputs = [
      {
        id: "pending-1",
        content: "",
        timestamp: 200,
        cancelable: true,
        agentSource: { sessionId: "timer:t1" },
        replyContext: { previewText: "queued context" },
      },
    ];
    const { controller } = makeController(session);

    expect(controller.getLastUserMessageAt(session.id)).toBe(100);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);
    expect(
      controller.captureSourceMessage(session, { type: "codex_pending_inputs", inputs: session.pendingCodexInputs }),
    ).toBe(true);

    // Cancellation removes the pending owner, but the visible preview remains
    // unchanged, so its previously resolved freshness timestamp must survive.
    session.pendingCodexInputs = [];
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(200);

    session.messageHistory.push({
      type: "user_message",
      content: "",
      timestamp: 300,
      id: "u-reply",
      replyContext: { previewText: "history context" },
    });
    session.lastUserMessage = "[reply] history context";
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(300);

    session.messageHistory = [{ type: "user_message", content: "human", timestamp: 100, id: "u-1" }];
    session.lastUserMessage = "human";
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(100);
  });

  it("keeps the base preview timestamp when later history follow-ups do not own the preview", () => {
    const base = {
      type: "user_message",
      content: "base input",
      timestamp: 100,
      id: "u-base",
      agentSource: { sessionId: "leader:1" },
    } as const;
    const followUp = {
      type: "user_message",
      content: "follow-up receipt",
      timestamp: 200,
      id: "u-follow-up",
      agentSource: { sessionId: "system:receipt" },
    } as const;
    const session = makeSession([base, followUp] as BrowserIncomingMessage[]);
    session.lastUserMessage = "base input";
    const { controller } = makeController(session);

    expect(controller.getLastMessagePreviewAt(session.id)).toBe(100);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(100);

    session.messageHistory.push({ type: "result", data: {} } as unknown as BrowserIncomingMessage);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(100);

    session.messageHistory.push({ ...base, id: "u-base-2", timestamp: 300 }, followUp);
    expect(controller.getLastMessagePreviewAt(session.id)).toBe(300);
  });

  it("tracks explicit transient status and clears it when connection authority changes", () => {
    const session = makeSession();
    const { controller, deriveSessionStatus, setConnected } = makeController(session);

    expect(controller.getSessionStatus(session.id)).toBe("idle");
    expect(deriveSessionStatus).toHaveBeenCalledTimes(1);

    expect(controller.captureSourceMessage(session, { type: "status_change", status: "running" })).toBe(true);
    expect(controller.getSessionStatus(session.id)).toBe("running");
    expect(deriveSessionStatus).toHaveBeenCalledTimes(1);

    setConnected(false);
    expect(controller.captureSourceMessage(session, { type: "backend_disconnected" })).toBe(true);
    expect(controller.getSessionStatus(session.id)).toBeNull();
    expect(deriveSessionStatus).toHaveBeenCalledTimes(2);
  });

  it("keeps launcher activity stable between explicitly captured publish buckets", () => {
    const session = makeSession();
    const { controller, setLastActivityAt } = makeController(session);
    setLastActivityAt(10);

    expect(controller.getLastActivityAt(session.id)).toBe(10);
    setLastActivityAt(20);
    expect(controller.getLastActivityAt(session.id)).toBe(10);
    expect(controller.captureLauncherActivity(session.id)).toBe(false);
    expect(controller.getLastActivityAt(session.id)).toBe(10);

    setLastActivityAt(1_020);
    expect(controller.captureLauncherActivity(session.id)).toBe(true);
    expect(controller.getLastActivityAt(session.id)).toBe(1_020);
  });

  it("invalidates every direct navigation authority and ignores unrelated messages", () => {
    const session = makeSession();
    const { controller } = makeController(session);
    const sources: BrowserIncomingMessage[] = [
      { type: "session_name_update", name: "Renamed" },
      { type: "timer_update", timers: [] },
      { type: "session_update", session: { model: "new-model" } },
      { type: "session_quest_claimed", quest: null },
      { type: "permission_cancelled", request_id: "p-1" },
      { type: "user_message", content: "hello", timestamp: 1, id: "u-1" },
      { type: "result", data: {} } as unknown as BrowserIncomingMessage,
    ];
    for (const source of sources) expect(controller.captureSourceMessage(session, source)).toBe(true);
    expect(
      controller.captureSourceMessage(session, {
        type: "session_task_history",
        tasks: [],
      } as unknown as BrowserIncomingMessage),
    ).toBe(false);
  });
});

describe("session activity projection suppression", () => {
  it("removes only migrated fields and omits an otherwise empty compatibility update", () => {
    const mixed = suppressProjectedSessionNavigationActivityFields({
      type: "session_activity_update",
      session_id: "target",
      session: {
        status: "running",
        pendingPermissionCount: 2,
        attentionReason: "review",
      },
    });
    expect(mixed).toEqual({
      type: "session_activity_update",
      session_id: "target",
      session: { attentionReason: "review" },
    });

    expect(
      suppressProjectedSessionNavigationActivityFields({
        type: "session_activity_update",
        session_id: "target",
        session: { status: "idle", pendingPermissionCount: 0 },
      }),
    ).toBeNull();
  });
});
