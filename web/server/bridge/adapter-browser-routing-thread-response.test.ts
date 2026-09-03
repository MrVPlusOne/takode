import { describe, expect, it, vi } from "vitest";
import type { BrowserOutgoingMessage } from "../session-types.js";
import { ingestUserMessage } from "./adapter-browser-routing-controller.js";
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
});
