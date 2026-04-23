import { describe, expect, it, vi } from "vitest";
import { handleSystemMessage, type SystemMessageSessionLike } from "./claude-message-controller.js";
import type {
  BrowserIncomingMessage,
  CLISystemStatusMessage,
  CLISystemTaskNotificationMessage,
  SessionState,
} from "../session-types.js";

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

function makeSession(): SystemMessageSessionLike {
  return {
    id: "s1",
    backendType: "claude",
    cliInitReceived: false,
    cliResuming: false,
    cliResumingClearTimer: null,
    forceCompactPending: false,
    compactedDuringTurn: false,
    awaitingCompactSummary: false,
    claudeCompactBoundarySeen: false,
    seamlessReconnect: false,
    disconnectWasGenerating: false,
    isGenerating: false,
    generationStartedAt: undefined,
    lastOutboundUserNdjson: null,
    messageHistory: [],
    pendingMessages: [],
    state: makeState(),
  };
}

function makeDeps() {
  return {
    onCLISessionId: vi.fn(),
    cacheSlashCommands: vi.fn(),
    backfillSlashCommands: vi.fn(),
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: false })),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    hasPendingForceCompact: vi.fn(() => false),
    flushQueuedCliMessages: vi.fn(),
    onOrchestratorTurnEnd: vi.fn(),
    isCliUserMessagePayload: vi.fn(() => false),
    markTurnInterrupted: vi.fn(),
    setGenerating: vi.fn(),
    onSessionActivityStateChanged: vi.fn(),
    emitTakodeEvent: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    hasCompactBoundaryReplay: vi.fn(() => false),
    freezeHistoryThroughCurrentTail: vi.fn(),
    hasTaskNotificationReplay: vi.fn(() => false),
    stuckGenerationThresholdMs: 120_000,
  };
}

describe("system-message-controller", () => {
  // Verifies the live system.status path updates both permissionMode and the derived
  // uiMode, while still emitting the current backend status to subscribed browsers.
  it("broadcasts uiMode and status changes for live system.status updates", () => {
    const session = makeSession();
    const deps = makeDeps();
    const msg: CLISystemStatusMessage = {
      type: "system",
      subtype: "status",
      status: "compacting",
      permissionMode: "plan",
      uuid: "status-1",
      session_id: "s1",
    };

    handleSystemMessage(session, msg, deps);

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

  // The SDK path enriches an existing compact_marker when compact_boundary arrives
  // after status:"compacting" already created the marker. The enrichment must still
  // set claudeCompactBoundarySeen so that the post-compaction recovery injection fires.
  it("injects compaction recovery after SDK enrichment path", () => {
    const session = makeSession();
    const deps = makeDeps();

    // 1. Enter compacting — creates compact_marker, resets claudeCompactBoundarySeen
    handleSystemMessage(
      session,
      {
        type: "system",
        subtype: "status",
        status: "compacting",
        uuid: "status-2",
        session_id: "s1",
      } as CLISystemStatusMessage,
      deps,
    );
    expect(session.state.is_compacting).toBe(true);
    expect(session.claudeCompactBoundarySeen).toBe(false);

    // 2. compact_boundary arrives — sets claudeCompactBoundarySeen = true
    handleSystemMessage(
      session,
      {
        type: "system",
        subtype: "compact_boundary",
        uuid: "cb-1",
        session_id: "s1",
      } as any,
      deps,
    );
    expect(session.claudeCompactBoundarySeen).toBe(true);

    // 3. Status transitions out of compacting — should trigger injection
    handleSystemMessage(
      session,
      {
        type: "system",
        subtype: "status",
        status: null,
        uuid: "status-3",
        session_id: "s1",
      } as CLISystemStatusMessage,
      deps,
    );
    expect(session.state.is_compacting).toBe(false);
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
  });

  // Verifies that when claudeCompactBoundarySeen is never set (e.g. no compact_boundary
  // message arrives), the recovery injection is skipped for Claude backend sessions.
  it("skips compaction recovery when compact boundary was never seen", () => {
    const session = makeSession();
    const deps = makeDeps();

    handleSystemMessage(
      session,
      {
        type: "system",
        subtype: "status",
        status: "compacting",
        uuid: "status-4",
        session_id: "s1",
      } as CLISystemStatusMessage,
      deps,
    );

    // Transition out of compacting without a compact_boundary
    handleSystemMessage(
      session,
      {
        type: "system",
        subtype: "status",
        status: null,
        uuid: "status-5",
        session_id: "s1",
      } as CLISystemStatusMessage,
      deps,
    );
    expect(deps.injectCompactionRecovery).not.toHaveBeenCalled();
  });

  // Resume replay can resend old task notifications; this confirms the controller
  // drops those duplicates instead of re-adding completion cards to history.
  it("deduplicates replayed task notifications", () => {
    const session = makeSession();
    const deps = makeDeps();
    deps.hasTaskNotificationReplay.mockReturnValue(true);
    const msg: CLISystemTaskNotificationMessage = {
      type: "system",
      subtype: "task_notification",
      task_id: "task-1",
      tool_use_id: "tool-1",
      status: "completed",
      summary: "done",
      output_file: undefined,
      session_id: "s1",
    };

    handleSystemMessage(session, msg, deps);

    expect(session.messageHistory).toHaveLength(0);
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
});
