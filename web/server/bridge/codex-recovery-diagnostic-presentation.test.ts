import { beforeEach, describe, expect, it, vi } from "vitest";

const logCodexRecoveryDiagnostic = vi.hoisted(() => vi.fn());
vi.mock("./codex-recovery-diagnostic-log.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./codex-recovery-diagnostic-log.js")>()),
  logCodexRecoveryDiagnostic,
}));

import type { CodexResumeSnapshot } from "../codex-adapter.js";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import {
  reconcileCodexResumedTurn,
  type CodexRecoveryOrchestratorDeps,
  type CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";
import { completeRecoveredCodexTurnWithDiagnostic } from "./codex-recovered-turn-diagnostic.js";
import { completeCodexTurn } from "./codex-turn-queue.js";

function pendingTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "inspect the screenshot" },
    userMessageId: "user-1",
    pendingInputIds: ["user-1"],
    userContent: "inspect the screenshot",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-interrupted",
    disconnectedAt: 100,
    resumeConfirmedAt: null,
  };
}

function sessionWithRoutedPartial(): CodexRecoveryOrchestratorSessionLike {
  const user: BrowserIncomingMessage = {
    type: "user_message",
    id: "user-1",
    content: "inspect the screenshot",
    timestamp: 1,
    threadKey: "main",
  };
  const partial: BrowserIncomingMessage = {
    type: "assistant",
    message: {
      id: "live-partial",
      type: "message",
      role: "assistant",
      model: "gpt-5.6-sol",
      content: [{ type: "text", text: "I am reading the screenshot first." }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: 2,
    threadKey: "main",
  };
  return {
    id: "session-incident",
    backendType: "codex",
    state: {
      backend_state: "connected",
      backend_type: "codex",
      cwd: "/repo",
      model: "gpt-5.6-sol",
      is_compacting: false,
      isOrchestrator: true,
    },
    messageHistory: [user, partial],
    pendingMessages: [],
    pendingCodexInputs: [],
    pendingCodexTurns: [pendingTurn()],
    codexFreshTurnRequiredUntilTurnId: null,
    isGenerating: true,
    cliInitReceived: true,
    consecutiveAdapterFailures: 0,
    lastAdapterFailureAt: null,
    queuedTurnStarts: 0,
    queuedTurnReasons: [],
    queuedTurnUserMessageIds: [],
    queuedTurnInterruptSources: [],
    codexAdapter: null,
  };
}

function interruptedSnapshot(turnId = "turn-interrupted"): CodexResumeSnapshot {
  return {
    threadId: "thread-incident",
    threadStatus: "idle",
    turnCount: 1,
    turns: [],
    lastTurn: {
      id: turnId,
      status: "interrupted",
      error: null,
      items: [
        { type: "userMessage", content: [{ type: "text", text: "inspect the screenshot" }] },
        { type: "agentMessage", id: "item-1", text: "[thread:main] I am reading the screenshot first." },
      ],
    },
  } as CodexResumeSnapshot;
}

function deps(session: CodexRecoveryOrchestratorSessionLike): CodexRecoveryOrchestratorDeps {
  return {
    codexAssistantReplayScanLimit: 10,
    formatVsCodeSelectionPrompt: () => "",
    broadcastPendingCodexInputs: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    touchUserMessage: vi.fn(),
    emitTakodeEvent: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    injectUserMessage: vi.fn((_sessionId, content, agentSource, route, options) => {
      session.pendingCodexInputs.push({
        id: "recovery-continuation-1",
        content,
        deliveryContent: options.deliveryContent,
        timestamp: 3,
        cancelable: true,
        agentSource,
        threadKey: route.threadKey,
        ...(route.questId ? { questId: route.questId } : {}),
      } as (typeof session.pendingCodexInputs)[number]);
      options.afterAccepted?.();
      return "sent";
    }),
    setAttentionError: vi.fn(),
    enqueueCodexTurn: vi.fn(),
    getCodexHeadTurn: vi.fn((session) => session.pendingCodexTurns[0] ?? null),
    getCodexTurnInRecovery: vi.fn((session) => session.pendingCodexTurns[0] ?? null),
    completeCodexTurn: vi.fn((session, turn) => {
      if (turn) turn.status = "completed";
      session.pendingCodexTurns = [];
      return true;
    }),
    completeCodexTurnsForResult: vi.fn(() => false),
    clearCodexFreshTurnRequirement: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    pruneStalePendingCodexHerdInputs: vi.fn(() => false),
    synthesizeCodexToolResultsFromResumedTurn: vi.fn(() => ({ count: 0, omittedFromResumeSnapshotCount: 0 })),
    handleRecoveredCodexAutoPauseSuccess: vi.fn(),
    trackUserMessageForTurn: vi.fn(),
    markTurnInterrupted: vi.fn(),
    setGenerating: vi.fn(),
    markRunningFromUserDispatch: vi.fn(() => "current"),
    promoteNextQueuedTurn: vi.fn(() => false),
    isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
  } as unknown as CodexRecoveryOrchestratorDeps;
}

function recoveryDiagnostics(session: CodexRecoveryOrchestratorSessionLike) {
  return session.messageHistory.filter(
    (message) =>
      message.type === "user_message" && message.agentSource?.sessionId === "system:codex-leader-recovery-diagnostic",
  );
}

describe("Codex recovered-turn diagnostic presentation", () => {
  beforeEach(() => {
    logCodexRecoveryDiagnostic.mockClear();
  });

  it("queues a separate continuation without adding fallback diagnostics", () => {
    const session = sessionWithRoutedPartial();
    const recoveryDeps = deps(session);
    const snapshot = interruptedSnapshot();

    reconcileCodexResumedTurn(session, snapshot, recoveryDeps);

    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "user-1",
      originalProviderTurnId: "turn-interrupted",
      status: "continuation_pending",
      continuationOwnerId: "recovery-continuation-1",
      threadKey: "main",
    });
    expect(recoveryDiagnostics(session)).toHaveLength(0);
    expect(session.messageHistory.filter((message) => message.type === "assistant")).toHaveLength(1);
    expect(recoveryDeps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "error" }),
    );
    expect(recoveryDeps.dispatchQueuedCodexTurns).not.toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledTimes(1);
    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: session.id,
        ownerId: "user-1",
        providerTurnId: "turn-interrupted",
        evidenceClass: "interrupted_assistant",
        presentation: "continuation_queued",
        continuationQueued: true,
        diagnosticAppended: false,
        browserErrorBroadcast: false,
        routeThreadKey: "main",
      }),
    );
  });

  it("logs the resumed provider turn before settling exact same-turn co-owners", () => {
    const session = sessionWithRoutedPartial();
    session.pendingCodexTurns[0]!.turnId = null;
    const recoveryDeps = deps(session);
    const coOwner = pendingTurn();
    coOwner.userMessageId = "user-2";
    coOwner.pendingInputIds = ["user-2"];
    coOwner.turnId = "turn-resumed-by-text";
    session.pendingCodexTurns.push(coOwner);
    recoveryDeps.completeCodexTurn = vi.fn((targetSession, turn) => completeCodexTurn(targetSession, turn));

    reconcileCodexResumedTurn(session, interruptedSnapshot("turn-resumed-by-text"), recoveryDeps);

    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "user-1",
        providerTurnId: "turn-resumed-by-text",
        sameTurnCoOwnerCount: 2,
        presentation: "continuation_queued",
      }),
    );
    expect(
      session.pendingCodexTurns.some(
        (turn) =>
          turn.userMessageId === "user-1" || turn.userMessageId === "user-2" || turn.turnId === "turn-resumed-by-text",
      ),
    ).toBe(false);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "user-1",
      originalProviderTurnId: "turn-resumed-by-text",
      status: "continuation_pending",
    });
    expect(recoveryDeps.setGenerating).toHaveBeenCalledWith(session, false, "codex_interrupted_turn_continuation");
  });

  it("keeps a valid routed recovery actionable when continuation dispatch is dropped", () => {
    const session = sessionWithRoutedPartial();
    const recoveryDeps = deps(session);
    recoveryDeps.injectUserMessage = vi.fn(() => "dropped" as const);

    reconcileCodexResumedTurn(session, interruptedSnapshot(), recoveryDeps);

    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "user-1",
      status: "action_required",
      reason: "continuation_dispatch_failed",
      threadKey: "main",
    });
    expect(recoveryDiagnostics(session)).toHaveLength(1);
    expect(recoveryDiagnostics(session)[0]).toMatchObject({
      threadKey: "main",
      codexTurnRecoveryId: "user-1",
    });
    expect(recoveryDeps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "error" }),
    );
    expect(recoveryDeps.setAttentionError).not.toHaveBeenCalled();
    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "action_required",
        continuationQueued: false,
        diagnosticAppended: true,
        browserErrorBroadcast: false,
        routeThreadKey: "main",
      }),
    );
  });

  it("uses a verification-first continuation for a routed automatic recovery owner", () => {
    const session = sessionWithRoutedPartial();
    const source = { sessionId: "system:herd-delivery", sessionLabel: "Herd Delivery" };
    const original = session.messageHistory[0];
    if (original?.type === "user_message") original.agentSource = source;
    const pending = session.pendingCodexTurns[0];
    if (pending?.adapterMsg.type === "user_message") pending.adapterMsg.agentSource = source;
    const recoveryDeps = deps(session);

    reconcileCodexResumedTurn(session, interruptedSnapshot(), recoveryDeps);

    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(recoveryDiagnostics(session)).toHaveLength(0);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "user-1",
      continuationOwnerId: "recovery-continuation-1",
      continuationMode: "verify_then_continue",
      status: "continuation_pending",
    });
    expect(recoveryDeps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "error" }),
    );
    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "continuation_queued",
        continuationQueued: true,
        diagnosticAppended: false,
        browserErrorBroadcast: false,
        routeThreadKey: "main",
      }),
    );
  });

  it("keeps a later interrupted turn separate from an existing action-required recovery", () => {
    const session = sessionWithRoutedPartial();
    session.state.codex_turn_recovery = {
      recoveryId: "older-recovery",
      originalOwnerId: "older-owner",
      originalProviderTurnId: "older-turn",
      originalHistoryIndex: 0,
      continuationOwnerId: null,
      threadKey: "main",
      status: "action_required",
      reason: "continuation_failed",
      raisedAttention: true,
      attempt: 1,
      maxAttempts: 1,
      createdAt: 1,
      updatedAt: 2,
    };
    const laterOwner = pendingTurn();
    laterOwner.userMessageId = "later-owner";
    laterOwner.pendingInputIds = ["later-owner"];
    laterOwner.turnId = "later-turn";
    laterOwner.historyIndex = 2;
    session.messageHistory.push({
      type: "user_message",
      id: "later-owner",
      content: "later interrupted work",
      timestamp: 10,
      threadKey: "main",
    });
    session.pendingCodexTurns = [laterOwner];
    const recoveryDeps = deps(session);

    const outcome = completeRecoveredCodexTurnWithDiagnostic(
      session,
      laterOwner,
      "later_interrupted_turn",
      "fallback",
      recoveryDeps,
      { leaderDiagnosticRoute: { threadKey: "main" }, recoveryOwner: laterOwner },
    );

    expect(outcome).toMatchObject({ diagnosticAppended: true, browserErrorBroadcast: false });
    expect(session.state.codex_turn_recovery).toMatchObject({ recoveryId: "older-recovery" });
    expect(recoveryDiagnostics(session)).toContainEqual(
      expect.objectContaining({ codexTurnRecoveryId: "later-owner", threadKey: "main" }),
    );
  });

  it("keeps a non-orchestrator recovery as a browser error without a leader diagnostic", () => {
    const session = sessionWithRoutedPartial();
    session.state.isOrchestrator = false;
    const recoveryDeps = deps(session);

    reconcileCodexResumedTurn(session, interruptedSnapshot(), recoveryDeps);

    expect(recoveryDeps.injectUserMessage).not.toHaveBeenCalled();
    expect(recoveryDiagnostics(session)).toHaveLength(0);
    expect(recoveryDeps.broadcastToBrowsers).toHaveBeenCalledWith(session, expect.objectContaining({ type: "error" }));
    expect(logCodexRecoveryDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        presentation: "browser_error",
        continuationQueued: false,
        diagnosticAppended: false,
        browserErrorBroadcast: true,
        routeThreadKey: null,
      }),
    );
  });
});
