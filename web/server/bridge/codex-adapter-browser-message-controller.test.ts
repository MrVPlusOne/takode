import { describe, expect, it, vi } from "vitest";
import {
  handleCodexAdapterBrowserMessage,
  isCodexContextWindowExhaustionMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ActiveTurnRoute, BrowserIncomingMessage, ContentBlock, SessionNotification } from "../session-types.js";

type TestCodexSession = {
  id: string;
  state: any;
  messageHistory: BrowserIncomingMessage[];
  toolStartTimes: Map<string, number>;
  toolProgressOutput: Map<string, string>;
  isGenerating: boolean;
  activeTurnRoute: ActiveTurnRoute | null;
  notifications: SessionNotification[];
  notificationCounter: number;
  attentionReason: "action" | "error" | "review" | null;
  lastCliMessageAt?: number;
  compactedDuringTurn?: boolean;
  codexModelSwitchCompactionGuard?: {
    previousModel?: string;
    nextModel: string;
    createdAt: number;
    expiresAt: number;
  } | null;
  codexSuppressRecoveryForCurrentCompaction?: boolean;
};

function makeSession(): TestCodexSession {
  return {
    id: "codex-leader",
    state: { isOrchestrator: true, backend_type: "codex" },
    messageHistory: [],
    toolStartTimes: new Map(),
    toolProgressOutput: new Map(),
    isGenerating: false,
    activeTurnRoute: null,
    notifications: [],
    notificationCounter: 0,
    attentionReason: null,
  };
}

function makeAssistant(
  content: ContentBlock[],
  id = `codex-${Math.random().toString(36).slice(2)}`,
): BrowserIncomingMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    timestamp: 1,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.5",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  };
}

function makeResult(id: string, numTurns = 1, stopReason = "end_turn"): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "success",
      is_error: false,
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: numTurns,
      total_cost_usd: 0,
      stop_reason: stopReason,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: id,
      session_id: "codex-leader",
    },
  };
}

function attachDeliveredRecovery(session: TestCodexSession) {
  const summaryId = "recovery-summary";
  const groupId = "held-group";
  session.messageHistory.push({
    type: "codex_auto_pause_recovery_summary",
    id: summaryId,
    timestamp: 1,
    content: "Automatic input recovery: 1 delivered.",
    searchText: "automatic input recovery outcome:delivered completion:pending",
    recovery: {
      family: "copilot_auth_refresh_exhausted",
      pausedAt: 1,
      recoveryConfirmedAt: 2,
      updatedAt: 3,
      status: "settled",
      receipts: [
        {
          groupId,
          source: "programmatic",
          sourceLabel: "Herd Events",
          count: 1,
          coalescedCount: 0,
          queuedAt: 1,
          lastQueuedAt: 1,
          releasedAt: 2,
          terminalAt: 3,
          outcome: "delivered",
          reasonCode: "codex_delivery_accepted",
          reason: "Accepted by Codex exactly once.",
        },
      ],
    },
  });
  (session as any).pendingCodexTurns = [
    {
      autoPauseRecoveryLinks: [{ summaryId, groupId }],
      dispatchCount: 1,
    },
  ];
  return session.messageHistory[0] as Extract<BrowserIncomingMessage, { type: "codex_auto_pause_recovery_summary" }>;
}

function makeThreadStatus({
  kind = "waiting",
  threadKey,
  summary = kind === "waiting" ? "waiting on reviewer" : "ready for review",
  messageId = "old-status",
  timestamp = 10,
}: {
  kind?: LeaderThreadStatus["kind"];
  threadKey: string;
  summary?: string;
  messageId?: string;
  timestamp?: number;
}): LeaderThreadStatus {
  return {
    kind,
    label: kind === "waiting" ? "Thread Waiting" : "Thread Ready",
    threadKey,
    ...(threadKey !== "main" ? { questId: threadKey } : {}),
    summary,
    messageId,
    timestamp,
    updatedAt: timestamp,
  };
}

function makeDeps(broadcasts: BrowserIncomingMessage[]): CodexAdapterBrowserMessageDeps {
  return {
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
    broadcastToBrowsers: (_session, msg) => broadcasts.push(msg),
    finalizeSupersededCodexTerminalTools: vi.fn(),
    isDuplicateCodexAssistantReplay: () => false,
    completeCodexTurnsForResult: vi.fn(() => true),
    clearCodexFreshTurnRequirement: vi.fn(),
    handleResultMessage: vi.fn(),
    queueCodexPendingStartBatch: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    handleCodexPermissionRequest: vi.fn(),
    requestCodexLeaderRecycle: vi.fn(async () => ({ ok: true })),
    handleCodexResultErrorAutoPause: vi.fn(),
  };
}

async function routeAssistantMessage(
  session: TestCodexSession,
  content: ContentBlock[],
  depsOverride: Partial<CodexAdapterBrowserMessageDeps> = {},
): Promise<BrowserIncomingMessage> {
  const broadcasts: BrowserIncomingMessage[] = [];
  await handleCodexAdapterBrowserMessage(session, makeAssistant(content), { ...makeDeps(broadcasts), ...depsOverride });
  expect(broadcasts).toHaveLength(1);
  return broadcasts[0];
}

