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
      codex_provider_retry: {
        family: "model_backend_stream_error",
        ownerId: "input-1",
        attempt: 1,
        maxAttempts: 2,
        startedAt: 90,
      },
      codex_turn_recovery: {
        recoveryId: "original-owner",
        originalOwnerId: "original-owner",
        originalProviderTurnId: "turn-original",
        originalHistoryIndex: 7,
        continuationOwnerId: "continuation-owner",
        threadKey: "q-1987",
        questId: "q-1987",
        status: "continuation_pending",
        reason: "interrupted_after_activity",
        attempt: 1,
        maxAttempts: 1,
        createdAt: 80,
        updatedAt: 95,
      },
    } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [{ userMessageId: "input-1", status: "queued" }],
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
        codexProviderRetry: {
          family: "model_backend_stream_error",
          ownerId: "input-1",
          attempt: 1,
          maxAttempts: 2,
          startedAt: 90,
        },
        codexTurnRecovery: {
          originalOwnerId: "original-owner",
          continuationOwnerId: "continuation-owner",
          status: "continuation_pending",
          threadKey: "q-1987",
        },
      });
    }
  });

  it("does not resurrect retry state whose owner is absent from the live turn queue", () => {
    const socket = { send: vi.fn() };
    const session = makeSession();
    session.pendingCodexTurns = [];

    sendStateSnapshot(session, socket, makeDeps());

    expect(JSON.parse(String(socket.send.mock.calls[0]?.[0]))).toMatchObject({
      type: "state_snapshot",
      codexProviderRetry: null,
    });
  });
});
