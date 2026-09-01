import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";
import { reconcileRecoveredQueuedTurnLifecycle } from "./codex-queued-turn-lifecycle.js";
import { handleCodexResultErrorAutoPause as handleCodexResultErrorAutoPauseDelivery } from "./codex-result-error-auto-pause-delivery.js";

function makeResult(turnId: string, uuid: string): Extract<BrowserIncomingMessage, { type: "result" }> {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "stream disconnected before completion: error sending request for url (https://example.test/responses)",
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      stop_reason: "failed",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      session_id: "provider-retry-session",
      codex_turn_id: turnId,
      uuid,
    },
  };
}

function makeSuccess(turnId: string): Extract<BrowserIncomingMessage, { type: "result" }> {
  const message = makeResult(turnId, "success-result");
  message.data = { ...message.data, subtype: "success", is_error: false, result: "Recovered", stop_reason: "end_turn" };
  return message;
}

function makeTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [{ content: "continue" }] },
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

function makeSession(turn = makeTurn()) {
  return {
    id: "provider-retry-session",
    backendType: "codex",
    state: { isOrchestrator: false, backend_type: "codex" },
    messageHistory: [
      { type: "user_message", id: "input-1", content: "continue", timestamp: 1 } as BrowserIncomingMessage,
    ],
    pendingCodexTurns: [turn],
    pendingCodexInputs: [],
    queuedTurnStarts: 0,
    queuedTurnReasons: [],
    queuedTurnUserMessageIds: [],
    queuedTurnInterruptSources: [],
    queuedTurnActiveRoutes: [],
    toolStartTimes: new Map(),
    toolProgressOutput: new Map(),
    isGenerating: true,
    activeTurnRoute: null,
    notifications: [],
    notificationCounter: 0,
    attentionReason: null,
    consecutiveAdapterFailures: 0,
    lastAdapterFailureAt: null,
  } as any;
}

function makeDeps(session: ReturnType<typeof makeSession>, broadcasts: BrowserIncomingMessage[]) {
  const deps: CodexAdapterBrowserMessageDeps = {
    getLauncherSessionInfo: () => null,
    touchActivity: vi.fn(),
    clearOptimisticRunningTimer: vi.fn(),
    setCodexImageSendStage: vi.fn(),
    sanitizeCodexSessionPatch: (patch) => patch,
    cacheSlashCommandState: vi.fn(),
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    persistSession: vi.fn(),
    emitTakodeEvent: vi.fn(),
    freezeHistoryThroughCurrentTail: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    trackCodexQuestCommands: vi.fn(),
    reconcileCodexQuestToolResult: vi.fn(async () => {}),
    collectCompletedToolStartTimes: () => [],
    buildToolResultPreviews: () => [],
    projectToolResultPreviews: () => [],
    broadcastToBrowsers: (_target, message) => broadcasts.push(message),
    finalizeSupersededCodexTerminalTools: vi.fn(),
    isDuplicateCodexAssistantReplay: () => false,
    completeCodexTurnsForResult: vi.fn(() => true),
    clearCodexFreshTurnRequirement: vi.fn(),
    reconcileRecoveredQueuedTurnLifecycle: vi.fn(),
    handleResultMessage: vi.fn((_target, result: CLIResultMessage) => {
      if (result.codex_provider_retry) return;
      session.messageHistory.push({ type: "result", data: { ...result } });
      broadcasts.push({ type: "result", data: { ...result } });
    }),
    queueCodexPendingStartBatch: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    handleCodexPermissionRequest: vi.fn(),
    requestCodexLeaderRecycle: vi.fn(async () => ({ ok: true })),
    handleCodexResultErrorAutoPause: vi.fn(),
    requestCodexProviderRecovery: vi.fn(() => true),
  };
  return deps;
}

function reacknowledge(turn: CodexOutboundTurn, turnId: string): void {
  turn.status = "backend_acknowledged";
  turn.turnId = turnId;
  turn.acknowledgedAt = Date.now();
}

