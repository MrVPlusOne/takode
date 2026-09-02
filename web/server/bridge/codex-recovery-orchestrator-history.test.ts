import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import { createCodexHistoryIncorporation } from "./codex-history-incorporation.js";
import { reconcileEvidenceAwareCodexResume } from "./codex-evidence-aware-resume.js";
import {
  completeCodexTurnsForResult,
  dispatchQueuedCodexTurns,
  rebuildQueuedCodexPendingStartBatch,
  reconcileCodexResumedTurn,
  reconcileDuplicateCodexPendingTurns,
  type CodexRecoveryOrchestratorDeps,
  type CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";
import {
  advanceCodexTerminalHistoryReconciliation,
  reconcileUnknownCodexTurnBeforeDispatch,
} from "./codex-terminal-history-reconciliation.js";
import { completeCodexTurn } from "./codex-turn-queue.js";
import { normalizePersistedCodexTurn } from "./session-registry-controller.js";

function makeSession(pendingInputs: PendingCodexInput[]): CodexRecoveryOrchestratorSessionLike {
  return {
    id: "test-session",
    backendType: "codex",
    state: { backend_state: "connected", backend_type: "codex", cwd: "/tmp", model: "gpt-5.4", is_compacting: false },
    messageHistory: [] as BrowserIncomingMessage[],
    pendingMessages: [],
    pendingCodexInputs: pendingInputs,
    pendingCodexTurns: [],
    codexFreshTurnRequiredUntilTurnId: null,
    isGenerating: false,
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

function makePendingTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "continue" } as any,
    userMessageId: "user-1",
    pendingInputIds: ["input-1"],
    userContent: "continue",
    historyIndex: -1,
    status: "dispatched",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: null,
    turnTarget: null,
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

function trackedOwner(id: string, recorded: boolean, providerRecoveryAttempts = 0): CodexOutboundTurn {
  const history = createCodexHistoryIncorporation([id]);
  history.providerTurnId = "turn-terminal";
  history.rpcAcceptedAt = 2;
  if (recorded) {
    history.recordedAt = 3;
    history.recordedSource = "live";
    history.historyIndexes = [0];
  }
  return {
    ...makePendingTurn(),
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: [id],
      inputs: [{ content: id }],
      clientUserMessageId: history.clientUserMessageId,
    },
    userMessageId: id,
    pendingInputIds: [id],
    userContent: id,
    historyIndex: recorded ? 0 : -1,
    status: "backend_acknowledged",
    acknowledgedAt: 2,
    turnId: "turn-terminal",
    historyIncorporation: history,
    providerRecoveryAttempts,
  };
}

function makeDeps(): CodexRecoveryOrchestratorDeps {
  return {
    codexAssistantReplayScanLimit: 0,
    formatVsCodeSelectionPrompt: () => "",
    broadcastPendingCodexInputs: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    touchUserMessage: vi.fn(),
    onUserMessage: vi.fn(),
    enqueueCodexTurn: vi.fn(),
    getCodexHeadTurn: vi.fn((session) => session.pendingCodexTurns[0] ?? null),
    getCodexTurnInRecovery: vi.fn((session) => session.pendingCodexTurns[0] ?? null),
    completeCodexTurn: vi.fn(() => false),
    completeCodexTurnsForResult: vi.fn(() => false),
    armCodexFreshTurnRequirement: vi.fn(),
    clearCodexFreshTurnRequirement: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    pruneStalePendingCodexHerdInputs: vi.fn(() => false),
    synthesizeCodexToolResultsFromResumedTurn: vi.fn(() => ({ count: 0, omittedFromResumeSnapshotCount: 0 })),
    handleRecoveredCodexAutoPauseSuccess: vi.fn(),
    trackUserMessageForTurn: vi.fn(),
    setGenerating: vi.fn(),
    markTurnInterrupted: vi.fn(),
    markRunningFromUserDispatch: vi.fn(() => "current"),
    promoteNextQueuedTurn: vi.fn(() => false),
    isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
    emitTakodeEvent: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    injectUserMessage: vi.fn(() => "sent"),
  } as unknown as CodexRecoveryOrchestratorDeps;
}

describe("Codex tracked co-owner recovery", () => {
  it("keeps restored unknown tracking in verification-first reconciliation after a terminal result", () => {
    const session = makeSession([
      { id: "unknown-owner", content: "unknown restored work", timestamp: 1, cancelable: false },
    ]);
    const pending = makePendingTurn();
    pending.userMessageId = "unknown-owner";
    pending.pendingInputIds = ["unknown-owner"];
    pending.userContent = "unknown restored work";
    pending.turnId = "turn-unknown";
    pending.status = "backend_acknowledged";
    pending.historyTrackingUnknown = true;
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "success",
          is_error: false,
          result: "completed",
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: "result-unknown",
          codex_turn_id: "turn-unknown",
          stop_reason: "completed",
        },
        deps,
        10,
      ),
    ).toBe(true);

    expect(session.pendingCodexTurns).toEqual([
      expect.objectContaining({
        userMessageId: "unknown-owner",
        status: "recovery_pending",
        terminalHistoryReconciliation: expect.objectContaining({
          presence: "unknown",
          action: "continue",
          continuationMode: "verify_then_continue",
        }),
      }),
    ]);
  });

  it.each([
    ["HTTP 401", "HTTP 401 Unauthorized", false, 0, undefined],
    ["certificate failure", "HTTP 403 Forbidden: invalid peer certificate", false, 0, undefined],
    ["unsupported model", "model_not_supported: requested model is not supported", false, 0, undefined],
    [
      "exhausted auth invalidation",
      "model_not_supported after Copilot authentication invalidation",
      false,
      2,
      { family: "copilot_auth_refresh_invalidated" },
    ],
    ["explicit cancellation", "cancelled by user", true, 0, undefined],
  ])("blocks automatic continuation after terminal %s results", (_label, resultText, interrupted, attempts, context) => {
    const session = makeSession([
      { id: "owner-b", content: "owner-b", timestamp: 2, cancelable: false },
      { id: "owner-c", content: "owner-c", timestamp: 3, cancelable: false },
    ]);
    session.state.isOrchestrator = true;
    session.messageHistory.push({ type: "user_message", id: "owner-a", content: "owner-a", timestamp: 1 });
    session.pendingCodexTurns = [
      trackedOwner("owner-a", true, attempts as number),
      trackedOwner("owner-b", false, attempts as number),
      trackedOwner("owner-c", false, attempts as number),
    ];
    const deps = makeDeps();

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: !interrupted,
          result: resultText as string,
          errors: [],
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: `result-${String(_label)}`,
          codex_turn_id: "turn-terminal",
          stop_reason: interrupted ? "cancelled" : "error",
          ...(context ? { codex_provider_failure_context: context as any } : {}),
        },
        deps,
        10,
        interrupted as boolean,
      ),
    ).toBe(true);

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "owner-b",
      status: "action_required",
    });
    expect(session.pendingCodexTurns).toEqual([
      expect.objectContaining({
        userMessageId: "owner-c",
        status: "recovery_pending",
        terminalHistoryReconciliation: expect.objectContaining({ action: "action_required" }),
      }),
    ]);
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("re-arms the fresh-successor guard for a resumed active recovery continuation", () => {
    const session = makeSession([]);
    const pending = makePendingTurn();
    const history = createCodexHistoryIncorporation(["input-1"]);
    history.providerTurnId = "turn-active";
    history.rpcAcceptedAt = 2;
    pending.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: ["input-1"],
      inputs: [{ content: "continue" }],
      clientUserMessageId: history.clientUserMessageId,
    };
    pending.historyIncorporation = history;
    pending.turnId = "turn-active";
    pending.status = "backend_acknowledged";
    pending.requiresFreshSuccessor = true;
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();
    const snapshot = {
      threadId: "thread",
      threadStatus: "active",
      turnCount: 1,
      turns: [
        {
          id: "turn-active",
          status: "inProgress",
          error: null,
          itemsView: "full" as const,
          items: [{ type: "userMessage", clientId: history.clientUserMessageId, content: [] }],
        },
      ],
      lastTurn: null,
    };

    expect(
      reconcileEvidenceAwareCodexResume(session, pending, snapshot, deps, {
        retryPendingTurn: vi.fn(),
        finalizeBatchHistory: vi.fn(),
        recordHistoryMilestone: vi.fn(),
      }),
    ).toBe(true);
    expect(deps.armCodexFreshTurnRequirement).toHaveBeenCalledWith(
      session,
      "turn-active",
      "codex_recovery_continuation_resumed",
    );
  });

  it("keeps an unreceipted same-turn owner out of result settlement and stages safe continuation", () => {
    const session = makeSession([
      {
        id: "owner-b",
        content: "second owner",
        timestamp: 2,
        cancelable: false,
        threadKey: "q-2",
        questId: "q-2",
      },
    ]);
    session.state.isOrchestrator = true;
    session.messageHistory.push({
      type: "user_message",
      id: "owner-a",
      content: "first owner",
      timestamp: 1,
      threadKey: "q-1",
      questId: "q-1",
    });
    const received = createCodexHistoryIncorporation(["owner-a"]);
    received.providerTurnId = "turn-shared";
    received.rpcAcceptedAt = 2;
    received.recordedAt = 3;
    received.recordedSource = "live";
    received.historyIndexes = [0];
    const unreceived = createCodexHistoryIncorporation(["owner-b"]);
    unreceived.providerTurnId = "turn-shared";
    unreceived.rpcAcceptedAt = 4;
    const first: CodexOutboundTurn = {
      ...makePendingTurn(),
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: ["owner-a"],
        inputs: [{ content: "first owner" }],
        clientUserMessageId: received.clientUserMessageId,
      },
      userMessageId: "owner-a",
      pendingInputIds: ["owner-a"],
      historyIndex: 0,
      status: "backend_acknowledged" as const,
      turnId: "turn-shared",
      acknowledgedAt: 2,
      historyIncorporation: received,
    };
    const second: CodexOutboundTurn = {
      ...makePendingTurn(),
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: ["owner-b"],
        inputs: [{ content: "second owner" }],
        clientUserMessageId: unreceived.clientUserMessageId,
      },
      userMessageId: "owner-b",
      pendingInputIds: ["owner-b"],
      userContent: "second owner",
      status: "backend_acknowledged" as const,
      turnId: "turn-shared",
      acknowledgedAt: 4,
      historyIncorporation: unreceived,
    };
    session.pendingCodexTurns = [first, second];
    session.state.codex_turn_recovery = {
      recoveryId: "owner-b",
      originalOwnerId: "owner-b",
      originalProviderTurnId: "turn-shared",
      originalHistoryIndex: -1,
      continuationOwnerId: null,
      threadKey: "q-2",
      questId: "q-2",
      status: "recovering",
      reason: "adapter_disconnect",
      attempt: 0,
      maxAttempts: 1,
      createdAt: 5,
      updatedAt: 5,
    };
    const deps = makeDeps();
    deps.getCodexHeadTurn = vi.fn((target) => target.pendingCodexTurns[0] ?? null);

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: "result-shared",
          codex_turn_id: "turn-shared",
          stop_reason: "completed",
        },
        deps,
        10,
      ),
    ).toBe(true);

    expect(session.pendingCodexTurns).toEqual([second]);
    expect(second).toMatchObject({
      status: "recovery_pending",
      terminalHistoryReconciliation: {
        presence: "unknown",
        action: "continue",
        continuationMode: "verify_then_continue",
      },
    });
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "owner-b",
      status: "recovering",
      attempt: 0,
    });
    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.messageHistory.at(-1)).toMatchObject({
      type: "user_message",
      id: "owner-b",
      content: "second owner",
      threadKey: "q-2",
    });
  });

  it("drains a selectively completed later co-owner before queuing the unknown head continuation", () => {
    const session = makeSession([{ id: "owner-a", content: "uncertain first owner", timestamp: 1, cancelable: false }]);
    session.state.isOrchestrator = true;
    const first = trackedOwner("owner-a", false);
    first.historyIncorporation = undefined;
    first.historyTrackingUnknown = true;
    const second = trackedOwner("owner-b", true);
    session.pendingCodexTurns = [first, second];
    const deps = makeDeps();
    deps.completeCodexTurn = vi.fn((target, turn) => completeCodexTurn(target, turn));

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: "result-selective-co-owner",
          codex_turn_id: "turn-terminal",
          stop_reason: "completed",
        },
        deps,
        10,
      ),
    ).toBe(true);
    expect(second.status).toBe("completed");

    expect(advanceCodexTerminalHistoryReconciliation(session, deps)).toBe(true);
    expect(session.pendingCodexTurns.some((turn) => turn.userMessageId === "owner-b")).toBe(false);
    expect(deps.injectUserMessage).toHaveBeenCalledOnce();
  });

  it("keeps restored unknown same-turn owners FIFO for separate verification continuations", () => {
    const session = makeSession([
      { id: "unknown-a", content: "unknown-a", timestamp: 1, cancelable: false },
      { id: "unknown-b", content: "unknown-b", timestamp: 2, cancelable: false },
    ]);
    const first = trackedOwner("unknown-a", false);
    const second = trackedOwner("unknown-b", false);
    for (const turn of [first, second]) {
      turn.historyIncorporation = undefined;
      turn.historyTrackingUnknown = true;
    }
    session.pendingCodexTurns = [first, second];
    const deps = makeDeps();

    expect(reconcileUnknownCodexTurnBeforeDispatch(session, first, deps)).toBe(true);
    expect(session.pendingCodexTurns.map((turn) => turn.userMessageId)).toEqual(["unknown-b"]);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "unknown-a",
      continuationMode: "verify_then_continue",
    });
    expect(deps.injectUserMessage).toHaveBeenCalledOnce();
    expect(deps.completeCodexTurn).not.toHaveBeenCalled();

    session.state.codex_turn_recovery = null;
    expect(reconcileUnknownCodexTurnBeforeDispatch(session, second, deps)).toBe(true);
    expect(session.pendingCodexTurns).toHaveLength(0);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "unknown-b",
      continuationMode: "verify_then_continue",
    });
    expect(deps.injectUserMessage).toHaveBeenCalledTimes(2);
  });

  it("drops selectively completed co-owners when the unknown head hard-stops", () => {
    const session = makeSession([{ id: "owner-a", content: "uncertain first owner", timestamp: 1, cancelable: false }]);
    const first = trackedOwner("owner-a", false);
    first.historyIncorporation = undefined;
    first.historyTrackingUnknown = true;
    const second = trackedOwner("owner-b", true);
    session.pendingCodexTurns = [first, second];
    const deps = makeDeps();
    deps.completeCodexTurn = vi.fn((target, turn) => completeCodexTurn(target, turn));

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "HTTP 401 Unauthorized",
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: "result-selective-hard-stop",
          codex_turn_id: "turn-terminal",
          stop_reason: "error",
        },
        deps,
        10,
      ),
    ).toBe(true);

    expect(session.pendingCodexTurns).toHaveLength(0);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "owner-a",
      status: "action_required",
    });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("terminalizes an active one-shot continuation whose result arrives without its receipt", () => {
    const continuation = trackedOwner("continuation-owner", false);
    continuation.turnId = "turn-continuation";
    continuation.historyIncorporation!.providerTurnId = "turn-continuation";
    const session = makeSession([
      { id: "continuation-owner", content: "recovery continuation", timestamp: 1, cancelable: false },
    ]);
    session.pendingCodexTurns = [continuation];
    session.state.codex_turn_recovery = {
      recoveryId: "original-owner",
      originalOwnerId: "original-owner",
      originalProviderTurnId: "turn-original",
      originalHistoryIndex: 0,
      continuationOwnerId: "continuation-owner",
      threadKey: "main",
      status: "continuation_active",
      reason: "interrupted_after_activity",
      historyPresence: "unknown",
      continuationMode: "verify_then_continue",
      attempt: 1,
      maxAttempts: 1,
      createdAt: 1,
      updatedAt: 2,
    };
    const deps = makeDeps();
    deps.completeCodexTurn = vi.fn((target, turn) => completeCodexTurn(target, turn));

    expect(
      completeCodexTurnsForResult(
        session,
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1,
          duration_api_ms: 1,
          num_turns: 1,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          session_id: session.id,
          uuid: "result-continuation-no-receipt",
          codex_turn_id: "turn-continuation",
          stop_reason: "completed",
        },
        deps,
        10,
      ),
    ).toBe(true);

    expect(session.pendingCodexTurns).toHaveLength(0);
    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_failed",
    });
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["recorded", true, "HTTP 401 Unauthorized"],
    ["proven absent", false, "model_not_supported: requested model is not supported"],
  ])("blocks %s resume recovery when the snapshot has a terminal error", (_label, recorded, error) => {
    const pending = trackedOwner("terminal-owner", recorded as boolean);
    const session = makeSession(
      recorded ? [] : [{ id: "terminal-owner", content: "terminal owner", timestamp: 1, cancelable: false }],
    );
    if (recorded) {
      session.messageHistory.push({
        type: "user_message",
        id: "terminal-owner",
        content: "terminal owner",
        timestamp: 1,
      });
    }
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();
    const retryPendingTurn = vi.fn();
    const receipt = pending.historyIncorporation!.clientUserMessageId;
    const snapshotTurn = {
      id: "turn-terminal",
      status: "failed",
      error,
      itemsView: "full" as const,
      items: recorded ? [{ type: "userMessage", clientId: receipt, content: [] }] : [],
    };

    expect(
      reconcileEvidenceAwareCodexResume(
        session,
        pending,
        {
          threadId: "thread",
          threadStatus: "idle",
          turnCount: 1,
          turns: [snapshotTurn],
          lastTurn: snapshotTurn,
        },
        deps,
        {
          retryPendingTurn,
          finalizeBatchHistory: vi.fn(),
          recordHistoryMilestone: vi.fn(),
        },
      ),
    ).toBe(true);

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "terminal-owner",
      status: "action_required",
      reason: "recovery_failed",
    });
    expect(retryPendingTurn).not.toHaveBeenCalled();
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("blocks a restored unknown owner when its resume snapshot has a terminal error", () => {
    const pending = trackedOwner("restored-unknown-terminal", false);
    pending.historyIncorporation = undefined;
    pending.historyTrackingUnknown = true;
    const session = makeSession([
      { id: pending.userMessageId, content: pending.userContent, timestamp: 1, cancelable: false },
    ]);
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();
    const terminalTurn = {
      id: pending.turnId!,
      status: "failed",
      error: "HTTP 401 Unauthorized",
      itemsView: "full" as const,
      items: [],
    };

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread",
        threadStatus: "idle",
        turnCount: 1,
        turns: [terminalTurn],
        lastTurn: terminalTurn,
      },
      deps,
    );

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: pending.userMessageId,
      status: "action_required",
      reason: "recovery_failed",
    });
    expect(session.pendingCodexTurns).toHaveLength(0);
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["active", "inProgress", null, "active"],
    ["terminal", "failed", "HTTP 401 Unauthorized", "idle"],
  ])("does not borrow an unrelated %s last turn for an explicit restored turn id", (_label, status, error, threadStatus) => {
    const pending = trackedOwner("restored-explicit-owner", false);
    pending.turnId = "turn-not-loaded";
    pending.historyIncorporation = undefined;
    pending.historyTrackingUnknown = true;
    const session = makeSession([
      { id: pending.userMessageId, content: pending.userContent, timestamp: 1, cancelable: false },
    ]);
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();
    const unrelated = {
      id: "turn-unrelated",
      status: status as string,
      error,
      itemsView: "full" as const,
      items: [],
    };

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread",
        threadStatus: threadStatus as string,
        turnCount: 1,
        turns: [unrelated],
        lastTurn: unrelated,
      },
      deps,
    );

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: pending.userMessageId,
      originalProviderTurnId: "turn-not-loaded",
      status: "continuation_pending",
      continuationMode: "verify_then_continue",
    });
    expect(deps.injectUserMessage).toHaveBeenCalledOnce();
  });

  it.each([
    ["duplicate receipt", "turn-terminal", 2],
    ["receipt turn mismatch", "turn-other", 1],
  ])("blocks ambiguous %s evidence when a candidate turn has a terminal error", (_label, turnId, receiptCount) => {
    const pending = trackedOwner("ambiguous-terminal-owner", false);
    const session = makeSession([
      { id: pending.userMessageId, content: pending.userContent, timestamp: 1, cancelable: false },
    ]);
    session.pendingCodexTurns = [pending];
    const deps = makeDeps();
    const retryPendingTurn = vi.fn();
    const receipt = {
      type: "userMessage",
      clientId: pending.historyIncorporation!.clientUserMessageId,
      content: [],
    };
    const terminalTurn = {
      id: turnId as string,
      status: "failed",
      error: "invalid peer certificate",
      itemsView: "full" as const,
      items: Array.from({ length: receiptCount as number }, () => ({ ...receipt })),
    };

    expect(
      reconcileEvidenceAwareCodexResume(
        session,
        pending,
        {
          threadId: "thread",
          threadStatus: "idle",
          turnCount: 1,
          turns: [terminalTurn],
          lastTurn: terminalTurn,
        },
        deps,
        { retryPendingTurn, finalizeBatchHistory: vi.fn(), recordHistoryMilestone: vi.fn() },
      ),
    ).toBe(true);

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: pending.userMessageId,
      status: "action_required",
      reason: "recovery_failed",
    });
    expect(retryPendingTurn).not.toHaveBeenCalled();
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("stages later same-turn owners as action-required when the resume error is terminal", () => {
    const first = trackedOwner("terminal-first", true);
    const second = trackedOwner("terminal-second", false);
    const session = makeSession([
      { id: "terminal-second", content: "terminal second", timestamp: 2, cancelable: false },
    ]);
    session.messageHistory.push({
      type: "user_message",
      id: "terminal-first",
      content: "terminal first",
      timestamp: 1,
    });
    session.pendingCodexTurns = [first, second];
    const deps = makeDeps();
    const retryPendingTurn = vi.fn();
    const snapshotTurn = {
      id: "turn-terminal",
      status: "failed",
      error: "invalid peer certificate",
      itemsView: "full" as const,
      items: [
        {
          type: "userMessage",
          clientId: first.historyIncorporation!.clientUserMessageId,
          content: [],
        },
      ],
    };

    expect(
      reconcileEvidenceAwareCodexResume(
        session,
        first,
        {
          threadId: "thread",
          threadStatus: "idle",
          turnCount: 1,
          turns: [snapshotTurn],
          lastTurn: snapshotTurn,
        },
        deps,
        { retryPendingTurn, finalizeBatchHistory: vi.fn(), recordHistoryMilestone: vi.fn() },
      ),
    ).toBe(true);

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "terminal-first",
      status: "action_required",
    });
    expect(session.pendingCodexTurns).toEqual([
      expect.objectContaining({
        userMessageId: "terminal-second",
        status: "recovery_pending",
        terminalHistoryReconciliation: expect.objectContaining({ action: "action_required" }),
      }),
    ]);
    expect(retryPendingTurn).not.toHaveBeenCalled();
    expect(deps.injectUserMessage).not.toHaveBeenCalled();
  });

  it("does not mutate or dispatch malformed restored history tracking", () => {
    const raw = trackedOwner("malformed-owner", false);
    raw.status = "queued";
    raw.dispatchCount = 1;
    raw.turnId = null;
    raw.acknowledgedAt = null;
    raw.historyIncorporation!.inputIds = ["wrong-owner"];
    const originalClientId = raw.historyIncorporation!.clientUserMessageId;
    const restored = normalizePersistedCodexTurn(raw, 10) as CodexOutboundTurn;
    const session = makeSession([
      { id: "malformed-owner", content: "malformed owner", timestamp: 1, cancelable: false },
    ]);
    const sendBrowserMessage = vi.fn(() => true);
    session.codexAdapter = {
      getCurrentTurnId: () => null,
      isConnected: () => true,
      sendBrowserMessage,
      disconnect: async () => {},
    };
    session.pendingCodexTurns = [restored];
    const deps = makeDeps();
    deps.completeCodexTurn = vi.fn((target, turn) => completeCodexTurn(target, turn));

    rebuildQueuedCodexPendingStartBatch(session, deps);
    expect((restored.adapterMsg as { clientUserMessageId?: string }).clientUserMessageId).toBe(originalClientId);
    expect(restored.pendingInputIds).toEqual(["malformed-owner"]);
    dispatchQueuedCodexTurns(session, "restored_unknown", deps);

    expect(sendBrowserMessage).not.toHaveBeenCalled();
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "malformed-owner",
      status: "continuation_pending",
      continuationMode: "verify_then_continue",
    });
  });

  it("does not dispatch a restored accepted turn whose persisted status was queued", () => {
    const raw = trackedOwner("restored-accepted-owner", false);
    raw.status = "queued";
    const restored = normalizePersistedCodexTurn(raw, 10) as CodexOutboundTurn;
    const session = makeSession([{ id: raw.userMessageId, content: raw.userContent, timestamp: 1, cancelable: false }]);
    const sendBrowserMessage = vi.fn(() => true);
    session.codexAdapter = {
      getCurrentTurnId: () => null,
      isConnected: () => true,
      sendBrowserMessage,
      disconnect: async () => {},
    };
    session.pendingCodexTurns = [restored];
    const deps = makeDeps();

    dispatchQueuedCodexTurns(session, "restored_accepted_turn", deps);

    expect(restored).toMatchObject({
      status: "backend_acknowledged",
      turnId: "turn-terminal",
      historyIncorporation: { rpcAcceptedAt: 2 },
    });
    expect(sendBrowserMessage).not.toHaveBeenCalled();
  });

  it("keeps reversed or independently tracked batches distinct during duplicate reconciliation", () => {
    const session = makeSession([]);
    const first = makePendingTurn();
    const firstHistory = createCodexHistoryIncorporation(["owner-a", "owner-b"]);
    first.pendingInputIds = ["owner-a", "owner-b"];
    first.userMessageId = "owner-a";
    first.historyIncorporation = firstHistory;
    first.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: [...first.pendingInputIds],
      inputs: [{ content: "a" }, { content: "b" }],
      clientUserMessageId: firstHistory.clientUserMessageId,
    };
    const reversed = structuredClone(first);
    const reversedHistory = createCodexHistoryIncorporation(["owner-b", "owner-a"]);
    reversed.pendingInputIds = ["owner-b", "owner-a"];
    reversed.userMessageId = "owner-b";
    reversed.historyIncorporation = reversedHistory;
    reversed.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: [...reversed.pendingInputIds],
      inputs: [{ content: "b" }, { content: "a" }],
      clientUserMessageId: reversedHistory.clientUserMessageId,
    };
    const independent = structuredClone(first);
    const independentHistory = createCodexHistoryIncorporation(["owner-a", "owner-b"]);
    independent.historyIncorporation = independentHistory;
    independent.adapterMsg = {
      ...independent.adapterMsg,
      clientUserMessageId: independentHistory.clientUserMessageId,
    } as any;
    session.pendingCodexTurns = [first, reversed, independent];
    const deps = makeDeps();

    expect(reconcileDuplicateCodexPendingTurns(session, "test", deps)).toBe(0);
    expect(session.pendingCodexTurns).toHaveLength(3);

    const exact = structuredClone(first);
    exact.requiresFreshSuccessor = true;
    session.pendingCodexTurns.push(exact);
    expect(reconcileDuplicateCodexPendingTurns(session, "test-exact", deps)).toBe(1);
    expect(session.pendingCodexTurns).toHaveLength(3);
    expect(
      session.pendingCodexTurns.find((turn) => turn.historyIncorporation?.batchId === firstHistory.batchId),
    ).toMatchObject({ requiresFreshSuccessor: true });
  });
});
