import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CLIResultMessage, CodexOutboundTurn } from "../session-types.js";
import {
  beginCodexTurnRecoveryContinuation,
  hasIncompleteCodexActivityWithoutTerminalEvidence,
  isRecoveryContinuationTurn,
  markCodexTurnRecoveryActionRequired,
  markCodexTurnRecoveryContinuationActive,
  markCodexTurnRecoveryOnDisconnect,
  normalizeCodexTurnRecoveryState,
  repairRestoredCodexTurnRecoveryState,
  resolveCodexTurnRecoveryAction,
  resolveCodexTurnRecoveryRoute,
  settleCodexTurnRecoveryFromResult,
  type CodexInterruptedTurnRecoverySessionLike,
} from "./codex-interrupted-turn-recovery.js";

function result(overrides: Partial<CLIResultMessage> = {}): CLIResultMessage {
  return {
    type: "result",
    subtype: "success",
    is_error: false,
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    session_id: "session",
    uuid: "result",
    stop_reason: "completed",
    ...overrides,
  };
}

function makeSession(): CodexInterruptedTurnRecoverySessionLike {
  const user: BrowserIncomingMessage = {
    type: "user_message",
    id: "original-owner",
    content: "Investigate and finish the task",
    timestamp: 1,
    threadKey: "q-1987",
    questId: "q-1987",
  };
  return {
    id: "session",
    attentionReason: null,
    isGenerating: false,
    queuedTurnStarts: 0,
    queuedTurnReasons: [],
    queuedTurnUserMessageIds: [],
    queuedTurnInterruptSources: [],
    queuedTurnActiveRoutes: [],
    sessionNum: 42,
    state: { backend_state: "connected", isOrchestrator: true, codex_turn_recovery: null },
    messageHistory: [user],
    pendingCodexInputs: [],
    pendingCodexTurns: [],
  };
}

function turn(overrides: Partial<CodexOutboundTurn> = {}): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["original-owner"], inputs: [{ content: "task" }] },
    userMessageId: "original-owner",
    pendingInputIds: ["original-owner"],
    userContent: "task",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "provider-turn",
    disconnectedAt: 3,
    resumeConfirmedAt: 4,
    ...overrides,
  };
}

function deps(session: CodexInterruptedTurnRecoverySessionLike) {
  const broadcastToBrowsers = vi.fn();
  const persistSession = vi.fn();
  const setAttentionError = vi.fn();
  const injectUserMessage = vi.fn(
    (_: string, __: string, agentSource: { sessionId: string }, ___: unknown, ____: { deliveryContent: string }) => {
      session.pendingCodexInputs.push({
        id: "continuation-owner",
        content: "visible recovery",
        timestamp: 5,
        cancelable: true,
        agentSource,
        threadKey: "q-1987",
        questId: "q-1987",
      });
      return "sent" as const;
    },
  );
  return { broadcastToBrowsers, persistSession, setAttentionError, injectUserMessage };
}

describe("Codex interrupted turn recovery classification", () => {
  it("treats an interrupted idle tool-only resume with omitted tools as incomplete", () => {
    const interrupted = {
      id: "provider-turn",
      status: "interrupted",
      error: null,
      items: [
        { type: "userMessage", content: [{ type: "text", text: "task" }] },
        { type: "reasoning", summary: ["working"] },
      ],
    };
    expect(
      hasIncompleteCodexActivityWithoutTerminalEvidence(
        interrupted,
        "idle",
        { count: 4, kinds: ["reasoning", "tool_use", "tool_result"], firstHistoryIndex: 1, lastHistoryIndex: 4 },
        3,
      ),
    ).toBe(true);
  });

  it("treats completed or failed tool-only snapshots without final prose as incomplete", () => {
    const toolOnly = {
      id: "provider-turn",
      status: "completed",
      error: null,
      items: [
        { type: "userMessage", content: [{ type: "text", text: "task" }] },
        { type: "functionCall", id: "call-1", status: "completed", name: "exec_command" },
      ],
    };
    const activity = { count: 1, kinds: ["tool_use"], firstHistoryIndex: 1, lastHistoryIndex: 1 } as any;
    expect(hasIncompleteCodexActivityWithoutTerminalEvidence(toolOnly, "idle", activity, 0)).toBe(true);
    expect(
      hasIncompleteCodexActivityWithoutTerminalEvidence(
        {
          ...toolOnly,
          items: [...toolOnly.items, { type: "agentMessage", id: "final", text: "Finished." }],
        },
        "idle",
        activity,
        0,
      ),
    ).toBe(false);
    expect(
      hasIncompleteCodexActivityWithoutTerminalEvidence({ ...toolOnly, status: "failed" }, "idle", activity, 0),
    ).toBe(true);
  });

  it("does not broaden reasoning-only or terminal recovery", () => {
    const interrupted = {
      id: "provider-turn",
      status: "interrupted",
      error: null,
      items: [{ type: "reasoning", summary: ["working"] }],
    };
    const reasoningOnly = { count: 1, kinds: ["reasoning"], firstHistoryIndex: 1, lastHistoryIndex: 1 };
    expect(hasIncompleteCodexActivityWithoutTerminalEvidence(interrupted, "idle", reasoningOnly as any, 0)).toBe(false);
    expect(hasIncompleteCodexActivityWithoutTerminalEvidence(interrupted, "idle", reasoningOnly as any, 0, true)).toBe(
      true,
    );
    expect(
      hasIncompleteCodexActivityWithoutTerminalEvidence(
        { ...interrupted, items: [...interrupted.items, { type: "result" }] },
        "idle",
        reasoningOnly as any,
        1,
      ),
    ).toBe(false);
  });
});

