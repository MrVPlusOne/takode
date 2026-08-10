import { describe, expect, it, vi } from "vitest";
import { sendStateSnapshot, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

function makeSession(): BrowserTransportSessionLike {
  return {
    id: "reconnect-snapshot",
    backendType: "codex",
    backendSocket: null,
    codexAdapter: null,
    claudeSdkAdapter: null,
    browserSockets: new Set(),
    messageHistory: [],
    frozenCount: 0,
    state: {
      permissionMode: "default",
      backend_state: "recovering",
      backend_reconnect: { attempt: 2, maxAttempts: 5, cycleStartedAt: 100 },
    } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: 0,
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
    isGenerating: false,
  } as any;
}

function makeDeps() {
  return {
    backendConnected: vi.fn(() => false),
    deriveBackendState: vi.fn(() => "recovering"),
    getBoard: vi.fn(() => []),
    getCompletedBoard: vi.fn(() => []),
    getBoardRowSessionStatuses: vi.fn(() => ({})),
  } as any;
}

describe("Codex reconnect progress snapshots", () => {
  it("projects the same server-authored attempt to every connected browser", () => {
    const first = { send: vi.fn() };
    const second = { send: vi.fn() };
    const session = makeSession();
    const deps = makeDeps();

    sendStateSnapshot(session, first, deps);
    sendStateSnapshot(session, second, deps);

    for (const socket of [first, second]) {
      expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
        type: "state_snapshot",
        backendState: "recovering",
        backendReconnect: { attempt: 2, maxAttempts: 5, cycleStartedAt: 100 },
      });
    }
  });
});
