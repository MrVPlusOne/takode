import { afterEach, describe, expect, it, vi } from "vitest";
import { CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS } from "../codex-process-reconnect.js";
import { beginCodexManualReconnectCycle, requestCodexAutoRecovery } from "./session-registry-controller.js";

function makeSession() {
  return {
    id: "codex-reconnect",
    backendType: "codex",
    state: {
      backend_state: "disconnected",
      backend_error: null,
      backend_reconnect: null,
    },
    consecutiveAdapterFailures: 0,
    lastAdapterFailureAt: null,
    isGenerating: false,
  } as any;
}

function makeDeps() {
  return {
    requestCliRelaunch: vi.fn(),
    persistSession: vi.fn(),
    emitTakodeEvent: vi.fn(),
    attached: vi.fn(() => false),
    getLauncherSessionInfo: vi.fn(() => ({ cliSessionId: "thread-1" })),
    broadcastSessionUpdate: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    recoveryTimeoutMs: 30_000,
    maxAdapterRelaunchFailures: CODEX_PROCESS_RECONNECT_MAX_ATTEMPTS,
    finalizeCodexRecoveringTurn: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Codex process reconnect cycles", () => {
  it("broadcasts one-based server-authoritative progress through the five-attempt budget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const session = makeSession();
    const deps = makeDeps();

    expect(requestCodexAutoRecovery(session, "queued_user_message_adapter_missing", deps)).toBe(true);
    expect(session.state).toMatchObject({
      backend_state: "recovering",
      backend_reconnect: { attempt: 1, maxAttempts: 5, cycleStartedAt: 1_000 },
    });

    session.consecutiveAdapterFailures = 1;
    vi.setSystemTime(2_000);
    expect(requestCodexAutoRecovery(session, "init_error:queued_user_message_adapter_missing", deps)).toBe(true);
    expect(session.state.backend_reconnect).toEqual({ attempt: 2, maxAttempts: 5, cycleStartedAt: 1_000 });
    expect(deps.broadcastSessionUpdate).toHaveBeenCalledWith(session, {
      backend_reconnect: { attempt: 2, maxAttempts: 5, cycleStartedAt: 1_000 },
    });
  });

  it("labels the first adapter-disconnect relaunch as attempt one", () => {
    vi.useFakeTimers();
    const session = makeSession();
    session.consecutiveAdapterFailures = 1;
    const deps = makeDeps();

    expect(requestCodexAutoRecovery(session, "adapter_disconnect", deps)).toBe(true);
    expect(session.state.backend_reconnect).toMatchObject({ attempt: 1, maxAttempts: 5 });
  });

  it("starts a fresh manual cycle at attempt one without releasing held-work policy", () => {
    const session = makeSession();
    session.state.backend_state = "recovery_suppressed";
    session.state.backend_reconnect = { attempt: 5, maxAttempts: 5, cycleStartedAt: 100 };
    session.state.codex_result_error_auto_pause = {
      family: "model_backend_stream_error",
      fingerprint: "stream-error",
      streak: 2,
      threshold: 2,
      pausedAt: 200,
      lastError: "Model backend stream disconnected repeatedly.",
      lastErrorAt: 200,
      lastSourceKind: "automatic",
      totalMatchingErrors: 2,
      heldInputs: [{ id: "held-1", queuedAt: 201, source: "timer", count: 1, message: {} }],
    };
    session.consecutiveAdapterFailures = 5;
    const deps = makeDeps();

    expect(beginCodexManualReconnectCycle(session, deps)).toBe(true);
    expect(session.state.backend_state).toBe("recovering");
    expect(session.state.backend_reconnect).toMatchObject({ attempt: 1, maxAttempts: 5 });
    expect(session.state.codex_result_error_auto_pause.heldInputs).toHaveLength(1);
    expect(session.consecutiveAdapterFailures).toBe(0);
    expect(session.codexAutoRecoveryReason).toBe("manual_reconnect");
  });
});
