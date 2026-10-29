/**
 * A leader's side column shows other conversations beside the main view. The browser names them
 * (side_views_update, and side_views on its subscribe), and the server delivers their live messages
 * to that browser too, while the main view stays the one it refreshes.
 */
import { describe, it, expect, vi } from "vitest";
import {
  broadcastToBrowsers,
  handleBrowserOpen,
  handleBrowserProtocolMessage,
  handleSessionSubscribe,
  type BrowserTransportSessionLike,
} from "./browser-transport-controller.js";
import type { BrowserIncomingMessage } from "../session-types.js";

function makeSession(overrides?: Partial<BrowserTransportSessionLike>): BrowserTransportSessionLike {
  const mockSocket = { send: vi.fn() };
  return {
    id: "test-session",
    backendType: "claude",
    browserSockets: new Set([mockSocket]),
    messageHistory: [],
    frozenCount: 0,
    state: { permissionMode: "default" } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: Date.now(),
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
    ...overrides,
  };
}

function makeViewingSocket(threadKey = "main") {
  return {
    data: {
      conversationView: {
        kind: "thread" as const,
        request: {
          threadKey,
          fromItem: -1,
          itemCount: 30,
          sectionItemCount: 10,
          visibleItemCount: 3,
        },
      },
    },
    send: vi.fn(),
  };
}

function makeDeps() {
  return {
    eventBufferLimit: 100,
    persistSession: vi.fn(),
    recordOutgoingRaw: vi.fn(),
  };
}

function makeInjectDeps(overrides: Record<string, unknown> = {}) {
  return {
    ...makeDeps(),
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    prefillSlashCommands: vi.fn(),
    getTreeGroupState: vi.fn(async () => ({ groups: [], assignments: {}, nodeOrder: {} })),
    getVsCodeSelectionState: vi.fn(() => null),
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true, state: "connected", backendType: "codex" })),
    backendAttached: vi.fn(() => true),
    backendConnected: vi.fn(() => true),
    getRouteChain: vi.fn(() => undefined),
    setRouteChain: vi.fn(),
    clearRouteChain: vi.fn(),
    routeBrowserMessage: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    setAttentionAction: vi.fn(),
    touchActivity: vi.fn(),
    notifyImageSendFailure: vi.fn(),
    broadcastError: vi.fn(),
    queueCodexPendingStartBatch: vi.fn(),
    deriveBackendState: vi.fn(() => "connected"),
    getBoard: vi.fn(() => []),
    getCompletedBoard: vi.fn(() => []),
    getBoardRowSessionStatuses: vi.fn(() => ({})),
    recoverToolStartTimesFromHistory: vi.fn(),
    finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
    scheduleCodexToolResultWatchdogs: vi.fn(),
    recomputeAndBroadcastHistoryBytes: vi.fn(),
    listTimers: vi.fn(() => []),
    browserTransportState: {
      vscodeSelectionState: null,
      vscodeWindows: new Map(),
      vscodeOpenFileQueues: new Map(),
      pendingVsCodeOpenResults: new Map(),
    },
    idempotentMessageTypes: new Set<string>(),
    processedClientMsgIdLimit: 100,
    getSessions: vi.fn(() => []),
    windowStaleMs: 1000,
    openFileTimeoutMs: 1000,
    ...overrides,
  } as any;
}

describe("side column views", () => {
  it("delivers a side column's live messages to the browser showing them, as it last said", async () => {
    // A leader's side column shows other conversations beside the main one. Their live messages
    // reach the browser once it names them (side_views_update), and no longer once it drops them.
    const ws = { data: {}, send: vi.fn() };
    const deps = makeInjectDeps();
    const session = makeSession({
      state: { permissionMode: "default", isOrchestrator: true } as any,
      browserSockets: new Set(),
    });
    handleBrowserOpen(session, ws, deps);
    await handleSessionSubscribe(
      session,
      ws,
      0,
      0,
      undefined,
      10,
      3,
      { thread_key: "q-1", from_item: -1, item_count: 30, section_item_count: 10, visible_item_count: 3 },
      deps,
    );
    const live = (id: string) =>
      broadcastToBrowsers(
        session,
        {
          type: "assistant",
          message: { id, role: "assistant", content: [{ type: "text", text: "side" }] },
          parent_tool_use_id: null,
          threadKey: "topic:aaaa0001",
        } as BrowserIncomingMessage,
        deps,
      );
    const sent = () => ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw)).type);
    ws.send.mockClear();
    live("before");
    expect(sent()).toEqual([]);

    handleBrowserProtocolMessage(session, { type: "side_views_update", thread_keys: ["topic:aaaa0001"] }, ws, deps);
    live("shown");
    expect(sent()).toEqual(["assistant"]);

    ws.send.mockClear();
    handleBrowserProtocolMessage(session, { type: "side_views_update", thread_keys: [] }, ws, deps);
    live("dropped");
    expect(sent()).toEqual([]);

    // A reconnecting browser names its side views with its subscribe.
    await handleBrowserProtocolMessage(
      session,
      {
        type: "session_subscribe",
        last_seq: 0,
        history_window_section_turn_count: 10,
        history_window_visible_section_count: 3,
        initial_thread_window: {
          thread_key: "q-1",
          from_item: -1,
          item_count: 30,
          section_item_count: 10,
          visible_item_count: 3,
        },
        side_views: ["topic:aaaa0001"],
      },
      ws,
      deps,
    );
    ws.send.mockClear();
    live("after reconnect");
    expect(sent()).toEqual(["assistant"]);
  });
});
