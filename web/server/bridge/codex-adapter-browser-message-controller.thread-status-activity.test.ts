import { describe, expect, it, vi } from "vitest";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ActiveTurnRoute, BrowserIncomingMessage, ContentBlock, SessionNotification } from "../session-types.js";
import {
  handleCodexAdapterBrowserMessage,
  type CodexAdapterBrowserMessageDeps,
} from "./codex-adapter-browser-message-controller.js";

type TestSession = {
  id: string;
  state: Record<string, any>;
  messageHistory: BrowserIncomingMessage[];
  toolStartTimes: Map<string, number>;
  toolProgressOutput: Map<string, string>;
  isGenerating: boolean;
  activeTurnRoute: ActiveTurnRoute | null;
  activeReasoningAttributionRoute?: ActiveTurnRoute | null;
  activeCodexReasoningPreview?: null;
  notifications: SessionNotification[];
  notificationCounter: number;
  attentionReason: "action" | "error" | "review" | null;
  lastCliMessageAt?: number;
};

function makeSession(): TestSession {
  return {
    id: "codex-thread-status-activity",
    state: { isOrchestrator: true, backend_type: "codex" },
    messageHistory: [],
    toolStartTimes: new Map(),
    toolProgressOutput: new Map(),
    isGenerating: true,
    activeTurnRoute: { threadKey: "q-1850", questId: "q-1850" },
    notifications: [],
    notificationCounter: 0,
    attentionReason: null,
  };
}

function status(threadKey: string, kind: LeaderThreadStatus["kind"] = "ready"): LeaderThreadStatus {
  return {
    kind,
    label: kind === "ready" ? "Thread Ready" : "Thread Waiting",
    threadKey,
    questId: threadKey,
    summary: kind === "ready" ? "evidence matching explained" : "waiting on worker",
    messageId: "old-status",
    timestamp: 10,
    updatedAt: 10,
  };
}

function assistant(content: ContentBlock[], id: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    parent_tool_use_id: null,
    timestamp: 20,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.5",
      content,
      stop_reason: null,
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

describe("Codex leader thread status activity invalidation", () => {
  it("clears Ready on fresh same-thread tool-only assistant activity", async () => {
    // Producer-shaped version of the live view_image regression: the tool has
    // no text route, so it inherits the latest authoritative quest route.
    const session = makeSession();
    session.state.leaderThreadStatuses = { "q-1850": status("q-1850") };
    session.notifications = [
      {
        id: "n-needs-input",
        category: "needs-input",
        summary: "Confirm scope",
        timestamp: 12,
        done: false,
        threadKey: "q-1850",
        questId: "q-1850",
      } as SessionNotification,
    ];
    session.messageHistory.push({
      type: "user_message",
      id: "user-screenshot",
      content: "Inspect this screenshot",
      timestamp: 15,
      threadKey: "q-1850",
      questId: "q-1850",
    });
    const broadcasts: BrowserIncomingMessage[] = [];

    await handleCodexAdapterBrowserMessage(
      session as any,
      assistant(
        [{ type: "tool_use", id: "view-1", name: "view_image", input: { path: "/tmp/live.png" } }],
        "tool-activity",
      ),
      makeDeps(broadcasts),
    );

    expect(session.state.leaderThreadStatuses).toEqual({});
    expect(session.notifications).toEqual([
      expect.objectContaining({ id: "n-needs-input", done: false, threadKey: "q-1850" }),
    ]);
    expect(broadcasts).toEqual([
      expect.objectContaining({ type: "session_update", session: { leaderThreadStatuses: {} } }),
      expect.objectContaining({ type: "assistant", threadKey: "q-1850", questId: "q-1850" }),
    ]);
  });

  it("does not clear status for duplicate tool-only assistant replay", async () => {
    const session = makeSession();
    session.state.leaderThreadStatuses = { "q-1850": status("q-1850") };
    session.messageHistory.push({
      type: "user_message",
      id: "user-screenshot",
      content: "Inspect this screenshot",
      timestamp: 15,
      threadKey: "q-1850",
      questId: "q-1850",
    });
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    deps.isDuplicateCodexAssistantReplay = vi.fn(() => true);

    await handleCodexAdapterBrowserMessage(
      session as any,
      assistant(
        [{ type: "tool_use", id: "view-replay", name: "view_image", input: { path: "/tmp/live.png" } }],
        "replayed-tool",
      ),
      deps,
    );

    expect(session.state.leaderThreadStatuses).toEqual({
      "q-1850": expect.objectContaining({ kind: "ready", messageId: "old-status" }),
    });
    expect(broadcasts).toEqual([]);
  });

  it("clears a same-thread status on the first changed routed reasoning detail only", async () => {
    const session = makeSession();
    session.state.leaderThreadStatuses = { "q-1850": status("q-1850", "waiting") };
    const broadcasts: BrowserIncomingMessage[] = [];
    const deps = makeDeps(broadcasts);
    const detail: BrowserIncomingMessage = {
      type: "codex_reasoning_detail",
      id: "reasoning-1",
      text: "**Inspecting screenshot**",
      status: "streaming",
      timestamp: 20,
      parent_tool_use_id: null,
    };

    await handleCodexAdapterBrowserMessage(session as any, detail, deps);

    expect(session.state.leaderThreadStatuses).toEqual({});
    expect(broadcasts).toEqual([
      expect.objectContaining({ type: "session_update", session: { leaderThreadStatuses: {} } }),
      expect.objectContaining({ type: "codex_reasoning_detail", threadKey: "q-1850", questId: "q-1850" }),
    ]);

    session.activeTurnRoute = { threadKey: "q-1851", questId: "q-1851" };
    session.state.leaderThreadStatuses = { "q-1851": status("q-1851") };
    broadcasts.length = 0;
    await handleCodexAdapterBrowserMessage(session as any, detail, deps);

    expect(session.state.leaderThreadStatuses).toEqual({ "q-1851": expect.objectContaining({ kind: "ready" }) });
    expect(broadcasts.some((message) => message.type === "session_update")).toBe(false);
  });
});