describe("Codex interrupted turn recovery state", () => {
  it("queues one separately owned routed continuation and clears only on its success", () => {
    const session = makeSession();
    const original = turn();
    const recoveryDeps = deps(session);

    expect(
      beginCodexTurnRecoveryContinuation(session, original, { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps),
    ).toBe(true);
    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(recoveryDeps.injectUserMessage.mock.calls[0]?.[4]?.deliveryContent).toContain(
      "original user payload was already delivered",
    );
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "original-owner",
      continuationOwnerId: "continuation-owner",
      threadKey: "q-1987",
      status: "continuation_pending",
      attempt: 1,
      maxAttempts: 1,
    });

    const continuation = turn({
      userMessageId: "continuation-owner",
      pendingInputIds: ["continuation-owner"],
      historyIndex: 1,
      turnId: "continuation-turn",
    });
    session.messageHistory.push({
      type: "user_message",
      id: "continuation-owner",
      content: "visible recovery",
      timestamp: 5,
      threadKey: "q-1987",
      questId: "q-1987",
      agentSource: {
        sessionId: `system:codex-turn-recovery:${session.state.codex_turn_recovery?.recoveryId}`,
      },
    });
    markCodexTurnRecoveryContinuationActive(session, continuation, recoveryDeps);
    expect(session.state.codex_turn_recovery?.status).toBe("continuation_active");

    settleCodexTurnRecoveryFromResult(session, [continuation], result(), recoveryDeps);
    expect(session.state.codex_turn_recovery).toBeNull();
  });

  it("fails closed after the one continuation is interrupted instead of recursively injecting", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    const continuation = turn({ userMessageId: "continuation-owner", historyIndex: 1, turnId: "continuation-turn" });
    session.messageHistory.push({
      type: "user_message",
      id: "continuation-owner",
      content: "visible recovery",
      timestamp: 5,
      agentSource: {
        sessionId: `system:codex-turn-recovery:${session.state.codex_turn_recovery?.recoveryId}`,
      },
      threadKey: "q-1987",
      questId: "q-1987",
    });
    markCodexTurnRecoveryOnDisconnect(session, continuation, recoveryDeps);
    expect(session.state.codex_turn_recovery?.status).toBe("recovering");

    expect(
      beginCodexTurnRecoveryContinuation(
        session,
        continuation,
        { threadKey: "q-1987", questId: "q-1987" },
        recoveryDeps,
      ),
    ).toBe(false);
    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.state.codex_turn_recovery?.status).toBe("action_required");
    expect(session.state.codex_turn_recovery?.reason).toBe("continuation_interrupted");
    expect(recoveryDeps.setAttentionError).toHaveBeenCalledTimes(1);
  });

  it("fails original-owner results closed and honors canonical interruption for continuation results", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    const original = turn();
    session.messageHistory.push({
      type: "assistant",
      message: {
        id: "original-tool",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo done" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 2,
    });
    session.pendingCodexTurns = [original];
    markCodexTurnRecoveryOnDisconnect(session, original, recoveryDeps);

    settleCodexTurnRecoveryFromResult(
      session,
      [original],
      result({ is_error: true, subtype: "error_during_execution" }),
      recoveryDeps,
    );
    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "recovery_failed",
    });

    const interruptedSession = makeSession();
    const interruptedDeps = deps(interruptedSession);
    beginCodexTurnRecoveryContinuation(
      interruptedSession,
      turn(),
      { threadKey: "q-1987", questId: "q-1987" },
      interruptedDeps,
    );
    const continuation = turn({
      userMessageId: "continuation-owner",
      pendingInputIds: ["continuation-owner"],
      historyIndex: 1,
      turnId: "continuation-turn",
    });
    interruptedSession.messageHistory.push({
      type: "user_message",
      id: "continuation-owner",
      content: "visible recovery",
      timestamp: 5,
      agentSource: {
        sessionId: `system:codex-turn-recovery:${interruptedSession.state.codex_turn_recovery?.recoveryId}`,
      },
    });
    settleCodexTurnRecoveryFromResult(interruptedSession, [continuation], result(), interruptedDeps, true);
    expect(interruptedSession.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_interrupted",
    });
  });

  it("selects the direct human co-owner and preserves its original route", () => {
    const session = makeSession();
    session.messageHistory = [
      {
        type: "user_message",
        id: "herd-owner",
        content: "automatic work",
        timestamp: 1,
        agentSource: { sessionId: "herd-events" },
        threadKey: "main",
      },
      {
        type: "user_message",
        id: "human-owner",
        content: "direct correction",
        timestamp: 2,
        threadKey: "q-9010",
        questId: "q-9010",
      },
      {
        type: "assistant",
        message: {
          id: "tool-after-human",
          type: "message",
          role: "assistant",
          model: "gpt-5.6-sol",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo done" } }],
          stop_reason: "tool_use",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 3,
      },
    ];
    const automatic = turn({ userMessageId: "herd-owner", pendingInputIds: ["herd-owner"], historyIndex: 0 });
    const human = turn({ userMessageId: "human-owner", pendingInputIds: ["human-owner"], historyIndex: 1 });
    session.pendingCodexTurns = [automatic, human];
    const recoveryDeps = deps(session);

    markCodexTurnRecoveryOnDisconnect(session, automatic, recoveryDeps);

    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "human-owner",
      originalProviderTurnId: "provider-turn",
      threadKey: "q-9010",
      questId: "q-9010",
    });
    expect(resolveCodexTurnRecoveryRoute(session, human, { threadKey: "q-9999", questId: "q-9999" })).toMatchObject({
      threadKey: "q-9010",
      questId: "q-9010",
    });
  });

  it("does not queue automatic continuation behind later work or while delivery is paused", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    session.pendingCodexTurns = [turn({ userMessageId: "later", pendingInputIds: ["later"], turnId: null })];
    expect(
      beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps),
    ).toBe(false);
    expect(recoveryDeps.injectUserMessage).not.toHaveBeenCalled();
    expect(session.pendingCodexTurns.map((pending) => pending.userMessageId)).toEqual(["later"]);
    expect(session.state.codex_turn_recovery).toMatchObject({ status: "action_required" });

    const paused = makeSession();
    paused.state.pause = { pausedAt: 10, queuedMessages: [] };
    const pausedDeps = deps(paused);
    expect(
      beginCodexTurnRecoveryContinuation(paused, turn(), { threadKey: "q-1987", questId: "q-1987" }, pausedDeps),
    ).toBe(false);
    expect(pausedDeps.injectUserMessage).not.toHaveBeenCalled();
    expect(paused.state.codex_turn_recovery).toMatchObject({ status: "action_required" });
  });

  it("dedupes an already queued continuation and fails closed across an orphaned crash window", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    expect(
      beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps),
    ).toBe(true);
    expect(
      beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps),
    ).toBe(true);
    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);

    session.pendingCodexInputs = [];
    expect(
      beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps),
    ).toBe(false);
    expect(recoveryDeps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_dispatch_failed",
    });
  });

  it("retires live recovery owners and ignores a late original success after continuation began", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    const original = turn();
    beginCodexTurnRecoveryContinuation(session, original, { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    session.pendingCodexTurns = [
      turn({
        userMessageId: "continuation-owner",
        pendingInputIds: ["continuation-owner"],
        historyIndex: 1,
        turnId: "continuation-turn",
      }),
    ];

    settleCodexTurnRecoveryFromResult(session, [original], result(), recoveryDeps);
    expect(session.state.codex_turn_recovery).not.toBeNull();

    markCodexTurnRecoveryActionRequired(session, "continuation_failed", recoveryDeps);
    expect(session.pendingCodexTurns).toHaveLength(0);
    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.state.codex_turn_recovery).toMatchObject({ status: "action_required" });
  });

  it("repairs restored continuation ownership or converts an ownerless state to action required", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    const repaired = repairRestoredCodexTurnRecoveryState(session);
    expect(repaired).toMatchObject({ continuationOwnerId: "continuation-owner", status: "continuation_pending" });

    session.pendingCodexInputs = [];
    session.pendingCodexTurns = [];
    expect(repairRestoredCodexTurnRecoveryState(session)).toMatchObject({
      status: "action_required",
      reason: "continuation_dispatch_failed",
    });
  });

  it.each([
    "error",
    "review",
    "action",
  ] as const)("does not clear unrelated pre-existing %s attention on explicit resolution", (attentionReason) => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    session.attentionReason = attentionReason;
    markCodexTurnRecoveryActionRequired(session, "continuation_failed", recoveryDeps);
    expect(session.state.codex_turn_recovery?.raisedAttention).toBe(false);
    expect(recoveryDeps.setAttentionError).not.toHaveBeenCalled();

    expect(resolveCodexTurnRecoveryAction(session, "original-owner", recoveryDeps)).toBe(true);
    expect(session.attentionReason).toBe(attentionReason);
  });

  it("clears action-required recovery only through its exact explicit resolution id", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    session.state.codex_turn_recovery = {
      ...session.state.codex_turn_recovery!,
      status: "action_required",
      reason: "continuation_interrupted",
    };

    expect(resolveCodexTurnRecoveryAction(session, "wrong-owner", recoveryDeps)).toBe(false);
    expect(session.state.codex_turn_recovery).not.toBeNull();
    expect(resolveCodexTurnRecoveryAction(session, "original-owner", recoveryDeps)).toBe(true);
    expect(session.state.codex_turn_recovery).toBeNull();
  });

  it("does not let an unrelated compaction continuation revive action-required recovery", () => {
    const session = makeSession();
    const recoveryDeps = deps(session);
    beginCodexTurnRecoveryContinuation(session, turn(), { threadKey: "q-1987", questId: "q-1987" }, recoveryDeps);
    markCodexTurnRecoveryActionRequired(session, "continuation_failed", recoveryDeps);
    session.messageHistory.push({
      type: "user_message",
      id: "later-compaction",
      content: "ordinary later compaction recovery",
      timestamp: 10,
      agentSource: { sessionId: "system:compaction-recovery" },
    });
    const unrelated = turn({
      userMessageId: "later-compaction",
      pendingInputIds: ["later-compaction"],
      historyIndex: 1,
      turnId: "later-compaction-turn",
    });

    expect(isRecoveryContinuationTurn(session, unrelated)).toBe(false);
    settleCodexTurnRecoveryFromResult(session, [unrelated], result(), recoveryDeps);
    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_failed",
    });
  });

  it("normalizes payload-free persisted state and rejects malformed records", () => {
    expect(normalizeCodexTurnRecoveryState({ status: "recovering" })).toBeNull();
    expect(
      normalizeCodexTurnRecoveryState({
        recoveryId: "owner",
        originalOwnerId: "owner",
        originalProviderTurnId: "turn",
        originalHistoryIndex: 7,
        continuationOwnerId: null,
        threadKey: "main",
        status: "continuation_pending",
        reason: "interrupted_after_activity",
        attempt: 2,
        maxAttempts: 1,
        createdAt: 10,
        updatedAt: 20,
      }),
    ).toMatchObject({ status: "action_required", reason: "recovery_failed", attempt: 1 });
    expect(
      normalizeCodexTurnRecoveryState({
        recoveryId: "owner",
        originalOwnerId: "owner",
        originalProviderTurnId: "turn",
        originalHistoryIndex: 7,
        continuationOwnerId: null,
        threadKey: "main",
        status: "action_required",
        reason: "recovery_timeout",
        attempt: 1,
        maxAttempts: 1,
        createdAt: 10,
        updatedAt: 20,
      }),
    ).toMatchObject({ recoveryId: "owner", status: "action_required", reason: "recovery_timeout" });
  });
});