describe("codex-adapter-browser-message-controller thread routing", () => {
  it.each([
    "interrupted",
    "cancel",
    "cancelled",
    "canceled",
    "user_cancelled",
  ])("derives canonical interruption from producer stop_reason=%s before completion and auto-pause", async (stopReason) => {
    // Codex emits an ordinary result wrapper; interruption lives in data.stop_reason, not a synthetic top-level flag.
    const session = makeSession();
    const summary = attachDeliveredRecovery(session);
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, makeResult(`result-${stopReason}`, 1, stopReason), deps);

    expect(deps.handleCodexResultErrorAutoPause).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ stop_reason: stopReason }),
      expect.anything(),
      true,
    );
    expect(summary.recovery.receipts[0]).toMatchObject({
      outcome: "delivered",
      reasonCode: "codex_delivery_accepted",
      terminalAt: 3,
      finalizedAt: expect.any(Number),
      finalityReason: "turn_interrupted_or_cancelled",
    });
    expect(summary.recovery.receipts[0]?.completedAt).toBeUndefined();
    expect(summary.recovery.receipts[0]?.recovered).toBeUndefined();
    expect(summary.recovery.receipts[0]?.completionError).toBeUndefined();
    expect(summary.searchText).toContain("completion:interrupted_or_cancelled");
    expect(summary.searchText).toContain("finality_reason:turn_interrupted_or_cancelled");
    expect(broadcasts).toEqual([summary]);
    expect(deps.freezeHistoryThroughCurrentTail).toHaveBeenCalledWith(session);

    const finalizedAt = summary.recovery.receipts[0]?.finalizedAt;
    await handleCodexAdapterBrowserMessage(session, makeResult(`replayed-${stopReason}`, 1, stopReason), deps);
    expect(summary.recovery.receipts[0]?.finalizedAt).toBe(finalizedAt);
    expect(broadcasts).toEqual([summary]);
    expect(deps.freezeHistoryThroughCurrentTail).toHaveBeenCalledTimes(1);
  });

  it.each([
    "explicit",
    "session",
  ] as const)("finalizes delivered recovery links for %s interruption without claiming completion", async (source) => {
    const session = makeSession();
    const summary = attachDeliveredRecovery(session);
    const result = makeResult(`result-${source}`);
    if (source === "explicit") (result as any).interrupted = true;
    else (session as any).interruptedDuringTurn = true;
    const deps = makeDeps([]);

    await handleCodexAdapterBrowserMessage(session, result, deps);

    expect(summary.recovery.receipts[0]).toMatchObject({
      outcome: "delivered",
      reasonCode: "codex_delivery_accepted",
      finalityReason: "turn_interrupted_or_cancelled",
      finalizedAt: expect.any(Number),
    });
    expect(summary.recovery.receipts[0]?.completedAt).toBeUndefined();
    expect(summary.recovery.receipts[0]?.recovered).toBeUndefined();
  });

  it("allows a normal producer-shaped successful manual result to complete delivery and auto-pause recovery", async () => {
    const session = makeSession();
    const summary = attachDeliveredRecovery(session);
    const deps = makeDeps([]);

    await handleCodexAdapterBrowserMessage(session, makeResult("result-success"), deps);

    expect(deps.handleCodexResultErrorAutoPause).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ stop_reason: "end_turn" }),
      expect.anything(),
      false,
    );
    expect(summary.recovery.receipts[0]).toMatchObject({
      reasonCode: "codex_delivery_completed",
      completedAt: expect.any(Number),
    });
    expect(summary.recovery.receipts[0]?.finalizedAt).toBeUndefined();
    expect(deps.freezeHistoryThroughCurrentTail).not.toHaveBeenCalled();
  });

  it("records live streamed activity breadcrumbs for hidden delegate children", async () => {
    const session = makeSession() as TestCodexSession & {
      delegateLiveActivity?: { kind: string; label: string; text: string; status: string };
    };
    session.state.delegateChild = {
      parentSessionId: "parent",
      delegateId: "del_live123",
      task: "Probe inherited context",
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: "I cannot know the sentinel" } },
        parent_tool_use_id: null,
      },
      deps,
    );
    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "stream_event",
        event: { type: "content_block_delta", delta: { type: "text_delta", text: " without inherited context." } },
        parent_tool_use_id: null,
      },
      deps,
    );

    expect(session.delegateLiveActivity).toMatchObject({
      kind: "assistant",
      label: "Assistant",
      text: "I cannot know the sentinel without inherited context.",
      status: "running",
    });
    expect(broadcasts.filter((msg) => msg.type === "stream_event")).toHaveLength(2);
  });

  it("clears launcher service tier when adapter fallback updates Codex service tier to Standard", async () => {
    // A rejected Fast tier is cleared by the adapter through session_update.
    // The bridge must also clear launcher state, or a later Codex relaunch can
    // reconstruct the adapter with the rejected Fast tier again.
    const session = makeSession();
    session.state.codex_service_tier = "priority";
    const launcherInfo = { codexServiceTier: "priority" as string | null };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = {
      ...makeDeps(broadcasts),
      getLauncherSessionInfo: vi.fn(() => launcherInfo),
    };

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_update",
        session: { codex_service_tier: null },
      },
      deps,
    );

    expect(session.state.codex_service_tier).toBeNull();
    expect(launcherInfo.codexServiceTier).toBeNull();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual({
      type: "session_update",
      session: expect.objectContaining({ codex_service_tier: null }),
    });
  });

  it("preserves history-derived turn metrics across Codex session init reconnect patches", async () => {
    // Codex init/reconnect sends zeroed session metrics; a long restored
    // session must keep the backend-owned counts derived from messageHistory.
    const session = makeSession();
    session.messageHistory.push(
      { type: "user_message", id: "u1", content: "first", timestamp: 1 } as BrowserIncomingMessage,
      makeAssistant([{ type: "text", text: "done 1" }], "a1"),
      makeResult("r1", 1),
      {
        type: "user_message",
        id: "timer-1",
        content: "timer",
        timestamp: 2,
        agentSource: { sessionId: "timer", sessionLabel: "Timer" },
      } as BrowserIncomingMessage,
      { type: "user_message", id: "u2", content: "second", timestamp: 3 } as BrowserIncomingMessage,
      makeAssistant([{ type: "text", text: "done 2" }], "a2"),
      makeResult("r2", 1),
    );
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_init",
        session: {
          backend_type: "codex",
          model: "gpt-5.5",
          user_turn_count: 0,
          agent_turn_count: 0,
          num_turns: 0,
        },
      } as BrowserIncomingMessage,
      deps,
    );

    expect(session.state).toMatchObject({
      backend_type: "codex",
      user_turn_count: 2,
      agent_turn_count: 2,
      num_turns: 2,
    });
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        type: "session_init",
        session: expect.objectContaining({
          user_turn_count: 2,
          agent_turn_count: 2,
          num_turns: 2,
        }),
      }),
    );
  });

  it("uses the leader recycle budget for displayed Codex context stats", async () => {
    // Codex leaders run with a larger provider envelope underneath. Browser
    // state should still display Takode's recycle budget so users see when
    // Takode will recycle the leader, not Codex's hidden provider window.
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = {
      ...makeDeps(broadcasts),
      getLauncherSessionInfo: vi.fn(() => ({
        isOrchestrator: true,
        codexLeaderRecycleThresholdTokens: 545_000,
      })),
    };

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_update",
        session: {
          context_used_percent: 18,
          codex_token_details: {
            contextTokensUsed: 518_366,
            inputTokens: 10,
            outputTokens: 20,
            cachedInputTokens: 30,
            reasoningOutputTokens: 40,
            modelContextWindow: 3_027_778,
          },
        },
      },
      deps,
    );

    expect(session.state.context_used_percent).toBe(95);
    expect(session.state.codex_token_details).toMatchObject({
      contextTokensUsed: 518_366,
      inputTokens: 10,
      outputTokens: 20,
      cachedInputTokens: 30,
      reasoningOutputTokens: 40,
      modelContextWindow: 545_000,
    });
    expect(deps.requestCodexLeaderRecycle).not.toHaveBeenCalled();
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        type: "session_update",
        session: expect.objectContaining({
          context_used_percent: 95,
          codex_leader_recycle_threshold_tokens: 545_000,
          codex_token_details: expect.objectContaining({
            contextTokensUsed: 518_366,
            modelContextWindow: 545_000,
          }),
        }),
      }),
    );
  });

  it("does not let an older higher-budget threshold recycle suppress a lower-budget model-switch recycle", async () => {
    // Repro shape from a GPT-5.5 -> GPT-5.6 leader switch:
    // the previous threshold recycle happened at ~555K under a 545K leader
    // budget, but the new model's leader budget is 328.4K. A 415K resumed
    // context must recycle even though it is below the old watermark.
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = {
      ...makeDeps(broadcasts),
      getLauncherSessionInfo: vi.fn(() => ({
        isOrchestrator: true,
        codexLeaderRecycleThresholdTokens: 328_400,
        codexLeaderRecycleLineage: {
          recycleEvents: [
            {
              trigger: "threshold" as const,
              tokenUsage: {
                contextTokensUsed: 554_916,
                modelContextWindow: 545_000,
              },
            },
          ],
        },
      })),
    };

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_update",
        session: {
          codex_token_details: {
            contextTokensUsed: 415_409,
            inputTokens: 68_455_353,
            outputTokens: 91_418,
            cachedInputTokens: 63_792_128,
            reasoningOutputTokens: 19_634,
            modelContextWindow: 2_876_389,
          },
        },
      },
      deps,
    );

    expect(deps.requestCodexLeaderRecycle).toHaveBeenCalledWith(session, "threshold");
    expect(session.state.context_used_percent).toBe(100);
    expect(session.state.codex_token_details).toMatchObject({
      contextTokensUsed: 415_409,
      modelContextWindow: 328_400,
    });
  });

  it("keeps suppressing repeated threshold recycles for the same leader budget", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = {
      ...makeDeps(broadcasts),
      getLauncherSessionInfo: vi.fn(() => ({
        isOrchestrator: true,
        codexLeaderRecycleThresholdTokens: 545_000,
        codexLeaderRecycleLineage: {
          recycleEvents: [
            {
              trigger: "threshold" as const,
              tokenUsage: {
                contextTokensUsed: 554_916,
                modelContextWindow: 545_000,
              },
            },
          ],
        },
      })),
    };

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_update",
        session: {
          codex_token_details: {
            contextTokensUsed: 550_000,
            inputTokens: 68_455_353,
            outputTokens: 91_418,
            cachedInputTokens: 63_792_128,
            reasoningOutputTokens: 19_634,
            modelContextWindow: 2_876_389,
          },
        },
      },
      deps,
    );

    expect(deps.requestCodexLeaderRecycle).not.toHaveBeenCalled();
  });

  it("does not rewrite non-leader Codex context stats", async () => {
    const session = makeSession();
    session.state.isOrchestrator = false;
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = {
      ...makeDeps(broadcasts),
      getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: false })),
    };

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "session_update",
        session: {
          context_used_percent: 18,
          codex_token_details: {
            contextTokensUsed: 518_366,
            inputTokens: 10,
            outputTokens: 20,
            cachedInputTokens: 30,
            reasoningOutputTokens: 40,
            modelContextWindow: 3_027_778,
          },
        },
      },
      deps,
    );

    expect(session.state.context_used_percent).toBe(18);
    expect(session.state.codex_token_details.modelContextWindow).toBe(3_027_778);
  });

  it("detects only the scoped Codex context-window exhaustion wording", () => {
    expect(
      isCodexContextWindowExhaustionMessage(
        "Error: Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      ),
    ).toBe(true);
    expect(isCodexContextWindowExhaustionMessage("Rate limit exceeded")).toBe(false);
    expect(isCodexContextWindowExhaustionMessage("Claude ran out of room in the model's context window.")).toBe(false);
  });

  it("recycles Codex leaders for context-window exhaustion errors without broadcasting the backend error text", async () => {
    // Codex may surface backend context exhaustion as a top-level error before
    // Takode sees a token-usage update; leaders should recycle instead of
    // repeatedly showing that backend instruction to users.
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "error",
        message:
          "Error: Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      },
      deps,
    );

    expect(deps.requestCodexLeaderRecycle).toHaveBeenCalledWith(session, "context_window_exhausted");
    expect(broadcasts).toHaveLength(0);
  });

  it("recycles Codex leaders for failed context-window exhaustion results without running normal result handling", async () => {
    // Some Codex builds report the same failure as the terminal turn result.
    // Suppressing result handling prevents the failed result from becoming a
    // user-visible error bubble while the recycle path takes over.
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    const result = {
      type: "result",
      data: {
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        result:
          "Error: Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 1,
        total_cost_usd: 0,
        stop_reason: "failed",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        uuid: "result-context-window",
        session_id: session.id,
      },
    } as BrowserIncomingMessage;

    await handleCodexAdapterBrowserMessage(session, result, deps);

    expect(deps.requestCodexLeaderRecycle).toHaveBeenCalledWith(session, "context_window_exhausted");
    expect(deps.handleResultMessage).not.toHaveBeenCalled();
    expect(deps.completeCodexTurnsForResult).not.toHaveBeenCalled();
    expect(broadcasts).toHaveLength(0);
  });

  it("keeps unrelated Codex backend errors user-visible", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, { type: "error", message: "Rate limit exceeded" }, deps);

    expect(deps.requestCodexLeaderRecycle).not.toHaveBeenCalled();
    expect(broadcasts).toEqual([{ type: "error", message: "Rate limit exceeded" }]);
  });

  it("does not recycle non-leader Codex sessions for context-window exhaustion errors", async () => {
    const session = makeSession();
    session.state.isOrchestrator = false;
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    const message =
      "Error: Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.";

    await handleCodexAdapterBrowserMessage(session, { type: "error", message }, deps);

    expect(deps.requestCodexLeaderRecycle).not.toHaveBeenCalled();
    expect(broadcasts).toEqual([{ type: "error", message }]);
  });

  it("records and broadcasts Codex compaction lifecycle events from status changes", async () => {
    // Codex surfaces compaction through item lifecycle status changes; the
    // bridge should persist lifecycle telemetry without relying on chat history.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 90,
      codex_token_details: {
        contextTokensUsed: 270_000,
        inputTokens: 300_000,
        outputTokens: 10_000,
        cachedInputTokens: 30_000,
        reasoningOutputTokens: 5_000,
        modelContextWindow: 300_000,
      },
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: "compacting" }, deps);

    expect(session.state.lifecycle_events).toEqual([
      expect.objectContaining({
        type: "compaction",
        before: expect.objectContaining({
          contextTokensUsed: 270_000,
          contextUsedPercent: 90,
          source: "codex_token_details",
        }),
      }),
    ]);
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        type: "session_update",
        session: { lifecycle_events: session.state.lifecycle_events },
      }),
    );

    session.state.codex_token_details = {
      ...session.state.codex_token_details,
      contextTokensUsed: 42_000,
    };
    session.state.context_used_percent = 14;
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      after: {
        contextTokensUsed: 42_000,
        contextUsedPercent: 14,
        source: "codex_token_details",
      },
    });
  });

  it("suppresses Takode recovery for low-usage Codex model-switch migration compaction", async () => {
    // Codex can emit a real contextCompaction immediately after changing the
    // resumed thread model, even when reported usage is far below the normal
    // auto-compact envelope. That migration compaction should not create a
    // user-visible compact marker or inject Takode's generic recovery prompt.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 61,
      codex_token_details: {
        contextTokensUsed: 399_423,
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        modelContextWindow: 650_000,
      },
    };
    session.codexModelSwitchCompactionGuard = {
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: "compacting" }, deps);
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.codexModelSwitchCompactionGuard).toBeNull();
    expect(session.codexSuppressRecoveryForCurrentCompaction).toBe(false);
    expect(session.compactedDuringTurn).not.toBe(true);
    expect(session.messageHistory.some((entry) => entry.type === "compact_marker")).toBe(false);
    expect(session.state.lifecycle_events).toBeUndefined();
    expect(deps.injectCompactionRecovery).not.toHaveBeenCalled();
    expect(broadcasts).not.toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
    expect(broadcasts).not.toContainEqual(expect.objectContaining({ type: "status_change", status: "compacting" }));
  });

  it("keeps normal compaction recovery for high-usage compaction after model switch", async () => {
    // The model-switch guard is only for migration compactions below the normal
    // auto-compact envelope. Real context-pressure compaction still needs the
    // standard marker and recovery handling.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 95,
      codex_token_details: {
        contextTokensUsed: 617_500,
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        modelContextWindow: 650_000,
      },
    };
    session.codexModelSwitchCompactionGuard = {
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: "compacting" }, deps);
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.codexModelSwitchCompactionGuard).toBeNull();
    expect(session.compactedDuringTurn).toBe(true);
    expect(session.messageHistory.some((entry) => entry.type === "compact_marker")).toBe(true);
    expect(session.state.lifecycle_events?.[0]).toEqual(expect.objectContaining({ type: "compaction" }));
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "status_change", status: "compacting" }));
  });

  it("strips leader thread text prefixes and persists quest thread metadata", async () => {
    // Codex uses a separate adapter path, so it needs direct coverage for the
    // persisted/broadcast message shape consumed by quest-thread UI filtering.
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [{ type: "text", text: "[thread:q-941]\nCodex routed update" }]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadKey: "q-941",
      questId: "q-941",
      threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
    });
    expect(msg.type === "assistant" ? msg.message.content : []).toMatchObject([
      { type: "text", text: "Codex routed update" },
    ]);
    expect(session.messageHistory[0]).toMatchObject(msg);
  });

  it("enriches an existing empty WebSearch tool row when Codex completes it with query details", async () => {
    const session = makeSession();
    const toolMessageId = "codex-tool_use-ws_progressive";
    const toolUseId = "ws_progressive";
    // Codex can start Web Search with only { type: "other" } and later complete
    // the same stable id with the real search query list. The bridge must update
    // the existing history row before same-id replay dedupe can drop it.
    session.messageHistory.push(
      makeAssistant(
        [
          {
            type: "tool_use",
            id: toolUseId,
            name: "WebSearch",
            input: { query: "", action: { type: "other" } },
          },
        ],
        toolMessageId,
      ),
    );

    const broadcasts: BrowserIncomingMessage[] = [];
    const persistSession = vi.fn();
    const isDuplicateCodexAssistantReplay = vi.fn(() => true);

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant(
        [
          {
            type: "tool_use",
            id: toolUseId,
            name: "WebSearch",
            input: {
              query: "OpenAI Codex CLI documentation",
              action: {
                type: "search",
                query: "OpenAI Codex CLI documentation",
                queries: ["OpenAI Codex CLI documentation", "MDN MediaRecorder start timeslice"],
              },
            },
          },
        ],
        toolMessageId,
      ),
      {
        ...makeDeps(broadcasts),
        persistSession,
        isDuplicateCodexAssistantReplay,
      },
    );

    expect(session.messageHistory).toHaveLength(1);
    const updated = session.messageHistory[0];
    expect(updated.type).toBe("assistant");
    const updatedBlock = updated.type === "assistant" ? updated.message.content[0] : undefined;
    expect(updatedBlock).toMatchObject({
      type: "tool_use",
      id: toolUseId,
      name: "WebSearch",
      input: {
        query: "OpenAI Codex CLI documentation",
        action: {
          type: "search",
          query: "OpenAI Codex CLI documentation",
          queries: ["OpenAI Codex CLI documentation", "MDN MediaRecorder start timeslice"],
        },
      },
    });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject(updated);
    expect(persistSession).toHaveBeenCalledWith(session);
    expect(isDuplicateCodexAssistantReplay).not.toHaveBeenCalled();
  });

  it("records Codex thread status markers only after replay duplicate detection", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    try {
      await handleCodexAdapterBrowserMessage(
        session,
        makeAssistant(
          [
            {
              type: "text",
              text: "[thread:q-941]\n{[(Thread Waiting: q-941 | waiting on reviewer)]}",
            },
          ],
          "codex-status-live",
        ),
        deps,
      );
    } finally {
      nowSpy.mockRestore();
    }

    expect(session.state.leaderThreadStatuses?.["q-941"]).toMatchObject({
      kind: "waiting",
      threadKey: "q-941",
      messageId: "codex-status-live",
      timestamp: 1,
    });
    expect(broadcasts).toEqual([
      expect.objectContaining({
        type: "session_update",
        session: {
          leaderThreadStatuses: expect.objectContaining({
            "q-941": expect.objectContaining({ kind: "waiting" }),
          }),
        },
      }),
      expect.objectContaining({
        type: "assistant",
        threadStatusMarkers: [expect.objectContaining({ kind: "waiting", threadKey: "q-941" })],
      }),
    ]);
  });

  it("creates unread review attention from live Codex Thread Ready markers and dedupes replay", async () => {
    const session = makeSession();
    session.attentionReason = "action";
    const broadcasts: BrowserIncomingMessage[] = [];
    const scheduleNotification = vi.fn();
    const deps = {
      ...makeDeps(broadcasts),
      scheduleNotification,
    } as CodexAdapterBrowserMessageDeps & { scheduleNotification: ReturnType<typeof vi.fn> };
    const readyMessage = makeAssistant(
      [
        {
          type: "text",
          text: "[thread:q-1539]\nDone.\n{[(Thread Ready: q-1539 | quest complete)]}",
        },
      ],
      "codex-ready-live",
    );

    await handleCodexAdapterBrowserMessage(session, readyMessage, deps);
    await handleCodexAdapterBrowserMessage(session, readyMessage, deps);

    expect(session.state.leaderThreadStatuses?.["q-1539"]).toMatchObject({
      kind: "ready",
      threadKey: "q-1539",
      messageId: "codex-ready-live",
    });
    expect(session.notifications).toEqual([
      expect.objectContaining({
        id: "n-1",
        category: "review",
        summary: "Thread ready: q-1539 | quest complete",
        threadKey: "q-1539",
        questId: "q-1539",
        messageId: "codex-ready-live",
        done: false,
      }),
    ]);
    expect(session.attentionReason).toBe("action");
    expect(scheduleNotification).not.toHaveBeenCalled();
    expect(broadcasts.filter((msg) => msg.type === "notification_update")).toHaveLength(1);
    expect(broadcasts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "notification_update",
          notifications: [expect.objectContaining({ category: "review", threadKey: "q-1539" })],
        }),
        expect.objectContaining({
          type: "assistant",
          threadStatusMarkers: [expect.objectContaining({ kind: "ready", threadKey: "q-1539" })],
        }),
      ]),
    );
  });

  it("preserves unrelated Codex thread statuses when routed output touches a different thread", async () => {
    const session = makeSession();
    const existing = makeThreadStatus({ threadKey: "q-941", summary: "worker still running" });
    session.state.leaderThreadStatuses = { "q-941": existing };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-942]\nReviewer dispatched." }], "codex-unrelated"),
      makeDeps(broadcasts),
    );

    expect(session.state.leaderThreadStatuses).toEqual({ "q-941": existing });
    expect(broadcasts).toEqual([expect.objectContaining({ type: "assistant", threadKey: "q-942" })]);
  });

  it("clears a same-thread Codex status when fresh routed output has no marker", async () => {
    const session = makeSession();
    session.state.leaderThreadStatuses = {
      "q-941": makeThreadStatus({ threadKey: "q-941", summary: "old status" }),
    };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-941]\nImplementation update." }], "codex-clear"),
      makeDeps(broadcasts),
    );

    expect(session.state.leaderThreadStatuses?.["q-941"]).toBeUndefined();
    expect(broadcasts).toEqual([
      expect.objectContaining({
        type: "session_update",
        session: { leaderThreadStatuses: {} },
      }),
      expect.objectContaining({ type: "assistant", threadKey: "q-941" }),
    ]);
  });

  it("does not refresh stale thread status state from duplicate Codex assistant replay markers", async () => {
    const session = makeSession();
    const staleStatus = {
      kind: "waiting" as const,
      label: "Thread Waiting" as const,
      threadKey: "q-941",
      questId: "q-941",
      summary: "old wait",
      messageId: "old-status",
      timestamp: 10,
      updatedAt: 10,
    };
    session.state.leaderThreadStatuses = { "q-941": staleStatus };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    deps.isDuplicateCodexAssistantReplay = vi.fn(() => true);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_000_000);

    try {
      await handleCodexAdapterBrowserMessage(
        session,
        makeAssistant(
          [
            {
              type: "text",
              text: "[thread:q-941]\n{[(Thread Ready: q-941 | replayed historical ready marker)]}",
            },
          ],
          "codex-status-replay",
        ),
        deps,
      );
    } finally {
      nowSpy.mockRestore();
    }

    const duplicateAssistantArg = (deps.isDuplicateCodexAssistantReplay as ReturnType<typeof vi.fn>).mock.calls[0]?.[1];
    expect(duplicateAssistantArg).toMatchObject({ type: "assistant", threadKey: "q-941" });
    expect(duplicateAssistantArg).not.toHaveProperty("threadStatusMarkers");
    expect(session.state.leaderThreadStatuses).toEqual({ "q-941": staleStatus });
    expect(session.state.leaderThreadStatuses["q-941"].timestamp).not.toBe(1_000_000);
    expect(session.messageHistory).toHaveLength(0);
    expect(broadcasts).toEqual([]);
  });

  it("updates the active running route when Codex leader assistant output is routed to a quest thread", async () => {
    const session = makeSession();
    session.isGenerating = true;
    session.activeTurnRoute = { threadKey: "main" };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-1195]\nRouted Codex update" }]),
      makeDeps(broadcasts),
    );

    expect(session.activeTurnRoute).toEqual({ threadKey: "q-1195", questId: "q-1195" });
    expect(broadcasts).toEqual([
      expect.objectContaining({ type: "assistant", threadKey: "q-1195", questId: "q-1195" }),
      expect.objectContaining({
        type: "status_change",
        status: "running",
        activeTurnRoute: { threadKey: "q-1195", questId: "q-1195" },
      }),
    ]);
  });

  it("does not rebroadcast active route when Codex routed output stays in the same quest thread", async () => {
    const session = makeSession();
    session.isGenerating = true;
    session.activeTurnRoute = { threadKey: "q-1195", questId: "q-1195" };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-1195]\nStill routed there" }]),
      makeDeps(broadcasts),
    );

    expect(session.activeTurnRoute).toEqual({ threadKey: "q-1195", questId: "q-1195" });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "assistant", threadKey: "q-1195", questId: "q-1195" });
  });

  it("keeps genuinely Main-routed Codex assistant output active in Main", async () => {
    const session = makeSession();
    session.isGenerating = true;
    session.activeTurnRoute = { threadKey: "main" };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:main]\nGlobal Codex update" }]),
      makeDeps(broadcasts),
    );

    expect(session.activeTurnRoute).toEqual({ threadKey: "main" });
    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({ type: "assistant", threadKey: "main" });
    expect(broadcasts[0].type === "assistant" ? broadcasts[0].message.content : []).toMatchObject([
      { type: "text", text: "Global Codex update" },
    ]);
  });

  it("routes unthreaded Codex file-edit tool activity to the most recent quest thread", async () => {
    const session = makeSession();

    await routeAssistantMessage(session, [{ type: "text", text: "[thread:q-1195]\nWorking in this quest tab." }]);
    const toolMsg = await routeAssistantMessage(session, [
      { type: "tool_use", id: "file-edit-1", name: "Edit", input: { file_path: "web/server/example.ts" } },
    ]);

    expect(toolMsg).toMatchObject({
      type: "assistant",
      threadKey: "q-1195",
      questId: "q-1195",
      threadRefs: [{ threadKey: "q-1195", questId: "q-1195", source: "inferred" }],
    });
    expect(toolMsg.type === "assistant" ? toolMsg.threadRoutingError : undefined).toBeUndefined();
  });

  it("persists source-thread transition markers before Codex quest handoffs", async () => {
    const session = makeSession();
    session.messageHistory.push({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: "previous-q940", content: [] } as any,
      threadKey: "q-940",
      questId: "q-940",
      threadRefs: [{ threadKey: "q-940", questId: "q-940", source: "explicit" }],
    });
    session.messageHistory.push({ type: "tool_result_preview", previews: [] });
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-941]\nDispatching Codex worker" }]),
      makeDeps(broadcasts),
    );

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]).toMatchObject({
      type: "thread_transition_marker",
      sourceThreadKey: "q-940",
      sourceQuestId: "q-940",
      threadKey: "q-941",
      questId: "q-941",
      reason: "route_switch",
    });
    expect(broadcasts[1]).toMatchObject({ type: "assistant", threadKey: "q-941", questId: "q-941" });
    expect(session.messageHistory).toHaveLength(4);
    expect(session.messageHistory[2]).toMatchObject({ type: "thread_transition_marker" });
  });

  it("persists Main-origin transition markers before Codex quest handoffs", async () => {
    const session = makeSession();
    session.messageHistory.push({
      type: "user_message",
      id: "main-request",
      content: "Please work on q-948",
      timestamp: 1,
    });
    session.messageHistory.push({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        id: "main-tool-use",
        content: [{ type: "tool_use", id: "tool-view-image", name: "View", input: { file_path: "screenshot.png" } }],
      } as any,
    });
    session.messageHistory.push({
      type: "tool_result_preview",
      previews: [
        {
          tool_use_id: "tool-view-image",
          content: "viewed screenshot",
          is_error: false,
          total_size: 17,
          is_truncated: false,
        },
      ],
    });
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "[thread:q-948]\nContinuing there" }]),
      makeDeps(broadcasts),
    );

    expect(broadcasts).toHaveLength(2);
    expect(broadcasts[0]).toMatchObject({
      type: "thread_transition_marker",
      sourceThreadKey: "main",
      threadKey: "q-948",
      questId: "q-948",
      reason: "route_switch",
      sourceMessageIndex: 0,
      targetThreadFreshness: "new_quest_thread",
    });
    expect(broadcasts[0]).not.toHaveProperty("sourceQuestId");
    expect(broadcasts[1]).toMatchObject({ type: "assistant", threadKey: "q-948", questId: "q-948" });
    expect(session.messageHistory[3]).toMatchObject({ type: "thread_transition_marker", sourceThreadKey: "main" });
  });

  it("does not infer source-thread transition markers across Codex Main assistant boundaries", async () => {
    const session = makeSession();
    session.messageHistory.push({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: "previous-q940", content: [] } as any,
      threadKey: "q-940",
      questId: "q-940",
      threadRefs: [{ threadKey: "q-940", questId: "q-940", source: "explicit" }],
    });

    await routeAssistantMessage(session, [{ type: "text", text: "Global Main update" }]);
    const msg = await routeAssistantMessage(session, [{ type: "text", text: "[thread:q-941]\nSeparate quest update" }]);

    expect(msg).toMatchObject({ type: "assistant", threadKey: "q-941", questId: "q-941" });
    expect(session.messageHistory).toHaveLength(3);
    expect(session.messageHistory.some((entry) => entry.type === "thread_transition_marker")).toBe(false);
  });

  it("strips same-line leader thread prefixes and persists quest thread metadata", async () => {
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [
      { type: "text", text: "[thread:q-941] Same-line Codex routed update" },
    ]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadKey: "q-941",
      questId: "q-941",
      threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
    });
    expect(msg.type === "assistant" ? msg.message.content : []).toMatchObject([
      { type: "text", text: "Same-line Codex routed update" },
    ]);
  });

  it("routes post-quiz thread marker prose into the target quest thread", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant(
        [
          {
            type: "text",
            text: [
              "[thread:q-1567]",
              "[q-1567](quest:q-1567) is complete.",
              "",
              "{[(Quest Quiz: q-1567)]}",
              "[thread:q-1570] [q-1570](quest:q-1570) is dispatched.",
            ].join("\n"),
          },
        ],
        "codex-post-quiz-route",
      ),
      makeDeps(broadcasts),
    );

    const assistantBroadcasts = broadcasts.filter((msg) => msg.type === "assistant");
    expect(assistantBroadcasts).toHaveLength(2);
    expect(assistantBroadcasts[0]).toMatchObject({
      type: "assistant",
      threadKey: "q-1567",
      questId: "q-1567",
    });
    expect(assistantBroadcasts[0]?.type === "assistant" ? assistantBroadcasts[0].message.content : []).toEqual([
      {
        type: "text",
        text: "[q-1567](quest:q-1567) is complete.\n\n{[(Quest Quiz: q-1567)]}",
      },
    ]);
    expect(assistantBroadcasts[1]).toMatchObject({
      type: "assistant",
      threadKey: "q-1570",
      questId: "q-1570",
    });
    expect(assistantBroadcasts[1]?.type === "assistant" ? assistantBroadcasts[1].message.content : []).toEqual([
      { type: "text", text: "[q-1570](quest:q-1570) is dispatched." },
    ]);
    expect(JSON.stringify(session.messageHistory)).not.toContain("[thread:q-1570]");
    expect(session.messageHistory.some((entry) => entry.type === "thread_transition_marker")).toBe(true);
  });

  it("splits mid-message leader thread routes on a standalone divider and line-start marker", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant(
        [
          {
            type: "text",
            text: [
              "[thread:q-1695]",
              "Approved Option A is recorded.",
              "---",
              "[thread:q-1693]No separator still routes after the split divider.",
            ].join("\n"),
          },
        ],
        "codex-mid-message-route",
      ),
      makeDeps(broadcasts),
    );

    const assistantBroadcasts = broadcasts.filter((msg) => msg.type === "assistant");
    expect(assistantBroadcasts).toHaveLength(2);
    expect(assistantBroadcasts[0]).toMatchObject({
      type: "assistant",
      threadKey: "q-1695",
      questId: "q-1695",
    });
    expect(assistantBroadcasts[0]?.type === "assistant" ? assistantBroadcasts[0].message.content : []).toEqual([
      { type: "text", text: "Approved Option A is recorded." },
    ]);
    expect(assistantBroadcasts[1]).toMatchObject({
      type: "assistant",
      threadKey: "q-1693",
      questId: "q-1693",
    });
    expect(assistantBroadcasts[1]?.type === "assistant" ? assistantBroadcasts[1].message.content : []).toEqual([
      { type: "text", text: "No separator still routes after the split divider." },
    ]);
    expect(JSON.stringify(session.messageHistory)).not.toContain("[thread:q-1693]");
    expect(session.messageHistory.some((entry) => entry.type === "thread_transition_marker")).toBe(true);
  });

  it("splits post-quiz leader routes when markdown spacing leaves a blank line after the divider", async () => {
    const session = makeSession();
    const broadcasts: BrowserIncomingMessage[] = [];

    // Regression for the q-1718/q-1721 leak: Codex live assistant messages use
    // the same server-owned split boundary even when the model leaves a blank
    // markdown-spacing line between the divider and the next route marker.
    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant(
        [
          {
            type: "text",
            text: [
              "[thread:q-1718]",
              "[q-1718](quest:q-1718) is complete.",
              "",
              "{[(Quest Quiz: q-1718)]}",
              "",
              "---",
              "",
              "[thread:q-1721] [q-1721](quest:q-1721) is now dispatched.",
            ].join("\n"),
          },
        ],
        "codex-post-quiz-route-with-markdown-spacing",
      ),
      makeDeps(broadcasts),
    );

    const assistantBroadcasts = broadcasts.filter((msg) => msg.type === "assistant");
    expect(assistantBroadcasts).toHaveLength(2);
    expect(assistantBroadcasts[0]).toMatchObject({
      type: "assistant",
      threadKey: "q-1718",
      questId: "q-1718",
    });
    expect(assistantBroadcasts[0]?.type === "assistant" ? assistantBroadcasts[0].message.content : []).toEqual([
      { type: "text", text: "[q-1718](quest:q-1718) is complete.\n\n{[(Quest Quiz: q-1718)]}" },
    ]);
    expect(assistantBroadcasts[1]).toMatchObject({
      type: "assistant",
      threadKey: "q-1721",
      questId: "q-1721",
    });
    expect(assistantBroadcasts[1]?.type === "assistant" ? assistantBroadcasts[1].message.content : []).toEqual([
      { type: "text", text: "[q-1721](quest:q-1721) is now dispatched." },
    ]);
    expect(JSON.stringify(session.messageHistory)).not.toContain("[thread:q-1721]");
    expect(JSON.stringify(session.messageHistory)).not.toContain("\n---\n");
    expect(session.messageHistory.some((entry) => entry.type === "thread_transition_marker")).toBe(true);
  });

  it("routes leader text when launcher info says orchestrator and session state has not caught up", async () => {
    const session = makeSession();
    delete session.state.isOrchestrator;

    const msg = await routeAssistantMessage(
      session,
      [{ type: "text", text: "[thread:q-966] Launcher-derived Codex route" }],
      { getLauncherSessionInfo: () => ({ isOrchestrator: true }) },
    );

    expect(session.state.isOrchestrator).toBe(true);
    expect(msg).toMatchObject({
      type: "assistant",
      threadKey: "q-966",
      questId: "q-966",
      threadRefs: [{ threadKey: "q-966", questId: "q-966", source: "explicit" }],
    });
    expect(msg.type === "assistant" ? msg.message.content : []).toMatchObject([
      { type: "text", text: "Launcher-derived Codex route" },
    ]);
  });

  it("preserves unrouted leader text and records missing prefix metadata", async () => {
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [{ type: "text", text: "Unmarked Codex leader text" }]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadRoutingError: { reason: "missing", source: "visible_text", rawContent: "Unmarked Codex leader text" },
    });
    const content = msg.type === "assistant" ? msg.message.content : [];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: "text", text: "Unmarked Codex leader text" });
  });

  it("rejects no-space same-line leader thread prefixes", async () => {
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [{ type: "text", text: "[thread:q-941]No separator" }]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadRoutingError: { reason: "invalid", source: "visible_text", marker: "[thread:q-941]" },
    });
    const content = msg.type === "assistant" ? msg.message.content : [];
    expect(content[0].type === "text" ? content[0].text : "").toBe("[thread:q-941]No separator");
  });

  it("strips Bash command thread comments and persists command thread metadata", async () => {
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "# thread:q-941\npwd" } },
    ]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadKey: "q-941",
      questId: "q-941",
      threadRefs: [{ threadKey: "q-941", questId: "q-941", source: "explicit" }],
    });
    const block = msg.type === "assistant" ? msg.message.content[0] : null;
    expect(block).toMatchObject({ type: "tool_use", input: { command: "pwd" } });
  });

  it("preserves unrouted Bash command and records shell-command routing metadata", async () => {
    const session = makeSession();

    const msg = await routeAssistantMessage(session, [
      { type: "tool_use", id: "tool-1", name: "Bash", input: { command: "pwd" } },
    ]);

    expect(msg).toMatchObject({
      type: "assistant",
      threadRoutingError: { reason: "missing", source: "shell_command", rawContent: "pwd" },
    });
    const block = msg.type === "assistant" ? msg.message.content[0] : null;
    expect(block).toMatchObject({ type: "tool_use", input: { command: "pwd" } });
  });

  it("does not track Codex plan TodoWrite tool uses for result recovery", async () => {
    const session = makeSession();

    await routeAssistantMessage(session, [
      {
        type: "tool_use",
        id: "codex-plan-live-1",
        name: "TodoWrite",
        input: { todos: [{ content: "Inspect", status: "in_progress" }] },
      },
      { type: "tool_use", id: "cmd-live-1", name: "Bash", input: { command: "pwd" } },
    ]);

    // Codex plan updates are rendered through TodoWrite for UI state, but they
    // never produce tool_result messages. Real terminal tools still need timers.
    expect(session.toolStartTimes.has("codex-plan-live-1")).toBe(false);
    expect(session.toolStartTimes.has("cmd-live-1")).toBe(true);
  });
});
