import { describe, expect, it, vi } from "vitest";

const mockExecSync = vi.hoisted(() => vi.fn());
const mockExec = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({ execSync: mockExecSync, exec: mockExec }));

import { createEmptyViewportHandoffSessionState } from "../shared/viewport-handoff.js";
import { WsBridge, type SocketData } from "./ws-bridge.js";

function browserSocket(sessionId: string) {
  return {
    data: { kind: "browser", sessionId } satisfies SocketData,
    send: vi.fn(),
    close: vi.fn(),
    readyState: 1,
  } as any;
}

function messages(socket: ReturnType<typeof browserSocket>): any[] {
  return socket.send.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])));
}

const subscribe = JSON.stringify({
  type: "session_subscribe",
  last_seq: 0,
  history_window_section_turn_count: 10,
  history_window_visible_section_count: 3,
});

// A browser moving between sessions keeps one socket and sends session_switch
// instead of reconnecting, which costs several round trips on a slow link.
describe("browser session switch on one socket", () => {
  it("moves the socket to the new session as a close and fresh open would", async () => {
    const bridge = new WsBridge();
    const first = bridge.getOrCreateSession("first");
    const second = bridge.getOrCreateSession("second");
    const socket = browserSocket("first");
    bridge.handleBrowserOpen(socket, "first");
    await bridge.handleBrowserMessage(socket, subscribe);
    socket.send.mockClear();

    await bridge.handleBrowserMessage(socket, JSON.stringify({ type: "session_switch", session_id: "second" }));

    expect(first.browserSockets.has(socket)).toBe(false);
    expect(second.browserSockets.has(socket)).toBe(true);
    // Per-socket state starts over, as for a fresh connection.
    expect(socket.data).toMatchObject({ kind: "browser", sessionId: "second", subscribed: false, lastAckSeq: 0 });
    expect(socket.data.conversationView).toBeUndefined();
    expect(messages(socket)[0]).toMatchObject({ type: "session_init", session: { session_id: "second" } });
  });

  // Reuse keeps the coarse platform for diagnostics. With Safari-compatible
  // compression, iOS receives compressed large messages after switches too.
  it("keeps the upgrade's browser classification across a switch", async () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("first");
    // A realistic tool catalog puts session_init above the compression threshold.
    bridge.getOrCreateSession("second").state.tools = Array.from({ length: 100 }, (_, index) => `tool_${index}`);
    const socket = browserSocket("first");
    Object.assign(socket.data, { browserClientPlatform: "ios" });
    bridge.handleBrowserOpen(socket, "first");
    await bridge.handleBrowserMessage(socket, subscribe);
    socket.send.mockClear();

    await bridge.handleBrowserMessage(socket, JSON.stringify({ type: "session_switch", session_id: "second" }));

    expect(socket.data).toMatchObject({ sessionId: "second", browserClientPlatform: "ios" });
    const init = socket.send.mock.calls.find((call: unknown[]) => JSON.parse(String(call[0])).type === "session_init");
    expect(init?.[1]).toBe(true);
  });

  it("detaches the socket from every session on a null switch", async () => {
    const bridge = new WsBridge();
    const first = bridge.getOrCreateSession("first");
    const socket = browserSocket("first");
    bridge.handleBrowserOpen(socket, "first");
    await bridge.handleBrowserMessage(socket, subscribe);
    socket.send.mockClear();

    await bridge.handleBrowserMessage(socket, JSON.stringify({ type: "session_switch", session_id: null }));
    await bridge.handleBrowserMessage(socket, subscribe);

    expect(first.browserSockets.has(socket)).toBe(false);
    // A detached socket's messages reach no session.
    expect(socket.send).not.toHaveBeenCalled();
  });

  // The subscribe the browser pipelines right behind a switch must be handled
  // for the new session, and nothing the old session's subscribe still sends
  // may arrive after the new session's session_init.
  it("orders a switch after earlier work and before later messages", async () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("first").messageHistory = Array.from({ length: 501 }, (_, index) => ({
      type: "user_message",
      content: `history-${index}`,
      timestamp: index,
      id: `history-${index}`,
    })) as any;
    bridge.getOrCreateSession("second");
    const socket = browserSocket("first");
    bridge.handleBrowserOpen(socket, "first");
    socket.send.mockClear();

    await Promise.all([
      bridge.handleBrowserMessage(socket, subscribe),
      bridge.handleBrowserMessage(socket, JSON.stringify({ type: "session_switch", session_id: "second" })),
      bridge.handleBrowserMessage(socket, subscribe),
    ]);

    const sent = messages(socket);
    const secondInit = sent.findIndex(
      (message) => message.type === "session_init" && message.session.session_id === "second",
    );
    expect(secondInit).toBeGreaterThan(0);
    const firstSubscribeEnd = sent.findIndex((message) => message.type === "state_snapshot");
    expect(firstSubscribeEnd).toBeGreaterThanOrEqual(0);
    expect(firstSubscribeEnd).toBeLessThan(secondInit);
    // The pipelined subscribe ran for the second session after its session_init.
    expect(sent.slice(secondInit).some((message) => message.type === "state_snapshot")).toBe(true);
  });
});

describe("viewport handoff state over the browser socket", () => {
  it("sends the session's handoff state on subscribe and pushes accepted changes", async () => {
    const bridge = new WsBridge();
    const session = bridge.getOrCreateSession("leader");
    const state = { ...createEmptyViewportHandoffSessionState("leader"), revision: 3, updatedAt: 50 };
    bridge.setViewportHandoffReader(async (sessionId) => (sessionId === "leader" ? state : null));
    const socket = browserSocket("leader");
    bridge.handleBrowserOpen(socket, "leader");
    await bridge.handleBrowserMessage(socket, subscribe);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages(socket).filter((message) => message.type === "viewport_handoff_state")).toEqual([
      { type: "viewport_handoff_state", state, serverNow: expect.any(Number) },
    ]);

    socket.send.mockClear();
    const unsubscribed = browserSocket("leader");
    session.browserSockets.add(unsubscribed);
    const next = { ...state, revision: 4 };
    bridge.pushViewportHandoffState("leader", next);

    expect(messages(socket)).toEqual([{ type: "viewport_handoff_state", state: next, serverNow: expect.any(Number) }]);
    expect(unsubscribed.send).not.toHaveBeenCalled();
  });

  it("drops a state read that finishes after the socket switched sessions", async () => {
    const bridge = new WsBridge();
    bridge.getOrCreateSession("leader");
    bridge.getOrCreateSession("other");
    let finishRead: (value: ReturnType<typeof createEmptyViewportHandoffSessionState>) => void = () => {};
    bridge.setViewportHandoffReader(() => new Promise((resolve) => (finishRead = resolve)));
    const socket = browserSocket("leader");
    bridge.handleBrowserOpen(socket, "leader");
    await bridge.handleBrowserMessage(socket, subscribe);
    await bridge.handleBrowserMessage(socket, JSON.stringify({ type: "session_switch", session_id: "other" }));

    finishRead(createEmptyViewportHandoffSessionState("leader"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(messages(socket).some((message) => message.type === "viewport_handoff_state")).toBe(false);
  });
});