describe("Codex transient provider retry presentation", () => {
  it("keeps one exact owner retrying beyond the old cap without growing transient history", async () => {
    // Producer-shaped results exercise the real controller ordering. The live
    // retry state advances, while raw attempt results never enter history.
    const turn = makeTurn();
    const session = makeSession(turn);
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);
    const initialHistoryLength = session.messageHistory.length;
    let startedAt: number | undefined;

    for (let attempt = 1; attempt <= 5; attempt++) {
      if (attempt > 1) reacknowledge(turn, `turn-${attempt}`);
      await handleCodexAdapterBrowserMessage(session, makeResult(`turn-${attempt}`, `retry-${attempt}`), deps);
      expect(session.state.codex_provider_retry).toMatchObject({
        ownerId: "input-1",
        attempt,
        maxAttempts: null,
      });
      startedAt ??= session.state.codex_provider_retry.startedAt;
      expect(session.state.codex_provider_retry.startedAt).toBe(startedAt);
      expect(session.messageHistory).toHaveLength(initialHistoryLength);
    }

    expect(deps.completeCodexTurnsForResult).not.toHaveBeenCalled();
    expect(deps.requestCodexProviderRecovery).toHaveBeenCalledTimes(5);
    expect(broadcasts.filter((message) => message.type === "result")).toHaveLength(0);
  });

  it("does not replay a classified provider failure after canonical interruption", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);
    const interrupted = { ...makeResult("turn-1", "interrupted-provider-result"), interrupted: true };

    await handleCodexAdapterBrowserMessage(session, interrupted, deps);

    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledWith(session, interrupted.data, expect.any(Number), true);
    expect(turn.providerRecoveryAttempts).toBeUndefined();
    expect(deps.requestCodexProviderRecovery).toHaveBeenCalledTimes(1);
  });

  it("persists live stream activity as replay-blocking proof", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    session.codexAdapter = { getCurrentTurnId: () => "turn-1" };
    const deps = makeDeps(session, []);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "stream_event",
        parent_tool_use_id: null,
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "partial" } },
      } as any,
      deps,
    );
    await handleCodexAdapterBrowserMessage(session, makeResult("turn-1", "stream-after-partial"), deps);

    expect(turn.providerReplayUnsafeActivityObserved).toBe(true);
    expect(turn.providerRecoveryAttempts).toBeUndefined();
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
  });

  it("removes stale queued lifecycle ownership when same-turn co-owners canonicalize", async () => {
    const current = makeTurn();
    const steered: CodexOutboundTurn = {
      ...makeTurn(),
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: ["input-2"],
        inputs: [{ content: "follow-up" }],
      },
      userMessageId: "input-2",
      pendingInputIds: ["input-2"],
      userContent: "follow-up",
      historyIndex: 1,
      turnTarget: "queued",
    };
    const session = makeSession(current);
    session.pendingCodexTurns = [current, steered];
    session.messageHistory.push({
      type: "user_message",
      id: "input-2",
      content: "follow-up",
      timestamp: 2,
    });
    session.queuedTurnStarts = 1;
    session.queuedTurnReasons = ["queued_user_message"];
    session.queuedTurnUserMessageIds = [[1]];
    session.queuedTurnInterruptSources = [null];
    session.queuedTurnActiveRoutes = [null];
    const deps = makeDeps(session, []);
    deps.reconcileRecoveredQueuedTurnLifecycle = (target, reason) => {
      reconcileRecoveredQueuedTurnLifecycle(target, reason, {
        getCodexHeadTurn: (candidate) => candidate.pendingCodexTurns[0] ?? null,
      });
    };

    await handleCodexAdapterBrowserMessage(session, makeResult("turn-1", "same-turn-retry"), deps);

    expect(session.pendingCodexTurns).toHaveLength(1);
    expect(session.pendingCodexTurns[0]?.pendingInputIds).toEqual(["input-1", "input-2"]);
    expect(session.queuedTurnStarts).toBe(0);
  });

  it("clears active retry state when the replayed request succeeds", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 1,
      maxAttempts: 2,
      startedAt: 10,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeSuccess("turn-1"), deps);

    expect(session.state.codex_provider_retry).toBeNull();
    expect(broadcasts).toContainEqual({ type: "session_update", session: { codex_provider_retry: null } });
    expect(session.messageHistory.at(-1)).toMatchObject({ type: "result", data: { is_error: false } });
  });

  it("clears the held-input pause when the exact automatic provider-retry owner succeeds live", async () => {
    const turn = makeTurn();
    turn.autoPauseSourceKind = "automatic";
    turn.providerRecoveryAttempts = 151;
    turn.providerRecoveryFamily = "model_backend_stream_error";
    const session = makeSession(turn);
    session.state.codex_result_error_auto_pause = {
      family: "model_backend_stream_error",
      fingerprint: "model_backend_stream_error:responses",
      streak: 3,
      threshold: 3,
      pausedAt: 10,
      lastError: "Model backend stream disconnected before completion.",
      lastErrorAt: 10,
      lastSourceKind: "automatic",
      totalMatchingErrors: 3,
      heldInputs: [],
    };
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 151,
      maxAttempts: null,
      startedAt: 10,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);
    deps.handleCodexResultErrorAutoPause = (target, result, completedTurn, interrupted) =>
      handleCodexResultErrorAutoPauseDelivery(
        target as any,
        result,
        completedTurn,
        {
          broadcastToBrowsers: (_session: unknown, message: BrowserIncomingMessage) => broadcasts.push(message),
          broadcastPendingCodexInputs: vi.fn(),
          persistSession: vi.fn(),
          persistSessionImmediately: vi.fn(async () => {}),
          getBrowserTransportDeps: () => ({}) as any,
          releasePendingTransfer: vi.fn(),
        },
        interrupted,
      );

    await handleCodexAdapterBrowserMessage(session, makeSuccess("turn-1"), deps);

    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(broadcasts).toContainEqual({
      type: "session_update",
      session: {
        codex_result_error_auto_pause: null,
        codex_result_error_auto_pause_recovery_progress: null,
      },
    });
  });

  it("retires an orphaned retry owner when a different turn later completes", async () => {
    const turn = makeTurn();
    turn.userMessageId = "new-input";
    turn.pendingInputIds = ["new-input"];
    const session = makeSession(turn);
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "old-input",
      attempt: 1,
      maxAttempts: 2,
      startedAt: 10,
    };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(session, makeSuccess("turn-1"), makeDeps(session, broadcasts));

    expect(session.state.codex_provider_retry).toBeNull();
    expect(broadcasts).toContainEqual({ type: "session_update", session: { codex_provider_retry: null } });
  });

  it("does not retire retry state merely because unrelated assistant output appears", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 1,
      maxAttempts: 2,
      startedAt: 10,
    };
    const deps = makeDeps(session, []);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "assistant",
        parent_tool_use_id: null,
        timestamp: 20,
        message: {
          id: "unrelated-output",
          type: "message",
          role: "assistant",
          model: "gpt-test",
          content: [{ type: "text", text: "Unrelated output" }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
      },
      deps,
    );

    expect(session.state.codex_provider_retry).toMatchObject({ ownerId: "input-1", attempt: 1 });
  });

  it("fails closed with a normal terminal result when provider recovery cannot start", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    session.state.codex_provider_retry = {
      family: "model_backend_stream_error",
      ownerId: "input-1",
      attempt: 1,
      maxAttempts: 2,
      startedAt: 10,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);
    deps.requestCodexProviderRecovery = vi.fn(() => false);

    await handleCodexAdapterBrowserMessage(session, makeResult("turn-1", "recovery-refused"), deps);

    expect(session.state.codex_provider_retry).toBeNull();
    expect((session.messageHistory.at(-1) as any).data.codex_provider_retry).toBeUndefined();
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
    expect(broadcasts).toContainEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("use Reconnect to retry") }),
    );
  });

  it("keeps side-effect-bearing failures terminal while refreshing only the process", async () => {
    const turn = makeTurn();
    const session = makeSession(turn);
    session.messageHistory.push({
      type: "assistant",
      parent_tool_use_id: null,
      timestamp: 2,
      message: {
        id: "assistant-tool",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo done" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
    const deps = makeDeps(session, []);

    await handleCodexAdapterBrowserMessage(session, makeResult("turn-1", "unsafe-result"), deps);

    expect(session.state.codex_provider_retry).toBeUndefined();
    expect((session.messageHistory.at(-1) as any).data.codex_provider_retry).toBeUndefined();
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
    expect(deps.requestCodexProviderRecovery).toHaveBeenCalledTimes(1);
  });
});
