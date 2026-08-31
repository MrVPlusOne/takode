import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexOutboundTurn } from "./session-types.js";
import { getCodexAdapterBrowserMessageDeps, getCodexRecoveryOrchestratorDeps } from "./ws-bridge-deps.js";

function turn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [] },
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "continue",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-1",
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

describe("Codex provider retry settlement", () => {
  afterEach(() => vi.useRealTimers());

  it("retires matching retry state when exact-once recovery completes the owner", () => {
    const broadcastToBrowsers = vi.fn();
    const host = {
      getGenerationLifecycleDeps: () => ({}),
      getCommonCodexRuntimeDeps: () => ({}),
      broadcastToBrowsers,
    };
    const deps = getCodexRecoveryOrchestratorDeps(host);
    const pending = turn();
    const session = {
      state: {
        codex_provider_retry: {
          family: "model_backend_stream_error",
          ownerId: "input-1",
          attempt: 1,
          maxAttempts: 2,
          startedAt: 10,
        },
      },
      pendingCodexTurns: [pending],
    } as any;

    expect(deps.completeCodexTurn(session, pending)).toBe(true);
    expect(session.state.codex_provider_retry).toBeNull();
    expect(broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { codex_provider_retry: null },
    });
  });

  it("delays persistent provider relaunch until the accepted outage cadence", () => {
    vi.useFakeTimers();
    const requestCodexAutoRecovery = vi.fn(() => true);
    const broadcastToBrowsers = vi.fn();
    const host = {
      getClaudeMessageHandlers: () => ({ handleResultMessage: vi.fn() }),
      getCommonCodexRuntimeDeps: () => ({}),
      getCodexRecoveryOrchestratorDeps: () => ({
        completeCodexTurnsForResult: vi.fn(),
        clearCodexFreshTurnRequirement: vi.fn(),
        queueCodexPendingStartBatch: vi.fn(),
        dispatchQueuedCodexTurns: vi.fn(),
        maybeFlushQueuedCodexMessages: vi.fn(),
      }),
      launcher: { getSession: vi.fn(() => ({ archived: false, killedByIdleManager: false })) },
      setBackendState: (session: any, state: string, error: string | null) => {
        session.state.backend_state = state;
        session.state.backend_error = error;
      },
      broadcastToBrowsers,
      persistSession: vi.fn(),
      requestCodexAutoRecovery,
    };
    const pending = turn();
    pending.status = "queued";
    pending.turnId = null;
    pending.providerRecoveryFamily = "model_backend_stream_error";
    const session = {
      id: "provider-cadence",
      state: {
        backend_state: "disconnected",
        backend_error: null,
        backend_reconnect: null,
        codex_provider_retry: null,
        codex_turn_recovery: null,
        pause: null,
      },
      pendingCodexTurns: [pending],
      pendingCodexInputs: [],
      codexAdapter: { id: "attached" },
      consecutiveAdapterFailures: 0,
      lastAdapterFailureAt: null,
    } as any;
    const deps = getCodexAdapterBrowserMessageDeps(host);

    expect(deps.requestCodexProviderRecovery(session, "provider_result:model_backend_stream_error:attempt_1")).toBe(
      true,
    );
    expect(requestCodexAutoRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_999);
    expect(requestCodexAutoRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestCodexAutoRecovery).toHaveBeenCalledWith(
      session,
      "provider_result:model_backend_stream_error:attempt_1",
    );
  });
});
