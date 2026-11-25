import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";

// The turn result Codex reports when GitHub Copilot refuses the request's `service_tier`
// (Fast). Captured from codex app-server 0.162.1: turn/completed status "failed" with this error.
const COPILOT_SERVICE_TIER_REJECTION =
  '{"error":{"message":"service_tier is not supported","code":"unsupported_value","param":"service_tier","type":"invalid_request_error"}}\n';

function makeRejectedResult(turnId: string): Extract<BrowserIncomingMessage, { type: "result" }> {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: COPILOT_SERVICE_TIER_REJECTION,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: "failed",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      session_id: "fast-session",
      codex_turn_id: turnId,
      uuid: `result-${turnId}`,
    },
  };
}

function makeTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [{ content: "open the slicer" }] },
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "open the slicer",
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

function makeSession(turn: CodexOutboundTurn, serviceTier: string | null) {
  return {
    id: "fast-session",
    backendType: "codex",
    state: { isOrchestrator: false, backend_type: "codex", codex_service_tier: serviceTier },
    messageHistory: [
      { type: "user_message", id: "input-1", content: "open the slicer", timestamp: 1 } as BrowserIncomingMessage,
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
      // Like the real handler, a result that carries retry state stays out of history.
      if (result.codex_provider_retry) return;
      session.messageHistory.push({ type: "result", data: { ...result } });
    }),
    queueCodexPendingStartBatch: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    handleCodexPermissionRequest: vi.fn(),
    requestCodexLeaderRecycle: vi.fn(async () => ({ ok: true })),
    handleCodexResultErrorAutoPause: vi.fn(),
    requestCodexProviderRecovery: vi.fn(() => true),
    turnOffCodexServiceTier: vi.fn((target) => {
      target.state.codex_service_tier = null;
    }),
  };
  return deps;
}

describe("Codex Fast rejected by the provider", () => {
  it("turns Fast off and re-runs the failed message at Standard speed without a relaunch", async () => {
    const turn = makeTurn();
    const session = makeSession(turn, "priority");
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeRejectedResult("turn-1"), deps);

    expect(deps.turnOffCodexServiceTier).toHaveBeenCalledWith(session);
    expect(session.state.codex_service_tier).toBeNull();
    // The same message is queued again and dispatched; no process relaunch is needed.
    expect(turn.status).toBe("queued");
    expect(turn.providerRecoveryFamily).toBe("codex_service_tier_rejected");
    expect(deps.completeCodexTurnsForResult).not.toHaveBeenCalled();
    expect(deps.requestCodexProviderRecovery).not.toHaveBeenCalled();
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_turn_completed");
    // The failed attempt is a retry, not a visible failure, and the user is told why Fast went off.
    expect(session.state.codex_provider_retry).toMatchObject({
      family: "codex_service_tier_rejected",
      ownerId: "input-1",
      attempt: 1,
      maxAttempts: 1,
    });
    expect(session.messageHistory.some((message: BrowserIncomingMessage) => message.type === "result")).toBe(false);
    const notice = broadcasts.find((message) => message.type === "error");
    expect(notice).toMatchObject({ message: expect.stringContaining("doesn't support Fast") });
    expect(notice).toMatchObject({ message: expect.stringContaining("re-running your last message") });
  });

  it("turns Fast off but keeps the failure visible when the turn can't be safely re-run", async () => {
    // Assistant output after the user message means re-sending could repeat work.
    const turn = makeTurn();
    const session = makeSession(turn, "priority");
    session.messageHistory.push({
      type: "assistant",
      message: { id: "a1", type: "message", role: "assistant", model: "gpt", content: [], stop_reason: null },
      parent_tool_use_id: null,
    });
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeRejectedResult("turn-1"), deps);

    expect(deps.turnOffCodexServiceTier).toHaveBeenCalledWith(session);
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
    expect(deps.requestCodexProviderRecovery).not.toHaveBeenCalled();
    expect(session.state.codex_provider_retry).toBeUndefined();
    expect(broadcasts.find((message) => message.type === "error")).toMatchObject({
      message: expect.stringContaining("Send your last message again"),
    });
  });

  it("leaves sessions without Fast untouched", async () => {
    // Backends that accept Fast never produce this error; without a tier there is nothing to turn off.
    const turn = makeTurn();
    const session = makeSession(turn, null);
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(session, broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeRejectedResult("turn-1"), deps);

    expect(deps.turnOffCodexServiceTier).not.toHaveBeenCalled();
    expect(deps.completeCodexTurnsForResult).toHaveBeenCalledTimes(1);
    expect(broadcasts.some((message) => message.type === "error")).toBe(false);
  });
});
