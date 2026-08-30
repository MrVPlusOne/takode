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
    // Codex surfaces compaction through item lifecycle status changes; the
    // bridge should persist explicit pressure telemetry without relying on chat history.
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
      { type: "status_change", status: "compacting", codexCompactionCause: "context_pressure" },
      deps,
    );

    expect(session.state.lifecycle_events).toEqual([
      expect.objectContaining({
        type: "compaction",
        trigger: "auto",
        cause: "context_pressure",
        before: expect.objectContaining({
          contextTokensUsed: 270_000,
          providerReportedInputTokens: 270_000,
          providerReportedTotalTokens: 275_000,
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
      before: {
        contextTokensUsed: 399_423,
        providerReportedInputTokens: 399_423,
        providerReportedTotalTokens: 405_000,
        contextUsedPercent: 61,
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

  it("keeps normal pressure recovery at 61% provider input after substantive post-switch activity", async () => {
    // A real model response consumes the migration guard. A later compaction is
    // pressure even when prompt-input accounting alone still reads only 61%.
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
      cause: "context_pressure",
      before: {
        contextTokensUsed: 684_000,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 90,
        source: "codex_auto_compact_limit",
      },
    });
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "status_change", status: "compacting" }));
  });

  it("keeps explicit manual compaction out of both pressure accounting and a stale model-switch guard", async () => {
    // `/compact` is an operator action. It consumes no migration suppression and
    // must retain provider-input accounting even when an auto limit is known.
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
      before: {
        contextTokensUsed: 464_542,
        providerReportedInputTokens: 464_542,
        providerReportedTotalTokens: 470_000,
        contextUsedPercent: 61,
        source: "codex_token_details",
      },
    });
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
    expect(broadcasts).toContainEqual(expect.objectContaining({ type: "compact_boundary" }));
  });
});
