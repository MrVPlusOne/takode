import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearCodexOutageRecoveryState,
  canContinueCodexOutageRecovery,
  getCodexOutageRecoveryDescriptor,
  resolveCodexAutoRecoveryReason,
  scheduleCodexOutageRecoveryRetry,
} from "../codex-process-reconnect.js";
import { handleCodexPendingInputAction } from "./codex-pending-input-actions.js";
import { handleCodexAdapterInitError, rebuildQueuedCodexPendingStartBatch } from "./codex-recovery-orchestrator.js";
import {
  closeSession,
  markCodexAutoRecoveryFailed,
  removeSession,
  requestCodexAutoRecovery,
} from "./session-registry-controller.js";
import { pauseSessionForDelivery } from "./session-pause-delivery.js";

function pendingTurn(ownerId = "input-1") {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: [ownerId], inputs: [{ content: "continue" }] },
    userMessageId: ownerId,
    pendingInputIds: [ownerId],
    userContent: "continue",
    historyIndex: 0,
    status: "queued",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: null,
    turnTarget: "current",
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
  } as const;
}

function makeSession() {
  return {
    id: "persistent-outage",
    backendType: "codex",
    state: {
      backend_state: "disconnected",
      backend_error: null,
      backend_reconnect: {
        attempt: 5,
        maxAttempts: 5,
        cycleStartedAt: 100,
        outageOwnerId: "input-1",
        outageFamily: "process_transport",
      },
      codex_provider_retry: null,
      codex_turn_recovery: null,
      pause: null,
    },
    pendingCodexTurns: [pendingTurn()],
    pendingCodexInputs: [],
    consecutiveAdapterFailures: 5,
    lastAdapterFailureAt: 100,
    isGenerating: true,
    browserSockets: new Set(),
  } as any;
}

