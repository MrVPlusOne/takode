import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "../session-types.js";
import { ingestUserMessage, routeBrowserMessage } from "./adapter-browser-routing-controller.js";
import { finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import { THREAD_RESPONSE_REMINDER_SOURCE_ID } from "./leader-thread-outcome-validator.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";

function session(): AdapterBrowserRoutingSessionLike {
  return {
    id: "leader",
    backendType: "claude-sdk",
    state: {
      session_id: "leader",
      cwd: "/tmp",
      backend_state: "connected",
      leaderThreadStatuses: {
        "q-42": {
          kind: "ready",
          label: "Thread Ready",
          threadKey: "q-42",
          questId: "q-42",
          summary: "previous request complete",
          messageId: "old-ready",
          timestamp: 1,
          updatedAt: 1,
        },
      },
    } as unknown as AdapterBrowserRoutingSessionLike["state"],
    messageHistory: [],
    notifications: [],
    pendingPermissions: new Map(),
    evaluatingAborts: new Map(),
    pendingMessages: [],
    pendingCodexTurns: [],
    pendingCodexInputs: [],
    forceCompactPending: false,
    isGenerating: false,
    lastUserMessageDateTag: "",
    lastOutboundUserNdjson: null,
    consecutiveAdapterFailures: 0,
    codexAdapter: null,
    claudeSdkAdapter: null,
  };
}

function deps() {
  return {
    getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true })),
    nextUserMessageId: vi.fn(() => "user-q42"),
    promoteLeaderThreadTabForMessageAttention: vi.fn(),
    touchUserMessage: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    refreshBrowserConversationViews: vi.fn(),
    invalidateLeaderThreadTabsForSession: vi.fn(() => true),
    emitTakodeEvent: vi.fn(),
  } as unknown as AdapterBrowserRoutingDeps;
}

describe("leader direct-user response cutover ingestion", () => {
  it("marks committed human input, clears stale Ready, and refreshes selected windows", () => {
    const target = session();
    const runtime = deps();
    const message: Extract<BrowserOutgoingMessage, { type: "user_message" }> = {
      type: "user_message",
      content: "Please revise the result.",
      threadKey: "q-42",
    };

    const ingested = ingestUserMessage(target, message, runtime);

    expect(ingested).not.toBeInstanceOf(Promise);
    expect(target.messageHistory[0]).toMatchObject({
      type: "user_message",
      id: "user-q42",
      threadKey: "q-42",
      questId: "q-42",
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u1",
    });
    expect(target.state.leaderThreadStatuses?.["q-42"]).toBeUndefined();
    expect(runtime.broadcastToBrowsers).toHaveBeenCalledWith(target, target.messageHistory[0]);
    expect(runtime.refreshBrowserConversationViews).toHaveBeenCalledWith(target);
    expect(runtime.invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(target.id);
  });

  it("invalidates Ready when Codex accepts the human input before history commit", () => {
    const target = session();
    target.backendType = "codex";
    const runtime = deps();
    const message: Extract<BrowserOutgoingMessage, { type: "user_message" }> = {
      type: "user_message",
      content: "Queue this request.",
      threadKey: "q-42",
    };

    const ingested = ingestUserMessage(target, message, runtime, { commit: false });

    expect(ingested).not.toBeInstanceOf(Promise);
    expect(target.messageHistory).toEqual([]);
    expect((ingested as Exclude<typeof ingested, Promise<unknown>>).historyEntry).toMatchObject({
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u1",
    });
    expect(target.state.leaderThreadStatuses?.["q-42"]).toBeUndefined();
    expect(runtime.refreshBrowserConversationViews).not.toHaveBeenCalled();
    expect(runtime.invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(target.id);
  });

  it("does not mark or invalidate system-authored user-shaped input", () => {
    const target = session();
    const runtime = deps();
    const message: Extract<BrowserOutgoingMessage, { type: "user_message" }> = {
      type: "user_message",
      content: "Internal reminder",
      threadKey: "q-42",
      agentSource: { sessionId: "system:reminder", sessionLabel: "Reminder" },
    };

    ingestUserMessage(target, message, runtime);

    expect(target.messageHistory[0]).not.toHaveProperty("leaderResponseCoverageVersion");
    expect(target.messageHistory[0]).not.toHaveProperty("leaderUserMessageId");
    expect(target.state.leaderThreadStatuses?.["q-42"]?.kind).toBe("ready");
    expect(runtime.refreshBrowserConversationViews).not.toHaveBeenCalled();
    expect(runtime.invalidateLeaderThreadTabsForSession).not.toHaveBeenCalled();
  });
  it("fails closed when an outcome-reminder source lacks its structured guard", async () => {
    const target = session();
    const runtime = deps();
    const historyLength = target.messageHistory.length;

    const accepted = await routeBrowserMessage(
      target as AdapterBrowserRoutingSessionLike &
        import("./browser-transport-controller.js").BrowserTransportSessionLike,
      {
        type: "user_message",
        content: "unguarded reminder",
        agentSource: { sessionId: THREAD_RESPONSE_REMINDER_SOURCE_ID, sessionLabel: "Thread Outcome Reminder" },
        threadKey: "main",
      },
      undefined,
      runtime,
    );

    expect(accepted).toBe(false);
    expect(target.messageHistory).toHaveLength(historyLength);
    expect(target.pendingCodexInputs).toEqual([]);
  });

  it("drops a stale persisted outcome reminder before user-history or pending-input ingestion", async () => {
    const target = session();
    const runtime = deps();
    const direct = {
      type: "user_message",
      id: "direct-u1",
      content: "Please answer this.",
      timestamp: 10,
      threadKey: "main",
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u1",
    } satisfies BrowserIncomingMessage;
    const answer = {
      type: "assistant",
      message: {
        id: "answer-u1",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "The answer is complete." }],
        stop_reason: "end_turn",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
      parent_tool_use_id: null,
      timestamp: 20,
      threadKey: "main",
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: ["u1"],
      leaderAnswerObservedHistoryLength: 1,
    } satisfies BrowserIncomingMessage;
    target.messageHistory.push(direct, answer);
    expect(finalizeRoutedLeaderResponseMessage(target, answer)).toMatchObject({ finalized: true });
    target.state.leaderThreadStatuses!.main = {
      kind: "ready",
      label: "Thread Ready",
      threadKey: "main",
      summary: "answer complete",
      messageId: "answer-u1",
      timestamp: 20,
      updatedAt: 20,
    };
    const historyLength = target.messageHistory.length;

    const accepted = await routeBrowserMessage(
      target as AdapterBrowserRoutingSessionLike &
        import("./browser-transport-controller.js").BrowserTransportSessionLike,
      {
        type: "user_message",
        content: "stale answer reminder",
        agentSource: { sessionId: THREAD_RESPONSE_REMINDER_SOURCE_ID, sessionLabel: "Thread Outcome Reminder" },
        threadKey: "main",
        leaderThreadOutcomeReminderGuard: {
          version: 1,
          pendingResponseTargets: [
            {
              threadKey: "main",
              earliestTimestamp: 10,
              pendingAnswerCount: 1,
              pendingAnswerUserMessageIds: ["u1"],
            },
          ],
          missingOutcomeTargets: [],
          missingNeedsInputTargets: [],
        },
      },
      undefined,
      runtime,
    );

    expect(accepted).toBe(false);
    expect(target.messageHistory).toHaveLength(historyLength);
    expect(target.pendingCodexInputs).toEqual([]);
  });
});
