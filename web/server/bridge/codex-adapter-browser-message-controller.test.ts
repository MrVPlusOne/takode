import { describe, expect, it, vi } from "vitest";
import {
  handleCodexAdapterBrowserMessage,
  isCodexContextWindowExhaustionMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ActiveTurnRoute, BrowserIncomingMessage, ContentBlock } from "../session-types.js";

type TestCodexSession = {
  id: string;
  state: any;
  messageHistory: BrowserIncomingMessage[];
  toolStartTimes: Map<string, number>;
  toolProgressOutput: Map<string, string>;
  isGenerating: boolean;
  activeTurnRoute: ActiveTurnRoute | null;
  lastCliMessageAt?: number;
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

function makeResult(id: string, numTurns = 1): BrowserIncomingMessage {
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
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: id,
      session_id: "codex-leader",
    },
  };
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
    getCodexLeaderRecycleThresholdTokens: () => 0,
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

    const duplicateAssistantArg = vi.mocked(deps.isDuplicateCodexAssistantReplay).mock.calls[0]?.[1];
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
      threadRoutingError: { reason: "missing", rawContent: "Unmarked Codex leader text" },
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
      threadRoutingError: { reason: "invalid", marker: "[thread:q-941]" },
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
