import { describe, expect, it, vi } from "vitest";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";
import type { BrowserIncomingMessage, ContentBlock } from "../session-types.js";

function makeSession(): any {
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

function makeAssistant(content: ContentBlock[]): BrowserIncomingMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    timestamp: 1,
    message: {
      id: "post-switch-assistant",
      type: "message",
      role: "assistant",
      model: "gpt-5.6-sol",
      content,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
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

describe("codex-adapter-browser-message-controller compaction", () => {
  it("records and broadcasts Codex compaction lifecycle events from status changes", async () => {
    // Preserve producer evidence when a future adapter can supply it, while
    // keeping the observed provider usage separate from configured limits.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 90,
      codex_token_details: {
        contextTokensUsed: 270_000,
        providerReportedTotalTokens: 275_000,
        inputTokens: 300_000,
        outputTokens: 10_000,
        cachedInputTokens: 30_000,
        reasoningOutputTokens: 5_000,
        modelContextWindow: 300_000,
      },
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      {
        type: "status_change",
        status: "compacting",
        codexCompactionCause: "context_pressure",
        codexCompactionCauseSource: "producer",
      },
      deps,
    );

    expect(session.state.lifecycle_events).toEqual([
      expect.objectContaining({
        type: "compaction",
        trigger: "auto",
        cause: "context_pressure",
        causeSource: "producer",
        before: expect.objectContaining({
          contextTokensUsed: 275_000,
          providerReportedInputTokens: 270_000,
          providerReportedTotalTokens: 275_000,
          contextUsedPercent: 92,
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
      contextTokensUsed: 40_000,
      providerReportedTotalTokens: 42_000,
    };
    session.state.context_used_percent = 14;
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      after: {
        contextTokensUsed: 42_000,
        providerReportedInputTokens: 40_000,
        providerReportedTotalTokens: 42_000,
        contextUsedPercent: 14,
        source: "codex_token_details",
      },
    });
  });

  it("downgrades an unproven pressure label to automatic cause unknown", async () => {
    // A cause string without producer provenance must not revive the old
    // configured-limit-as-measurement inference.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 55,
      codex_token_details: {
        contextTokensUsed: 423_969,
        providerReportedTotalTokens: 424_464,
        inputTokens: 423_969,
        outputTokens: 495,
        cachedInputTokens: 423_424,
        reasoningOutputTokens: 167,
        modelContextWindow: 770_000,
      },
      codex_context_window_diagnostics: {
        role: "leader",
        leaderMode: "compact",
        capacitySource: "configured_usable_capacity",
        autoCompactTokenLimit: 693_000,
        autoCompactTokenLimitScope: "total",
      },
    };
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session,
      { type: "status_change", status: "compacting", codexCompactionCause: "context_pressure" },
      makeDeps(broadcasts),
    );

    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger: "auto",
      cause: "unknown",
      before: {
        contextTokensUsed: 424_464,
        providerReportedInputTokens: 423_969,
        providerReportedTotalTokens: 424_464,
        contextUsedPercent: 55,
        source: "codex_token_details",
      },
    });
    expect(session.state.lifecycle_events?.[0]).not.toHaveProperty("causeSource");
  });

  it("suppresses only the immediate no-activity Codex model-switch migration compaction", async () => {
    // Migration is identified by the live one-shot guard, not by an arbitrary
    // percentage. Keep lifecycle evidence while hiding generic marker/recovery UI.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 61,
      codex_token_details: {
        contextTokensUsed: 399_423,
        providerReportedTotalTokens: 405_000,
        inputTokens: 100,
        outputTokens: 10,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        modelContextWindow: 650_000,
      },
      codex_context_window_diagnostics: {
        role: "leader",
        leaderMode: "compact",
        capacitySource: "configured_usable_capacity",
        displayContextWindow: 650_000,
        autoCompactTokenLimit: 585_000,
        autoCompactTokenLimitScope: "total",
      },
    };
    session.codexModelSwitchCompactionGuard = {
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      modelActivityObserved: false,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: "compacting" }, deps);
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.codexModelSwitchCompactionGuard).toBeNull();
    expect(session.codexSuppressRecoveryForCurrentCompaction).toBe(false);
    expect(session.compactedDuringTurn).not.toBe(true);
    expect(session.messageHistory.some((entry: BrowserIncomingMessage) => entry.type === "compact_marker")).toBe(false);
    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger: "auto",
      cause: "model_switch_migration",
      causeSource: "takode_model_switch_guard",
      before: {
        contextTokensUsed: 405_000,
        providerReportedInputTokens: 399_423,
        providerReportedTotalTokens: 405_000,
        contextUsedPercent: 62,
        source: "codex_token_details",
      },
      finishedAt: expect.any(Number),
    });
    expect(deps.injectCompactionRecovery).not.toHaveBeenCalled();
    expect(deps.emitTakodeEvent).not.toHaveBeenCalledWith(
      session.id,
      expect.stringMatching(/^compaction_/),
      expect.anything(),
    );
    expect(broadcasts).toContainEqual(
      expect.objectContaining({
        type: "session_update",
        session: { lifecycle_events: session.state.lifecycle_events },
      }),
    );
    expect(broadcasts).not.toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
    expect(broadcasts).not.toContainEqual(expect.objectContaining({ type: "status_change", status: "compacting" }));
  });

  it("keeps normal recovery for an unclassified auto compaction after post-switch activity", async () => {
    // A real model response consumes the migration guard. A later compaction
    // still gets normal recovery, but app-server does not reveal its cause.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 61,
      codex_token_details: {
        contextTokensUsed: 464_542,
        providerReportedTotalTokens: 470_000,
        inputTokens: 1_200_000,
        outputTokens: 50_000,
        cachedInputTokens: 930_000,
        reasoningOutputTokens: 2_000,
        modelContextWindow: 760_000,
      },
      codex_context_window_diagnostics: {
        role: "non_leader",
        capacitySource: "configured_usable_capacity",
        displayContextWindow: 760_000,
        autoCompactTokenLimit: 684_000,
        autoCompactTokenLimitScope: "total",
      },
    };
    session.codexModelSwitchCompactionGuard = {
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      modelActivityObserved: false,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      makeAssistant([{ type: "text", text: "post-switch output" }]),
      deps,
    );
    expect(session.codexModelSwitchCompactionGuard?.modelActivityObserved).toBe(true);
    broadcasts.length = 0;

    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: "compacting" }, deps);
    await handleCodexAdapterBrowserMessage(session, { type: "status_change", status: null }, deps);

    expect(session.codexModelSwitchCompactionGuard).toBeNull();
    expect(session.compactedDuringTurn).toBe(true);
    expect(session.messageHistory.some((entry: BrowserIncomingMessage) => entry.type === "compact_marker")).toBe(true);
    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger: "auto",
      cause: "unknown",
      before: {
        contextTokensUsed: 470_000,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 62,
        source: "codex_token_details",
      },
    });
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "status_change", status: "compacting" }));
  });

  it("keeps explicit manual compaction out of both pressure accounting and a stale model-switch guard", async () => {
    // `/compact` is an operator action. It consumes no migration suppression and
    // must retain observed provider accounting even when an auto limit is known.
    const session = makeSession();
    session.state = {
      backend_type: "codex",
      context_used_percent: 61,
      codex_token_details: {
        contextTokensUsed: 464_542,
        providerReportedTotalTokens: 470_000,
        inputTokens: 1_200_000,
        outputTokens: 50_000,
        cachedInputTokens: 930_000,
        reasoningOutputTokens: 2_000,
        modelContextWindow: 760_000,
      },
      codex_context_window_diagnostics: {
        role: "non_leader",
        capacitySource: "configured_usable_capacity",
        displayContextWindow: 760_000,
        autoCompactTokenLimit: 684_000,
        autoCompactTokenLimitScope: "total",
      },
    };
    session.codexModelSwitchCompactionGuard = {
      previousModel: "gpt-5.5",
      nextModel: "gpt-5.6-sol",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      modelActivityObserved: false,
    };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);

    await handleCodexAdapterBrowserMessage(
      session,
      { type: "status_change", status: "compacting", codexCompactionCause: "manual" },
      deps,
    );
    await handleCodexAdapterBrowserMessage(
      session,
      { type: "status_change", status: null, codexCompactionCause: "manual" },
      deps,
    );

    expect(session.codexModelSwitchCompactionGuard).toBeNull();
    expect(session.compactedDuringTurn).toBe(true);
    expect(session.state.lifecycle_events?.[0]).toMatchObject({
      trigger: "manual",
      cause: "manual",
      causeSource: "takode_manual_request",
      before: {
        contextTokensUsed: 470_000,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 62,
        source: "codex_token_details",
      },
    });
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
  });
  it("keeps a zero-input leader recycle snapshot internally consistent", async () => {
    // Post-compaction usage can retain a nonzero provider last total while
    // input is exactly zero. Recycle mode must still rewrite numerator,
    // percentage, and denominator as one role-specific display policy.
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
          context_used_percent: 16,
          codex_token_details: {
            contextTokensUsed: 0,
            displayContextTokensUsed: 42_176,
            providerReportedTotalTokens: 42_176,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0,
            modelContextWindow: 258_400,
          },
        },
      },
      deps,
    );

    expect(session.state.context_used_percent).toBe(0);
    expect(session.state.codex_token_details).toMatchObject({
      contextTokensUsed: 0,
      displayContextTokensUsed: 0,
      providerReportedTotalTokens: 42_176,
      modelContextWindow: 545_000,
    });
    expect(deps.requestCodexLeaderRecycle).not.toHaveBeenCalled();
  });
});