function makeDeps() {
  return {
    requestCliRelaunch: vi.fn(),
    persistSession: vi.fn(),
    emitTakodeEvent: vi.fn(),
    attached: vi.fn(() => false),
    getLauncherSessionInfo: vi.fn(() => ({ archived: false, cliSessionId: "thread-1" })),
    broadcastSessionUpdate: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    recoveryTimeoutMs: 30_000,
    maxAdapterRelaunchFailures: 5,
    finalizeCodexRecoveringTurn: vi.fn(),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("persistent Codex outage recovery", () => {
  it("starts a fresh inner cycle after the old process cap and keeps retrying while the exact owner lives", () => {
    // The five-launch cap remains an anti-thrash inner cycle. An exact pending
    // owner authorizes later cycles without changing replay ownership.
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const session = makeSession();
    const deps = makeDeps();

    expect(requestCodexAutoRecovery(session, "queued_user_message_adapter_missing", deps)).toBe(true);
    expect(session.state.backend_reconnect).toMatchObject({
      attempt: 1,
      maxAttempts: 5,
      cycleStartedAt: 1_000,
      outageOwnerId: "input-1",
      outageFamily: "process_transport",
    });
    expect(deps.requestCliRelaunch).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(deps.requestCliRelaunch).toHaveBeenCalledTimes(2);
    expect(session.state.backend_state).toBe("recovering");
    expect(session.state.backend_reconnect).toMatchObject({ attempt: 2, outageOwnerId: "input-1" });
    expect(deps.emitTakodeEvent).not.toHaveBeenCalled();
    expect(deps.finalizeCodexRecoveringTurn).not.toHaveBeenCalled();

    session.pendingCodexTurns = [];
    vi.advanceTimersByTime(30_000);
    expect(deps.requestCliRelaunch).toHaveBeenCalledTimes(2);
    expect(session.state.backend_state).toBe("disconnected");
    expect(session.state.backend_reconnect).toBeNull();
    expect(deps.emitTakodeEvent).not.toHaveBeenCalled();
    expect(deps.finalizeCodexRecoveringTurn).not.toHaveBeenCalled();
  });

  it("invalidates the in-flight timeout before a delayed outer-cycle retry", () => {
    // A fast attach/disconnect can otherwise leave both the old request timeout
    // and the delayed retry timer eligible at the same deadline.
    vi.useFakeTimers();
    const session = makeSession();
    session.consecutiveAdapterFailures = 0;
    const deps = makeDeps();
    const delayedRetry = vi.fn(() => true);

    expect(requestCodexAutoRecovery(session, "adapter_disconnect", deps)).toBe(true);
    expect(
      scheduleCodexOutageRecoveryRetry(session, "adapter_disconnect", {
        getLauncherSessionInfo: () => ({ archived: false, cliSessionId: "thread-1" }),
        requestRecovery: delayedRetry,
        onWaiting: vi.fn(),
        onIneligible: vi.fn(),
        persist: vi.fn(),
      }),
    ).toBe(true);

    vi.advanceTimersByTime(30_000);
    expect(deps.requestCliRelaunch).toHaveBeenCalledTimes(1);
    expect(delayedRetry).toHaveBeenCalledTimes(1);
    expect(deps.emitTakodeEvent).not.toHaveBeenCalled();
  });

  it("waits for the outage cadence before replacing an attached provider process", () => {
    vi.useFakeTimers();
    const session = makeSession();
    session.codexAdapter = { id: "still-attached" };
    const requestRecovery = vi.fn(() => true);

    expect(
      scheduleCodexOutageRecoveryRetry(
        session,
        "provider_result:model_backend_stream_error:attempt_4",
        {
          getLauncherSessionInfo: () => ({ archived: false }),
          requestRecovery,
          onWaiting: vi.fn(),
          onIneligible: vi.fn(),
          persist: vi.fn(),
        },
        { allowAttached: true },
      ),
    ).toBe(true);

    vi.advanceTimersByTime(29_999);
    expect(requestRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(requestRecovery).toHaveBeenCalledTimes(1);
  });

  it("does not turn deterministic launcher failure into persistent outage retry", () => {
    vi.useFakeTimers();
    const session = makeSession();
    session.state.backend_state = "recovering";
    session.consecutiveAdapterFailures = 0;
    (session as any).codexAutoRecoveryReason = "queued_user_message_adapter_missing";
    const deps = makeDeps();

    markCodexAutoRecoveryFailed(session, deps);
    vi.advanceTimersByTime(30_000);

    expect(session.state.backend_state).toBe("disconnected");
    expect(deps.requestCliRelaunch).not.toHaveBeenCalled();
    expect(deps.emitTakodeEvent).toHaveBeenCalledWith(session.id, "session_disconnected", {
      wasGenerating: true,
      reason: "recovery_failed",
    });
  });

  it("clears delayed outage recovery before removing durable session state", () => {
    vi.useFakeTimers();
    const session = makeSession();
    const requestRecovery = vi.fn(() => true);
    const persist = vi.fn();
    expect(
      scheduleCodexOutageRecoveryRetry(session, "adapter_disconnect", {
        getLauncherSessionInfo: () => ({ archived: false, cliSessionId: "thread-1" }),
        requestRecovery,
        onWaiting: vi.fn(),
        onIneligible: vi.fn(),
        persist,
      }),
    ).toBe(true);
    const persistCallsBeforeRemoval = persist.mock.calls.length;
    const lateGracePersist = vi.fn();
    session.codexDisconnectGraceTimer = setTimeout(lateGracePersist, 10_000);
    const sessions = new Map([[session.id, session]]);

    removeSession(sessions, session.id, {
      clearOptimisticRunningTimer: vi.fn(),
      clearAllCodexToolResultWatchdogs: vi.fn(),
      clearCodexDisconnectGraceTimer: (target) => {
        clearTimeout(target.codexDisconnectGraceTimer);
        target.codexDisconnectGraceTimer = null;
      },
      cleanupBranchState: vi.fn(),
      removeStoredSession: vi.fn(),
    });
    vi.advanceTimersByTime(30_000);

    expect(sessions.has(session.id)).toBe(false);
    expect(requestRecovery).not.toHaveBeenCalled();
    expect(lateGracePersist).not.toHaveBeenCalled();
    expect(persist).toHaveBeenCalledTimes(persistCallsBeforeRemoval);
  });

  it("clears disconnect grace before closing a session", () => {
    vi.useFakeTimers();
    const session = makeSession();
    const lateGracePersist = vi.fn();
    session.codexDisconnectGraceTimer = setTimeout(lateGracePersist, 10_000);
    const sessions = new Map([[session.id, session]]);

    closeSession(sessions, session.id, {
      clearOptimisticRunningTimer: vi.fn(),
      clearAllCodexToolResultWatchdogs: vi.fn(),
      clearCodexDisconnectGraceTimer: (target) => {
        clearTimeout(target.codexDisconnectGraceTimer);
        target.codexDisconnectGraceTimer = null;
      },
      cleanupBranchState: vi.fn(),
      removeStoredSession: vi.fn(),
    });
    vi.advanceTimersByTime(10_000);

    expect(sessions.has(session.id)).toBe(false);
    expect(lateGracePersist).not.toHaveBeenCalled();
  });

  it("does not transfer a persisted outage cycle to a different queued owner", () => {
    const session = makeSession();
    session.pendingCodexTurns = [pendingTurn("input-2")];

    expect(getCodexOutageRecoveryDescriptor(session, "adapter_disconnect")).toBeNull();
    expect(canContinueCodexOutageRecovery(session, "adapter_disconnect", { archived: false })).toBe(false);
  });

  it("reconstructs provider-outage recovery after server restart without a runtime reason", () => {
    // Runtime timers and reasons are intentionally not persisted. The exact
    // provider owner in restored state must reauthorize only transient init retry.
    vi.useFakeTimers();
    const session = makeSession();
    session.state.backend_state = "resuming";
    session.state.backend_reconnect = null;
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 8,
      maxAttempts: null,
      startedAt: 100,
    };
    session.lastAdapterFailureAt = null;
    const adapter = { id: "restored-adapter" };
    session.codexAdapter = adapter;
    const requestRecovery = vi.fn(() => true);
    const deps = {
      clearCodexDisconnectGraceTimer: vi.fn(),
      getCodexTurnInRecovery: () => session.pendingCodexTurns[0] ?? null,
      getLauncherSessionInfo: () => ({ cliSessionId: "thread-restored" }),
      hasCliRelaunchCallback: true,
      adapterFailureResetWindowMs: 120_000,
      maxAdapterRelaunchFailures: 5,
      setPendingCodexInputsCancelable: vi.fn(),
      rebuildQueuedCodexPendingStartBatch: vi.fn(),
      setBackendState: (_target: any, state: string, error: string | null) => {
        session.state.backend_state = state;
        session.state.backend_error = error;
      },
      broadcastToBrowsers: vi.fn(),
      requestCodexAutoRecovery: requestRecovery,
      persistSession: vi.fn(),
    } as any;

    expect(
      handleCodexAdapterInitError(session.id, session, adapter, "Codex initialization failed: Transport closed", deps),
    ).toBe("retrying");
    vi.advanceTimersByTime(30_000);
    expect(requestRecovery).toHaveBeenCalledWith(
      session,
      "init_error:provider_result:model_backend_stream_error:attempt_8",
    );
  });

  it("reconstructs finite auth recovery without converting it to persistent transport recovery", () => {
    const session = makeSession();
    session.state.backend_reconnect = null;
    session.state.codex_provider_retry = {
      family: "copilot_auth_refresh_invalidated",
      ownerId: "input-1",
      attempt: 1,
      maxAttempts: 2,
      startedAt: 100,
    };
    session.pendingCodexTurns[0].providerRecoveryFamily = "copilot_auth_refresh_invalidated";
    session.pendingCodexTurns[0].providerRecoveryAttempts = 1;

    expect(resolveCodexAutoRecoveryReason(session, null, { allowPendingFallback: true })).toBe(
      "provider_result:copilot_auth_refresh_invalidated:attempt_1",
    );
    expect(getCodexOutageRecoveryDescriptor(session, "adapter_disconnect")).toBeNull();
    expect(canContinueCodexOutageRecovery(session, "adapter_disconnect", { archived: false })).toBe(false);
  });

  it("restores only narrow network-outage reasons from persisted exact-owner state", () => {
    const session = makeSession();
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 8,
      maxAttempts: null,
      startedAt: 100,
    };

    expect(resolveCodexAutoRecoveryReason(session, null)).toBe("provider_result:model_backend_stream_error:attempt_8");
    session.state.pause = { pausedAt: 200, queuedMessages: [] };
    expect(canContinueCodexOutageRecovery(session, "provider_result:model_backend_stream_error:attempt_8", {})).toBe(
      false,
    );
  });

  it("keeps corroborated authentication recovery finite at the process boundary", () => {
    const session = makeSession();
    session.state.backend_reconnect = null;
    session.state.codex_provider_retry = {
      family: "copilot_auth_refresh_invalidated",
      ownerId: "input-1",
      attempt: 2,
      maxAttempts: 2,
      startedAt: 100,
    };
    const deps = makeDeps();

    expect(requestCodexAutoRecovery(session, "provider_result:copilot_auth_refresh_invalidated:attempt_2", deps)).toBe(
      false,
    );
    expect(session.state.backend_state).toBe("recovery_suppressed");
    expect(deps.requestCliRelaunch).not.toHaveBeenCalled();
  });

  it("preserves a provider retry owner when rebuilding unrelated queued work", () => {
    const session = makeSession();
    const retryOwner = session.pendingCodexTurns[0];
    retryOwner.providerRecoveryFamily = "model_backend_stream_error";
    retryOwner.providerRecoveryAttempts = 4;
    const persistSession = vi.fn();
    const deps = {
      getCodexHeadTurn: (target: any) => target.pendingCodexTurns[0] ?? null,
      persistSession,
      formatVsCodeSelectionPrompt: vi.fn(() => ""),
    } as any;

    rebuildQueuedCodexPendingStartBatch(session, deps);
    expect(session.pendingCodexTurns).toEqual([retryOwner]);

    session.pendingCodexInputs = [
      {
        id: "later-input",
        content: "later",
        timestamp: 20,
        cancelable: true,
        autoPauseSourceKind: "manual",
      },
    ];
    rebuildQueuedCodexPendingStartBatch(session, deps);

    expect(session.pendingCodexTurns).toHaveLength(2);
    expect(session.pendingCodexTurns[0]).toBe(retryOwner);
    expect(session.pendingCodexTurns[1]).toMatchObject({ userMessageId: "later-input" });
    expect(session.pendingCodexTurns[1].providerRecoveryFamily).toBeUndefined();
  });

  it("clears retry presentation immediately when cancellation removes the exact owner", () => {
    const session = makeSession();
    session.state.backend_state = "recovering";
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 4,
      maxAttempts: null,
      startedAt: 10,
    };
    session.pendingCodexInputs = [{ id: "input-1", content: "continue", timestamp: 1, cancelable: true }];
    const broadcasts: any[] = [];

    handleCodexPendingInputAction(session, { type: "cancel_pending_codex_input", id: "input-1" }, {}, {
      broadcastToBrowsers: (_target: any, message: any) => broadcasts.push(message),
      clearQueuedTurnLifecycleEntries: vi.fn(),
      getCancelablePendingCodexInputs: (target: any) =>
        target.pendingCodexInputs.filter((input: any) => input.cancelable),
      isCodexWorkerV2DeliveryFrozen: () => false,
      markRunningFromUserDispatch: vi.fn(),
      persistSession: vi.fn(),
      queueCodexPendingStartBatch: vi.fn(),
      rebuildQueuedCodexPendingStartBatch: vi.fn(),
      removePendingCodexInput: (target: any, id: string) => {
        const index = target.pendingCodexInputs.findIndex((input: any) => input.id === id);
        return index < 0 ? null : target.pendingCodexInputs.splice(index, 1)[0];
      },
      requestCodexAutoRecovery: vi.fn(),
      sendToBrowser: vi.fn(),
      trySteerPendingCodexInputs: vi.fn(),
    } as any);

    expect(session.state.codex_provider_retry).toBeNull();
    expect(session.state.backend_reconnect).toBeNull();
    expect(session.state.backend_state).toBe("disconnected");
    expect(broadcasts).toContainEqual({
      type: "session_update",
      session: expect.objectContaining({
        codex_provider_retry: null,
        backend_reconnect: null,
        backend_state: "disconnected",
      }),
    });
  });

  it("keeps recovery-only delivery and queue policy out of cancellation responses", () => {
    const session = makeSession();
    session.messageHistory = [];
    session.pendingCodexInputs = [
      {
        id: "recovery-input",
        content: "Visible recovery status",
        deliveryContent: "PRIVATE VERIFICATION INSTRUCTION",
        timestamp: 1,
        cancelable: true,
        agentSource: { sessionId: "system:codex-turn-recovery:owner", sessionLabel: "Recovery" },
        threadKey: "q-1",
        questId: "q-1",
        historyFollowUps: [{ content: "PRIVATE FOLLOW-UP" }],
        autoPauseRecoveries: [{ summaryId: "summary", groupId: "group" }],
        queueBeforeOwnerId: "later-owner",
        requireFreshSuccessor: true,
      },
    ];
    const sendToBrowser = vi.fn();

    handleCodexPendingInputAction(session, { type: "cancel_pending_codex_input", id: "recovery-input" }, {}, {
      broadcastToBrowsers: vi.fn(),
      clearQueuedTurnLifecycleEntries: vi.fn(),
      getCancelablePendingCodexInputs: (target: any) =>
        target.pendingCodexInputs.filter((input: any) => input.cancelable),
      isCodexWorkerV2DeliveryFrozen: () => false,
      markRunningFromUserDispatch: vi.fn(),
      persistSession: vi.fn(),
      queueCodexPendingStartBatch: vi.fn(),
      rebuildQueuedCodexPendingStartBatch: vi.fn(),
      removePendingCodexInput: (target: any, id: string) => {
        const index = target.pendingCodexInputs.findIndex((input: any) => input.id === id);
        return index < 0 ? null : target.pendingCodexInputs.splice(index, 1)[0];
      },
      requestCodexAutoRecovery: vi.fn(),
      sendToBrowser,
      trySteerPendingCodexInputs: vi.fn(),
    } as any);

    expect(sendToBrowser).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        type: "codex_pending_input_cancelled",
        input: expect.objectContaining({
          id: "recovery-input",
          content: "Visible recovery status",
          agentSource: { sessionId: "system:codex-turn-recovery:owner", sessionLabel: "Recovery" },
          threadKey: "q-1",
          questId: "q-1",
        }),
      }),
    );
    const payload = sendToBrowser.mock.calls[0]?.[1]?.input;
    expect(JSON.stringify(payload)).not.toContain("PRIVATE");
    expect(payload).not.toHaveProperty("deliveryContent");
    expect(payload).not.toHaveProperty("historyFollowUps");
    expect(payload).not.toHaveProperty("autoPauseRecoveries");
    expect(payload).not.toHaveProperty("queueBeforeOwnerId");
    expect(payload).not.toHaveProperty("requireFreshSuccessor");
  });

  it("clears retry presentation immediately when the user pauses delivery", () => {
    const session = makeSession();
    session.state.backend_state = "recovering";
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 4,
      maxAttempts: null,
      startedAt: 10,
    };
    const broadcasts: any[] = [];

    pauseSessionForDelivery(
      session,
      { pausedBy: "user" },
      {
        broadcastToBrowsers: (_target: any, message: any) => broadcasts.push(message),
        persistSession: vi.fn(),
      },
    );

    expect(session.state.codex_provider_retry).toBeNull();
    expect(session.state.backend_reconnect).toBeNull();
    expect(session.state.backend_state).toBe("disconnected");
    expect(broadcasts.at(-1)).toMatchObject({
      type: "session_update",
      session: {
        codex_provider_retry: null,
        backend_reconnect: null,
        backend_state: "disconnected",
        pause: { pausedBy: "user" },
      },
    });
  });
});
