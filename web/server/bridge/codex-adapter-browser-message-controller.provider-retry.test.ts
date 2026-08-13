import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";

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

function makeSession(turn = makeTurn()) {
  return {
    id: "provider-retry-session",
    state: { isOrchestrator: false, backend_type: "codex" },
    messageHistory: [
      { type: "user_message", id: "input-1", content: "continue", timestamp: 1 } as BrowserIncomingMessage,
    ],
    pendingCodexTurns: [turn],
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
    broadcastToBrowsers: (_target, message) => broadcasts.push(message),
    finalizeSupersededCodexTerminalTools: vi.fn(),
    isDuplicateCodexAssistantReplay: () => false,
    completeCodexTurnsForResult: vi.fn(() => true),
    clearCodexFreshTurnRequirement: vi.fn(),
    handleResultMessage: vi.fn((_target, result: CLIResultMessage) => {
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
  it("marks both safe retries as transient, then exposes the exhausted terminal result", async () => {
    // Producer-shaped results exercise the real controller ordering: persisted
    // retry markers are audit evidence, not terminal feed errors or replay blockers.
    const turn = makeTurn();
    const session = makeSession(turn);
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeResult("turn-1", "retry-1"), deps);

    expect(session.state.codex_provider_retry).toMatchObject({ ownerId: "input-1", attempt: 1, maxAttempts: 2 });
    expect(session.messageHistory.at(-1)).toMatchObject({
      type: "result",
      data: { codex_provider_retry: { ownerId: "input-1", attempt: 1, maxAttempts: 2 } },
    });
    expect(deps.completeCodexTurnsForResult).not.toHaveBeenCalled();

    const startedAt = session.state.codex_provider_retry.startedAt;
    reacknowledge(turn, "turn-2");
    await handleCodexAdapterBrowserMessage(session, makeResult("turn-2", "retry-2"), deps);

    expect(session.state.codex_provider_retry).toMatchObject({
      ownerId: "input-1",
      attempt: 2,
      maxAttempts: 2,
      startedAt,
    });
    expect(session.messageHistory.at(-1)).toMatchObject({
      type: "result",
      data: { codex_provider_retry: { ownerId: "input-1", attempt: 2 } },
    });
    expect(deps.requestCodexProviderRecovery).toHaveBeenCalledTimes(2);

    reacknowledge(turn, "turn-3");
    await handleCodexAdapterBrowserMessage(session, makeResult("turn-3", "retry-exhausted"), deps);

    expect(session.state.codex_provider_retry).toBeNull();
    expect(session.messageHistory.at(-1)).toMatchObject({ type: "result", data: { is_error: true } });
    expect((session.messageHistory.at(-1) as any).data.codex_provider_retry).toBeUndefined();
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
    expect(deps.requestCodexProviderRecovery).toHaveBeenCalledTimes(2);
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
