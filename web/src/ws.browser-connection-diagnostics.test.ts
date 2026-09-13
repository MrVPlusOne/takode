// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildThreadWindowSync } from "../shared/thread-window.js";
import { browserLoadDiagnostics } from "./utils/browser-load-diagnostics.js";
import { createWsTransport, type WsTransport } from "./ws-transport.js";

class MockSocket {
  static OPEN = 1;
  static instances: MockSocket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor() {
    MockSocket.instances.push(this);
  }
}

let transport: WsTransport;
const received = vi.fn();

beforeEach(() => {
  vi.stubGlobal("WebSocket", MockSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "localhost" });
  MockSocket.instances = [];
  received.mockReset();
  localStorage.clear();
  transport = createWsTransport({
    hasLocalMessages: () => false,
    getKnownFrozenCount: () => 0,
    getKnownFrozenHash: () => undefined,
    getFreshHistoryWindow: () => ({ sectionTurnCount: 10, visibleSectionCount: 3 }),
    onMessage: received,
  });
});

afterEach(() => {
  transport.disconnectAll();
  vi.unstubAllGlobals();
});

it("acknowledges the initial-sync marker without inserting a feed message", () => {
  // The marker follows the producer's state snapshot. Receipt says nothing
  // about React paint and must not enter history, replay, or application state.
  transport.connectSession("session");
  const socket = MockSocket.instances[0]!;
  socket.onopen!();
  socket.onmessage!({ data: JSON.stringify({ type: "state_snapshot", sessionStatus: "idle" }) });
  socket.onmessage!({ data: JSON.stringify({ type: "browser_connection_probe", connection_id: "connection-a" }) });
  expect(received).toHaveBeenCalledTimes(1);
  expect(JSON.parse(socket.send.mock.calls.at(-1)![0])).toEqual({
    type: "browser_connection_probe_ack",
    connection_id: "connection-a",
  });
});

it("does not acknowledge a replaced socket's delayed marker", () => {
  // A queued callback from the old physical connection cannot be attributed
  // to the new connection, even though both sockets represent the same session.
  transport.connectSession("session");
  const previous = MockSocket.instances[0]!;
  previous.onopen!();
  transport.reconnectSession("session");
  previous.send.mockClear();
  previous.onmessage!({ data: JSON.stringify({ type: "browser_connection_probe", connection_id: "old-connection" }) });
  expect(previous.send).not.toHaveBeenCalled();
  expect(received).not.toHaveBeenCalled();
});

it("exports producer-shaped window timing under the physical socket with view and digest identity", () => {
  // The real window builder supplies entries/bounds; only the diagnostic digest
  // is fixed here, as the transport adds it when authoring a cacheable response.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  try {
    transport.connectSession("session");
    const socket = MockSocket.instances[0]!;
    socket.onopen!();
    socket.onmessage!({
      data: JSON.stringify({ type: "session_init", session: {}, diagnosticConnectionId: "socket-a" }),
    });
    const window = buildThreadWindowSync({
      messageHistory: [],
      threadKey: "q-12",
      fromItem: -1,
      itemCount: 30,
      sectionItemCount: 10,
      visibleItemCount: 3,
    });
    socket.onmessage!({
      data: JSON.stringify({
        type: "thread_window_sync",
        thread_key: window.threadKey,
        entries: window.entries,
        window: { ...window.window, window_hash: "abc123" },
      }),
    });
    browserLoadDiagnostics.feedCommitted("session", "q-12", false, "abc123");
    vi.advanceTimersByTime(200);
    const reports = socket.send.mock.calls
      .map(([raw]) => JSON.parse(raw))
      .filter((message) => message.type === "browser_load_report");
    expect(reports.every((message) => message.connection_id === "socket-a")).toBe(true);
    const stages = reports.flatMap((message) => message.report.stages);
    const receivedStage = stages.find(
      (entry) => entry.stage === "message_received" && entry.messageType === "thread_window_sync",
    );
    expect(receivedStage).toMatchObject({ view: "q-12", windowHash: "abc123", receiveId: expect.any(Number) });
    expect(stages).toContainEqual(
      expect.objectContaining({
        stage: "message_applied",
        receiveId: receivedStage.receiveId,
        parseMs: expect.any(Number),
        applyMs: expect.any(Number),
      }),
    );
    expect(stages).toContainEqual(
      expect.objectContaining({ stage: "feed_commit", view: "q-12", windowHash: "abc123", loading: false }),
    );
    expect(received).toHaveBeenCalledTimes(2);
  } finally {
    transport.disconnectAll();
    vi.useRealTimers();
  }
});
