import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "../session-types.js";
import {
  ingestUserMessage,
  routeBrowserMessage,
  routeAdapterBrowserMessage,
} from "./adapter-browser-routing-controller.js";
import { finalizeRoutedLeaderResponseMessage } from "../leader-thread-response.js";
import { THREAD_RESPONSE_REMINDER_SOURCE_ID } from "./leader-thread-outcome-validator.js";
import type { AdapterBrowserRoutingDeps, AdapterBrowserRoutingSessionLike } from "./adapter-browser-routing-types.js";
import {
  buildAdapterUserMessageSourcePrefix,
  buildUserMessageDeliveryPrefix,
} from "./adapter-browser-routing-source-prefix.js";

describe("leader timer firing ingestion", () => {
  const firing = {
    type: "user_message" as const,
    content: "[⏰ Timer t4 reminder] Daily report\n\nEarlier note:\nProduce the report.",
    agentSource: { sessionId: "timer:t4", sessionLabel: "Timer t4" },
    threadKey: "q-42",
    timerFiring: { timerId: "t4", scheduledFireAt: 1_000 },
  };

  it("delivers a firing as a timer reminder that is not a human request and has no answer ID", async () => {
    // A leader reports a firing's result with an answer that names no request, so
    // the firing needs no ID; stored reminder prose is unchanged.
    const target = session();
    const runtime = deps();
    const ingested = await ingestUserMessage(target, firing, runtime);
    expect(ingested.historyEntry).toMatchObject({ content: firing.content, threadKey: "q-42", questId: "q-42" });
    expect(ingested.historyEntry).not.toHaveProperty("leaderUserMessageId");
    expect(ingested.historyEntry).not.toHaveProperty("leaderResponseCoverageVersion");
    expect(runtime.touchUserMessage).not.toHaveBeenCalled();
    expect(buildUserMessageDeliveryPrefix(target, ingested, firing, firing.content, runtime)).toMatch(
      /^\[Timer reminder [^\]]+\] \[thread:q-42\] $/,
    );
  });

  it("keeps a held firing's original model envelope when it is delivered again", async () => {
    // Auto-pause and recovery transfers redeliver the stored delivery content,
    // which already carries the envelope; adding another would duplicate it.
    const target = session();
    const runtime = deps();
    const deliveryContent = "[Timer reminder earlier] [thread:q-42] " + firing.content;
    const message = { ...firing, deliveryContent };
    const ingested = await ingestUserMessage(target, message, runtime, { commit: false });
    expect(buildUserMessageDeliveryPrefix(target, ingested, message, deliveryContent, runtime)).toBe("");
    // Delivery content without an envelope, such as a memory catalog prelude added
    // to a firing's first delivery, still gets one.
    const prelude = { ...firing, deliveryContent: firing.content + "\n\n[Memory catalog]" };
    expect(buildUserMessageDeliveryPrefix(target, ingested, prelude, prelude.deliveryContent, runtime)).toMatch(
      /^\[Timer reminder /,
    );
  });

  it("keeps a coalesced firing a timer reminder in the model envelope without rewriting raw content", async () => {
    // Materialized auto-pause groups retain their wrapper; it must not downgrade a
    // genuine firing to a timer event.
    const target = session();
    const runtime = deps();
    const message = {
      ...firing,
      content:
        "[Takode auto-pause resumed: 2 similar automatic inputs were coalesced while delivery was paused.]\n\n" +
        firing.content,
    };
    const ingested = await ingestUserMessage(target, message, runtime);
    expect(ingested.historyEntry.content).toBe(message.content);
    expect(buildUserMessageDeliveryPrefix(target, ingested, message, message.content, runtime)).toMatch(
      /^\[Timer reminder /,
    );
  });
});

describe("leader recipient source tags", () => {
  it("tags a message from another leader as Leader and other agent sessions as Agent", () => {
    // Leaders can message each other with takode send; the recipient must be
    // able to tell a peer leader apart from any other agent-sourced message.
    // Tags carry only the stable session number, not the renameable name.
    const getLauncherSessionInfo = vi.fn((id: string) => ({ isOrchestrator: id !== "worker-7" }));
    const peerPrefix = buildAdapterUserMessageSourcePrefix(session(), 1_000, getLauncherSessionInfo as any, {
      sessionId: "leader-2763",
      sessionLabel: "#2763 Takode Leader",
    });
    const agentPrefix = buildAdapterUserMessageSourcePrefix(session(), 1_000, getLauncherSessionInfo as any, {
      sessionId: "worker-7",
      sessionLabel: "#7 Worker",
    });
    expect(peerPrefix).toMatch(/^\[Leader #2763 .*\] $/);
    expect(peerPrefix).not.toContain("Takode Leader");
    expect(agentPrefix).toMatch(/^\[Agent #7 .*\] $/);
    expect(agentPrefix).not.toContain("Worker");

    // A herded worker sees its own leader by number only, too.
    const workerInfo = vi.fn((id: string) => (id === "worker-r" ? { herdedBy: "leader-2763" } : {}));
    const workerPrefix = buildAdapterUserMessageSourcePrefix(
      { ...session(), id: "worker-r" },
      1_000,
      workerInfo as any,
      {
        sessionId: "leader-2763",
        sessionLabel: "#2763 Takode Leader",
      },
    );
    expect(workerPrefix).toMatch(/^\[Leader #2763 .*\] $/);
    expect(workerPrefix).not.toContain("Takode Leader");
  });
});

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
    pendingMessages: [],
    pendingCodexTurns: [],
    pendingCodexInputs: [],
    forceCompactPending: false,
    isGenerating: false,
    lastUserMessageDateTag: "",
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
  it.each([
    "human",
    "stale",
    "other-thread",
    "timer",
    "not-yet-accepted",
  ])("acknowledges monitored results only for an accepted matching %s reply", async (kind) => {
    const target = session();
    target.state.threadMonitoring = {
      revision: 2,
      alertVersion: 1,
      threads: {
        "q-42": {
          trackedAt: 1,
          afterHistoryIndex: -1,
          pending: { id: "2", messageId: "ready", summary: "Ready", timestamp: 1 },
        },
      },
    };
    const message: Extract<BrowserOutgoingMessage, { type: "user_message" }> = {
      type: "user_message",
      content: "Thanks, continue.",
      threadKey: kind === "other-thread" ? "q-43" : "q-42",
      threadMonitorResultId: kind === "stale" ? "1" : "2",
      ...(kind === "timer" ? { agentSource: { sessionId: "timer:t1", sessionLabel: "Timer" } } : {}),
    };
    await ingestUserMessage(target, message, deps(), { commit: kind !== "not-yet-accepted" });
    expect(target.state.threadMonitoring.threads["q-42"].pending?.id ?? null).toBe(kind === "human" ? null : "2");
  });

  it("acknowledges a Codex reply when durably queued, before deferred history delivery", async () => {
    // Use the actual adapter admission path; backend execution remains frozen and no provider is contacted.
    const target = session();
    target.backendType = "codex";
    target.state.threadMonitoring = {
      revision: 2,
      alertVersion: 1,
      threads: {
        "q-42": {
          trackedAt: 1,
          afterHistoryIndex: -1,
          pending: { id: "2", messageId: "ready", summary: "Ready", timestamp: 1 },
        },
      },
    };
    const runtime = new Proxy(deps(), {
      get(object, key) {
        if (!(key in object)) Reflect.set(object, key, vi.fn());
        return Reflect.get(object, key);
      },
    });
    runtime.isCodexWorkerV2DeliveryFrozen = vi.fn(() => true);
    runtime.addPendingCodexInput = vi.fn((_session, pending) => {
      target.pendingCodexInputs.push(pending);
    });
    await routeAdapterBrowserMessage(
      target,
      { type: "user_message", content: "Continue", threadKey: "q-42", threadMonitorResultId: "2" },
      undefined,
      runtime,
    );
    expect(target.pendingCodexInputs).toHaveLength(1);
    expect(target.messageHistory).toHaveLength(0);
    expect(target.state.threadMonitoring.threads["q-42"].pending).toBeNull();
    expect(runtime.persistSession).toHaveBeenCalledWith(target);
  });

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
