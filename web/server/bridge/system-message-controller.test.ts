import { describe, expect, it, vi } from "vitest";
import { createClaudeMessageHandlers } from "./claude-message-controller.js";
import type { BrowserIncomingMessage, PermissionRequest, SessionState } from "../session-types.js";

function makeState(): SessionState {
  return {
    session_id: "s1",
    model: "",
    cwd: "",
    tools: [],
    permissionMode: "acceptEdits",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
  };
}

function makeDeps() {
  return {
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: false })),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    markTurnInterrupted: vi.fn(),
    setGenerating: vi.fn(),
    onSessionActivityStateChanged: vi.fn(),
    emitTakodeEvent: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    hasCompactBoundaryReplay: vi.fn(() => false),
    freezeHistoryThroughCurrentTail: vi.fn(),
    hasTaskNotificationReplay: vi.fn(() => false),
    clearActionAttentionIfNoPermissions: vi.fn(),
  };
}

function makeSdkSession() {
  return {
    id: "s1",
    backendType: "claude-sdk" as const,
    cliInitReceived: true,
    cliResuming: false,
    cliResumingClearTimer: null,
    forceCompactPending: false,
    compactedDuringTurn: false,
    awaitingCompactSummary: false,
    isGenerating: false,
    generationStartedAt: undefined as number | null | undefined,
    lastToolProgressAt: 0,
    messageHistory: [] as BrowserIncomingMessage[],
    pendingMessages: [] as string[],
    assistantAccumulator: new Map<string, { contentBlockIds: Set<string> }>(),
    toolStartTimes: new Map<string, number>(),
    toolProgressOutput: new Map<string, string>(),
    diffStatsDirty: false,
    lastActivityPreview: undefined as string | undefined,
    pendingPermissions: new Map<string, PermissionRequest>(),
    interruptedDuringTurn: false,
    queuedTurnStarts: 0,
    queuedTurnReasons: [] as string[],
    queuedTurnUserMessageIds: [] as number[][],
    queuedTurnInterruptSources: [] as Array<"user" | "leader" | "system" | null>,
    userMessageIdsThisTurn: [] as number[],
    state: makeState(),
  };
}

function makeSdkDeps() {
  return {
    ...makeDeps(),
    hasAssistantReplay: vi.fn(() => false),
    onToolUseObserved: vi.fn(),
    hasResultReplay: vi.fn(() => false),
    reconcileReplayState: vi.fn(() => ({ clearedResidualState: false })),
    getCurrentTurnTriggerSource: vi.fn(() => "user" as const),
    reconcileTerminalResultState: vi.fn(),
    finalizeOrphanedTerminalToolsOnResult: vi.fn(),
    cancelPermissionNotification: vi.fn(),
    onResultAttentionAndNotifications: vi.fn(),
    validateLeaderThreadOutcomes: vi.fn(),
    onTurnCompleted: vi.fn(),
    injectUserMessage: vi.fn(),
    refreshSessionConversation: vi.fn(),
    invalidateLeaderThreadTabsForSession: vi.fn(),
    hasUserPromptReplay: vi.fn(() => false),
    hasToolResultPreviewReplay: vi.fn(() => false),
    nextUserMessageId: vi.fn(() => "msg-1"),
    clearCodexToolResultWatchdog: vi.fn(),
    buildToolResultPreviews: vi.fn(() => []),
    collectCompletedToolStartTimes: vi.fn(() => []),
    finalizeSupersededCodexTerminalTools: vi.fn(),
    broadcastCompactSummary: vi.fn(),
    updateLatestCompactMarkerSummary: vi.fn(),
  };
}

describe("system-message-controller", () => {
  it("forwards thread-tab invalidation and conversation refresh through composed handlers", () => {
    const session = makeSdkSession();
    session.state.isOrchestrator = true;
    session.state.leaderThreadStatuses = {
      main: {
        kind: "ready",
        label: "Thread Ready",
        threadKey: "main",
        summary: "old result",
        messageId: "old-ready",
        timestamp: 1,
        updatedAt: 1,
      },
    };
    const allDeps = makeSdkDeps();
    const handlers = createClaudeMessageHandlers(allDeps);

    handlers.handleSdkBrowserMessage(session as any, {
      type: "assistant",
      parent_tool_use_id: null,
      uuid: "commentary-uuid",
      session_id: session.id,
      message: {
        id: "commentary",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "[thread:main:C]\nFresh activity." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });

    expect(allDeps.invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(session.id);

    allDeps.invalidateLeaderThreadTabsForSession.mockClear();
    session.messageHistory = [
      {
        type: "user_message",
        id: "user-final",
        leaderUserMessageId: "u1",
        content: "Please answer.",
        timestamp: 10,
        threadKey: "main",
        leaderResponseCoverageVersion: 1,
      },
    ];
    session.userMessageIdsThisTurn = [0];
    handlers.handleSdkBrowserMessage(session as any, {
      type: "assistant",
      parent_tool_use_id: null,
      uuid: "final-uuid",
      session_id: session.id,
      message: {
        id: "final",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "[thread:main:A:u1]\nFinal answer." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });
    handlers.handleResultMessage(session as any, {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "",
      duration_ms: 1,
      duration_api_ms: 1,
      num_turns: 1,
      total_cost_usd: 0,
      stop_reason: "end_turn",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "final-result",
      session_id: session.id,
    });

    expect(allDeps.invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(session.id);
    expect(allDeps.refreshSessionConversation).toHaveBeenCalledWith(session.id);
  });

  // Verifies the live status path updates both permissionMode and the derived
  // uiMode, while still emitting the current backend status to subscribed browsers.
  it("broadcasts uiMode and status changes for live status updates", () => {
    const session = makeSdkSession();
    const deps = makeSdkDeps();
    const handlers = createClaudeMessageHandlers(deps);

    handlers.handleSdkBrowserMessage(session, { type: "status_change", status: "compacting", permissionMode: "plan" });

    expect(session.state.permissionMode).toBe("plan");
    expect(session.state.uiMode).toBe("plan");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "session_update",
        session: { permissionMode: "plan", uiMode: "plan" },
      }),
    );
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({ type: "status_change", status: "compacting" }),
    );
    expect(deps.onSessionActivityStateChanged).toHaveBeenCalledWith("s1", "system_status");
  });

  // Exercises the SDK path (handleSdkCompactBoundary) where compact_boundary
  // enriches an existing compact_marker; the post-compaction recovery must still fire.
  it("injects compaction recovery after SDK compact_boundary enrichment", () => {
    const session = makeSdkSession();
    const allDeps = makeSdkDeps();
    const handlers = createClaudeMessageHandlers(allDeps);

    // 1. SDK status_change "compacting" — creates compact_marker, resets flag
    handlers.handleSdkBrowserMessage(session, {
      type: "status_change",
      status: "compacting",
    });
    expect(session.state.is_compacting).toBe(true);
    const marker = session.messageHistory.find((m) => m.type === "compact_marker");
    const markerId = marker && "id" in marker ? marker.id : undefined;
    expect(marker).toBeDefined();

    // 2. SDK compact_boundary — enriches existing marker via early-return path
    handlers.handleSdkBrowserMessage(session, {
      type: "system",
      subtype: "compact_boundary",
      uuid: "cb-1",
      session_id: "s1",
      compact_metadata: { trigger: "auto", pre_tokens: 180_000 },
    });
    expect(session.state.lifecycle_events).toEqual([
      expect.objectContaining({
        type: "compaction",
        id: markerId,
        trigger: "auto",
        before: expect.objectContaining({
          contextTokensUsed: 180_000,
          source: "compact_boundary",
        }),
      }),
    ]);
    expect(allDeps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "session_update",
        session: { lifecycle_events: session.state.lifecycle_events },
      }),
    );

    // 3. SDK status_change non-compacting — should trigger injection
    handlers.handleSdkBrowserMessage(session, {
      type: "status_change",
      status: null,
    });
    expect(session.state.is_compacting).toBe(false);
    expect(allDeps.injectCompactionRecovery).toHaveBeenCalledWith(session);
  });

  it("records a standalone Claude compact_boundary as a lifecycle event with pre-compaction tokens", () => {
    // Claude can report compact_boundary without a preceding compacting status;
    // that path should also persist the event model consumed by SessionInfoPopover.
    const session = makeSdkSession();
    const deps = makeSdkDeps();
    const handlers = createClaudeMessageHandlers(deps);

    handlers.handleSdkBrowserMessage(session, {
      type: "system",
      subtype: "compact_boundary",
      uuid: "cb-standalone",
      session_id: "s1",
      compact_metadata: { trigger: "manual", pre_tokens: 123_000 },
    });

    expect(session.state.lifecycle_events).toEqual([
      expect.objectContaining({
        id: session.messageHistory[0]?.type === "compact_marker" ? session.messageHistory[0].id : undefined,
        trigger: "manual",
        before: expect.objectContaining({
          contextTokensUsed: 123_000,
          source: "compact_boundary",
        }),
      }),
    ]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "session_update",
        session: { lifecycle_events: session.state.lifecycle_events },
      }),
    );
  });

  // The Agent SDK does not always surface compact_boundary through stream(), so a
  // finished compaction must still restore Takode context without one.
  it("injects compaction recovery even when the SDK never reports a compact boundary", () => {
    const session = makeSdkSession();
    const allDeps = makeSdkDeps();
    const handlers = createClaudeMessageHandlers(allDeps);

    handlers.handleSdkBrowserMessage(session, {
      type: "status_change",
      status: "compacting",
    });

    // Transition out without compact_boundary
    handlers.handleSdkBrowserMessage(session, {
      type: "status_change",
      status: null,
    });
    expect(allDeps.injectCompactionRecovery).toHaveBeenCalledWith(session);
  });

  // Resume replay can resend old task notifications; this confirms the controller
  // drops those duplicates instead of re-adding completion cards to history.
  it("deduplicates replayed task notifications", () => {
    const session = makeSdkSession();
    const deps = makeSdkDeps();
    deps.hasTaskNotificationReplay.mockReturnValue(true);
    const handlers = createClaudeMessageHandlers(deps);

    handlers.handleSdkBrowserMessage(session, {
      type: "task_notification",
      task_id: "task-1",
      tool_use_id: "tool-1",
      status: "completed",
      summary: "done",
      output_file: undefined,
    });

    expect(session.messageHistory).toHaveLength(0);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
});
