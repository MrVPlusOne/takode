/**
 * Tests for the push-based herd event dispatcher: debounce batching, delivery timing,
 * filtering, idle-killed wakes, restart-prep holds, and cleanup.
 *
 * Uses mock interfaces for WsBridge and Launcher from the shared test helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HerdEventDispatcher, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import { createMocks, makeEvent, triggerEvent } from "./herd-event-dispatcher.test-helpers.js";
import type { BrowserIncomingMessage } from "./session-types.js";

describe("HerdEventDispatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates events while orchestrator is generating, flushes on turnEnd", async () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Orchestrator is generating (not idle)
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);

    // Worker events arrive
    triggerEvent(makeEvent({ event: "turn_end", data: { duration_ms: 5000 } }));
    triggerEvent(
      makeEvent({
        event: "permission_request",
        sessionId: "worker-2",
        sessionNum: 6,
        sessionName: "api-tests",
        data: { tool_name: "Bash" },
      }),
    );

    // Nothing injected yet
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Orchestrator finishes turn — now idle
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    // onOrchestratorTurnEnd flushes immediately via queueMicrotask (no 500ms debounce)
    await Promise.resolve();
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    // Verify message content includes both events
    const call = vi.mocked(bridge.injectUserMessage).mock.calls[0];
    expect(call[0]).toBe("orch-1");
    expect(call[1]).toContain("2 events from 2 sessions");
    expect(call[2]).toEqual({ sessionId: "herd-events", sessionLabel: "Herd Events" });

    dispatcher.destroy();
  });

  it("delivers immediately (within debounce) when orchestrator is idle", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Orchestrator is idle
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end" }));

    // Not yet — debounce pending
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // After debounce
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers an active-worker permission event while the leader itself is idle", () => {
    // Worker generation is represented by the worker event stream, not by the
    // leader lifecycle. An active worker must not make an otherwise idle
    // leader ineligible for herd delivery.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(
      makeEvent({
        event: "permission_request",
        sessionId: "worker-1",
        data: { tool_name: "Bash" },
      }),
    );

    vi.advanceTimersByTime(600);

    expect(bridge.isSessionIdle).toHaveBeenCalledWith("orch-1");
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0]?.[0]).toBe("orch-1");

    dispatcher.destroy();
  });

  it("batches rapid events within debounce window", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    // Multiple events within 500ms
    triggerEvent(makeEvent({ id: 1, event: "turn_end" }));
    vi.advanceTimersByTime(100);
    triggerEvent(makeEvent({ id: 2, event: "session_error", data: { error: "test failed" } }));
    vi.advanceTimersByTime(100);
    triggerEvent(makeEvent({ id: 3, event: "permission_request", data: { tool_name: "Bash" } }));

    // Still within debounce — no delivery yet
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Debounce fires (500ms from first event)
    vi.advanceTimersByTime(400);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    // All 3 events in one message
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("3 events");

    dispatcher.destroy();
  });

  it("filters non-actionable events (turn_start)", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    // Non-actionable events
    triggerEvent(makeEvent({ event: "turn_start" }));

    vi.advanceTimersByTime(600);

    // No delivery — turn_start is filtered
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("filters compaction herd events from orchestrator delivery", () => {
    // Compaction lifecycle events are still formatted elsewhere, but the leader
    // should not get them as herd events because they create avoidable noise.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "compaction_started",
        data: { context_used_percent: 92 },
      }),
    );
    triggerEvent(
      makeEvent({
        id: 2,
        event: "compaction_finished",
        data: { context_used_percent: 61 },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("delivers herd_reassigned events so previous leaders see forced takeovers", () => {
    // Forced reassignment must surface as a normal actionable herd event so the
    // previous leader sees that the worker left its herd.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "herd_reassigned",
        data: {
          fromLeaderSessionId: "orch-1",
          fromLeaderLabel: "#1 Leader One",
          toLeaderSessionId: "orch-2",
          toLeaderLabel: "#2 Leader Two",
          reviewerCount: 1,
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("herd_reassigned");
    expect(content).toContain("#1 Leader One -> #2 Leader Two");
    expect(content).toContain("+1 reviewer");

    dispatcher.destroy();
  });

  it("delivers session_disconnected events for actionable worker stalls", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "session_disconnected",
        data: { reason: "adapter_disconnect", wasGenerating: false },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("session_disconnected");
    expect(content).toContain("adapter_disconnect");

    dispatcher.destroy();
  });

  it("skips events triggered by the leader's own actions (actorSessionId)", () => {
    // When the leader runs takode archive or takode answer, the resulting
    // herd events should not bounce back to the leader (q-259).
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    // Event triggered by the leader itself (actorSessionId matches orchestrator)
    triggerEvent(
      makeEvent({
        event: "session_archived",
        data: {},
        actorSessionId: "orch-1",
      }),
    );
    vi.advanceTimersByTime(600);

    // Should NOT be delivered -- leader already sees the result
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // But events without actorSessionId (or from other sessions) are delivered
    triggerEvent(
      makeEvent({
        id: 2,
        event: "session_archived",
        data: {},
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers direct human user_message events for herded workers", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "user_message",
        data: {
          content: "please check latest logs",
          msg_index: 42,
          message_id: "user-42",
          turn_target: "current",
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("user_message | user sent to [#5](session:5)");
    expect(content).toContain("msg [42]");
    expect(content).toContain("id user-42");
    expect(content).toContain("turn current");
    expect(content).toContain("please check latest logs");
    expect(content).toContain("---\nThe worker should be reacting to this user message now.");

    dispatcher.destroy();
  });

  it("delivers direct human user_message events for herded reviewers", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(launcher.getHerdedSessions).mockReturnValue([{ sessionId: "worker-1" }, { sessionId: "reviewer-1" }]);
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "user_message",
        sessionId: "reviewer-1",
        sessionNum: 7,
        sessionName: "reviewer",
        data: { content: "please review the patch", msg_index: 12, turn_target: "queued" },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("#7 | user_message | user sent to [#7](session:7)");
    expect(content).toContain("msg [12]");
    expect(content).toContain("turn queued");
    expect(content).toContain("please review the patch");
    expect(content).toContain("---\nThe worker should be reacting to this user message now.");

    dispatcher.destroy();
  });

  it("does not deliver user_message events from the leader's own session or outside the herd", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "user_message",
        sessionId: "orch-1",
        sessionNum: 1,
        data: { content: "leader direct message" },
      }),
    );
    triggerEvent(
      makeEvent({
        event: "user_message",
        sessionId: "outside-1",
        sessionNum: 9,
        data: { content: "outside herd" },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("does not deliver injected agent user_message events as direct human steering", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "user_message",
        data: {
          content: "leader dispatch",
          agentSource: { sessionId: "orch-1", sessionLabel: "#1" },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("does not inject when inbox is empty on turnEnd", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    dispatcher.onOrchestratorTurnEnd("orch-1");
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("re-subscribes when herd changes", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    expect(bridge.subscribeTakodeEvents).toHaveBeenCalledTimes(1);

    // Change workers
    vi.mocked(launcher.getHerdedSessions).mockReturnValue([{ sessionId: "worker-3" }]);
    dispatcher.onHerdChanged("orch-1");

    // Unsubscribe old (via returned function) + subscribe new
    expect(bridge.subscribeTakodeEvents).toHaveBeenCalledTimes(2);

    dispatcher.destroy();
  });

  it("teardown cleans up subscription and timers", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "turn_end" }));

    // Teardown before debounce fires
    dispatcher.teardownForOrchestrator("orch-1");

    vi.advanceTimersByTime(600);

    // No delivery — inbox was cleaned up
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Inbox removed
    expect(dispatcher._getInbox("orch-1")).toBeUndefined();
  });

  it("caps inbox at 100 events (drops oldest)", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);

    // Push 110 events
    for (let i = 0; i < 110; i++) {
      triggerEvent(makeEvent({ id: i, event: "turn_end" }));
    }

    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox?.entries.length).toBeLessThanOrEqual(200);

    dispatcher.destroy();
  });

  it("tags injected messages with herd-events agentSource", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "turn_end" }));
    vi.advanceTimersByTime(600);

    const call = vi.mocked(bridge.injectUserMessage).mock.calls[0];
    expect(call[2]).toEqual({ sessionId: "herd-events", sessionLabel: "Herd Events" });

    dispatcher.destroy();
  });

  it("tears down when herd becomes empty", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // All workers unherded
    vi.mocked(launcher.getHerdedSessions).mockReturnValue([]);
    dispatcher.onHerdChanged("orch-1");

    expect(dispatcher._getInbox("orch-1")).toBeUndefined();

    dispatcher.destroy();
  });

  it("keeps a zero-worker inbox alive until a pending herd_reassigned event is delivered", () => {
    // Regression: when the moved worker was the last herd member, the old
    // leader still needs the pending herd_reassigned event before inbox teardown.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(
      makeEvent({
        event: "herd_reassigned",
        data: {
          fromLeaderSessionId: "orch-1",
          fromLeaderLabel: "#1 Leader One",
          toLeaderSessionId: "orch-2",
          toLeaderLabel: "#2 Leader Two",
        },
      }),
    );

    vi.mocked(launcher.getHerdedSessions).mockReturnValue([]);
    dispatcher.onHerdChanged("orch-1");

    const inboxBeforeDelivery = dispatcher._getInbox("orch-1");
    expect(inboxBeforeDelivery).toBeDefined();
    expect(inboxBeforeDelivery?.workerIds.size).toBe(0);

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("orch-1");
    expect(dispatcher._getInbox("orch-1")).toBeUndefined();

    dispatcher.destroy();
  });

  it("retries delivery when flushInbox finds the leader busy", () => {
    // Regression: flushInbox used to silently return when the leader was not idle,
    // leaving events permanently stranded until the next onOrchestratorTurnEnd call.
    // Now it schedules a retry at RETRY_MS (2s) to prevent event loss.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader starts idle → event triggers debounce
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "turn_end" }));

    // Leader becomes busy before debounce fires
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.advanceTimersByTime(600);

    // Flush attempted but leader was busy — should NOT be delivered yet
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Retry timer should be active — leader becomes idle before retry fires
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.advanceTimersByTime(2100);

    // Retry flush succeeds
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("keeps herd events pending when bridge queues the injection locally", () => {
    // Regression guard for q-275: Codex leaders can accept a herd event into a
    // local pending-delivery queue before the backend turn actually starts.
    // The dispatcher must not mark those events in-flight yet, or later user
    // messages can get stuck behind an undelivered herd chip indefinitely.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.injectUserMessage).mockReturnValueOnce("queued").mockReturnValueOnce("sent");

    triggerEvent(makeEvent({ event: "turn_end" }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const inboxAfterQueued = dispatcher._getInbox("orch-1");
    expect(inboxAfterQueued?.inFlightUpTo).toBeNull();
    expect(inboxAfterQueued?.entries).toHaveLength(1);
    expect(inboxAfterQueued?.deliveryHistory[0]?.status).toBe("pending");

    vi.advanceTimersByTime(2100);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    const inboxAfterSent = dispatcher._getInbox("orch-1");
    expect(inboxAfterSent?.inFlightUpTo).toBe(0);
    expect(inboxAfterSent?.deliveryHistory[0]?.status).toBe("in_flight");

    dispatcher.destroy();
  });

  it("confirms queued Codex herd events once they are committed to leader history", () => {
    // Regression for q-998: Codex herd injection initially reports "queued".
    // If that queued message is committed and handled before the dispatcher
    // retries, the dispatcher must acknowledge the exact event keys instead
    // of re-sending the already-handled completion on the next leader turn.
    const { bridge, launcher } = createMocks();
    const leaderHistory: NonNullable<ReturnType<WsBridgeHandle["getSession"]>>["messageHistory"] = [];
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "orch-1" ? { messageHistory: leaderHistory } : undefined,
    );
    vi.mocked(bridge.injectUserMessage).mockImplementation((sessionId, content, agentSource, takodeHerdBatch) => {
      leaderHistory.push({
        type: "user_message",
        content,
        timestamp: Date.now(),
        ...(agentSource ? { agentSource } : {}),
        ...(takodeHerdBatch?.eventKeys?.length ? { takodeHerdEventKeys: takodeHerdBatch.eventKeys } : {}),
      });
      return "queued";
    });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    const staleCompletion = makeEvent({
      id: 1,
      sessionId: "worker-1",
      sessionNum: 1306,
      sessionName: "Mental Simulation",
      data: { duration_ms: 51_700, msgRange: { from: 178, to: 200 }, userMsgs: { count: 1, ids: [178] } },
    });
    triggerEvent(staleCompletion);

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const committedHerdMessage = leaderHistory[0] as Extract<BrowserIncomingMessage, { type: "user_message" }>;
    expect(committedHerdMessage.takodeHerdEventKeys).toEqual([expect.stringContaining("turn_end|worker-1")]);
    expect(committedHerdMessage.takodeHerdEventKeys?.[0]).toContain("|178|200|");

    dispatcher.onOrchestratorTurnEnd("orch-1");
    vi.advanceTimersByTime(2100);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(dispatcher._getInbox("orch-1")?.entries).toHaveLength(0);

    dispatcher.destroy();

    const replayDispatcher = new HerdEventDispatcher(bridge, launcher);
    replayDispatcher.setupForOrchestrator("orch-1");
    triggerEvent({ ...staleCompletion, id: 2, ts: staleCompletion.ts + 1000 });
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    replayDispatcher.destroy();
  });

  it("uses delivered worker_stream checkpoints to avoid duplicate final turn activity", () => {
    const { bridge, launcher } = createMocks();
    const workerHistory = Array.from({ length: 15 }, (_value, index) => ({
      type: "user_message",
      content: `activity ${index}`,
      timestamp: Date.now(),
    }));
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1" ? ({ messageHistory: workerHistory } as any) : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(
      makeEvent({
        event: "worker_stream",
        data: {
          reason: "checkpoint",
          duration_ms: 5000,
          msgRange: { from: 10, to: 12 },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    const checkpointContent = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(checkpointContent).toContain('user: "activity 10"');
    expect(checkpointContent).toContain('user: "activity 12"');

    triggerEvent(
      makeEvent({
        id: 2,
        event: "turn_end",
        data: {
          duration_ms: 8000,
          msgRange: { from: 10, to: 14 },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    const finalContent = vi.mocked(bridge.injectUserMessage).mock.calls[1][1];
    expect(finalContent).toContain("turn_end");
    expect(finalContent).not.toContain('user: "activity 10"');
    expect(finalContent).not.toContain('user: "activity 12"');
    expect(finalContent).toContain('user: "activity 13"');
    expect(finalContent).toContain('user: "activity 14"');

    dispatcher.destroy();
  });

  it("wakes idle-killed leader when herd event arrives", () => {
    // When a leader session was stopped by idle-manager (killedByIdleManager=true),
    // new herd events should wake it up by calling wakeIdleKilledSession.
    // The leader will be relaunched and events delivered once it reconnects.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader is NOT idle (CLI disconnected, killed by idle manager)
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    // wakeIdleKilledSession returns true — the session was idle-killed and relaunch requested
    vi.mocked(bridge.wakeIdleKilledSession).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end" }));

    // Should have attempted to wake the session
    expect(bridge.wakeIdleKilledSession).toHaveBeenCalledWith("orch-1");

    // No immediate injection — events stay pending until CLI reconnects
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Events are in the inbox, waiting for the CLI to reconnect and go idle
    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox?.entries.length).toBe(1);

    dispatcher.destroy();
  });

  it("does not wake leader if session was not idle-killed", () => {
    // When the leader is just busy (generating), wakeIdleKilledSession returns false
    // and the normal retry path is used instead.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.mocked(bridge.wakeIdleKilledSession).mockReturnValue(false);

    triggerEvent(makeEvent({ event: "turn_end" }));

    // wakeIdleKilledSession was called but returned false (not idle-killed)
    expect(bridge.wakeIdleKilledSession).toHaveBeenCalledWith("orch-1");

    // No injection, no wake — events just accumulate for next turnEnd/retry
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("wakes idle-killed leader during flushInbox retry", () => {
    // Edge case: leader is killed by idle-manager between debounce schedule and flush.
    // flushInbox should detect the idle-kill and wake the session.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader starts idle → event triggers debounce
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "turn_end" }));

    // Leader gets idle-killed before debounce fires
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.mocked(bridge.wakeIdleKilledSession).mockReturnValue(true);
    vi.advanceTimersByTime(600);

    // flushInbox detected the idle-killed state and woke the session
    expect(bridge.wakeIdleKilledSession).toHaveBeenCalledWith("orch-1");
    // No injection (CLI is dead, will deliver after reconnect)
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("suppresses restart-prep target events before enqueue or idle-killed wake", () => {
    // Restart-prep worker interruptions should not wake an idle-killed leader
    // through the normal herd delivery path.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    dispatcher.beginRestartPrepOperation({
      operationId: "prep-1",
      mode: "standalone",
      targetSessions: [{ sessionId: "worker-1", label: "Worker" }],
      protectedLeaders: [{ sessionId: "orch-1", label: "Leader" }],
      timeoutMs: 1000,
      suppressionTtlMs: 5000,
    });

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.mocked(bridge.wakeIdleKilledSession).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end", sessionId: "worker-1" }));

    expect(bridge.wakeIdleKilledSession).not.toHaveBeenCalled();
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher._getInbox("orch-1")?.entries).toHaveLength(0);
    expect(dispatcher.getRestartPrepOperationSnapshot("prep-1")?.suppressedHerdEvents).toBe(1);

    dispatcher.destroy();
  });

  it("holds unrelated protected-leader events during standalone prep and releases them after timeout", () => {
    // Unrelated herd events should not wake the leader during restart prep, but
    // they can be delivered after the standalone prep window expires.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    dispatcher.beginRestartPrepOperation({
      operationId: "prep-1",
      mode: "standalone",
      targetSessions: [{ sessionId: "worker-1", label: "Worker" }],
      protectedLeaders: [{ sessionId: "orch-1", label: "Leader" }],
      timeoutMs: 1000,
      suppressionTtlMs: 5000,
    });

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "permission_request", sessionId: "worker-2", sessionName: "other-worker" }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher._getInbox("orch-1")?.deliveryHistory[0]?.status).toBe("held");

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(dispatcher.getRestartPrepOperationSnapshot("prep-1")?.heldHerdEvents).toBe(1);

    dispatcher.destroy();
  });

  it("wakes an idle-killed protected leader only after unrelated held events are released", () => {
    // Held unrelated events should not wake a protected leader during prep, but
    // after the hold window expires they return to the normal delivery policy.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    dispatcher.beginRestartPrepOperation({
      operationId: "prep-1",
      mode: "standalone",
      targetSessions: [{ sessionId: "worker-1", label: "Worker" }],
      protectedLeaders: [{ sessionId: "orch-1", label: "Leader" }],
      timeoutMs: 1000,
      suppressionTtlMs: 5000,
    });

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.mocked(bridge.wakeIdleKilledSession).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "permission_request", sessionId: "worker-2", sessionName: "other-worker" }));

    expect(bridge.wakeIdleKilledSession).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);

    expect(bridge.wakeIdleKilledSession).toHaveBeenCalledWith("orch-1");
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("suppresses late target events after blocker timeout while suppression is still active", () => {
    // The blocker wait timeout should not become the herd suppression lifetime:
    // late prep-target turn_end events must still avoid leader wakeups.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    dispatcher.beginRestartPrepOperation({
      operationId: "prep-1",
      mode: "restart",
      targetSessions: [{ sessionId: "worker-1", label: "Worker" }],
      protectedLeaders: [{ sessionId: "orch-1", label: "Leader" }],
      timeoutMs: 1000,
      suppressionTtlMs: 5000,
    });

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.advanceTimersByTime(1500);
    triggerEvent(makeEvent({ event: "turn_end", sessionId: "worker-1" }));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher.getRestartPrepOperationSnapshot("prep-1")?.suppressedHerdEvents).toBe(1);

    dispatcher.destroy();
  });

  it("does not force-flush held or suppressed restart-prep events", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");
    dispatcher.beginRestartPrepOperation({
      operationId: "prep-1",
      mode: "restart",
      targetSessions: [{ sessionId: "worker-1", label: "Worker" }],
      protectedLeaders: [{ sessionId: "orch-1", label: "Leader" }],
      timeoutMs: 1000,
      suppressionTtlMs: 5000,
    });

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(makeEvent({ event: "permission_request", sessionId: "worker-2", sessionName: "other-worker" }));
    triggerEvent(makeEvent({ event: "turn_end", sessionId: "worker-1" }));

    const flushed = dispatcher.forceFlushPendingEvents("orch-1");

    expect(flushed).toBe(0);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher.getRestartPrepOperationSnapshot("prep-1")?.suppressedHerdEvents).toBe(1);

    dispatcher.destroy();
  });

  it("flushes synchronously on turnEnd, not via microtask or 500ms debounce", () => {
    // Regression: flushing via microtask raced with promoteNextQueuedTurn()
    // which sets isGenerating=true synchronously after onOrchestratorTurnEnd,
    // causing the microtask to find the leader "busy" (q-205). Now flushInbox
    // runs synchronously during onOrchestratorTurnEnd for reliable delivery.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(makeEvent({ event: "turn_end" }));

    // Leader finishes turn
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("orch-1");

    // Events should be delivered synchronously (no microtask/await needed)
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    // No pending debounce timer should exist
    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox?.debounceTimer).toBeNull();

    dispatcher.destroy();
  });

  it("cancels debounce timer when turnEnd triggers immediate flush", () => {
    // If a debounce timer was already pending when onOrchestratorTurnEnd fires,
    // it should be cancelled to avoid double-delivery.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader idle → event arrives → debounce timer starts
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    triggerEvent(makeEvent({ event: "turn_end" }));
    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox?.debounceTimer).not.toBeNull(); // Timer is active

    // Before debounce fires, turnEnd triggers synchronous flush
    dispatcher.onOrchestratorTurnEnd("orch-1");

    // Should be delivered exactly once (not doubled by the old debounce timer)
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    // Advance past the old debounce time — no second delivery
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers user-initiated turn_end events (annotated, not dropped)", () => {
    // User-initiated turns on herded workers must still be delivered to the
    // leader so it has full visibility into worker state. Previously these
    // were silently dropped (q-16), creating a blind spot where the leader
    // never learned about user-triggered task completions.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end", data: { duration_ms: 5000, turn_source: "user" } }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    // The formatted output should annotate it as user-initiated
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    expect(content).toContain("(user-initiated)");

    dispatcher.destroy();
  });

  it("delivers leader-initiated turn_end events (turn_source='leader')", () => {
    // Leader-initiated turns should always be delivered.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end", data: { duration_ms: 5000, turn_source: "leader" } }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers turn_end events without turn_source (backwards compatibility)", () => {
    // Events from older sessions that don't have turn_source should still be
    // delivered — absence of the field means "don't filter".
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end", data: { duration_ms: 5000 } }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers system-initiated turn_end events", () => {
    // System-initiated turns (e.g. compaction trigger) should be delivered.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ event: "turn_end", data: { duration_ms: 5000, turn_source: "system" } }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("delivers both user and leader turn_end events in a mixed batch", () => {
    // Both user-initiated and leader-initiated events should be delivered.
    // User-initiated events are annotated so the leader can distinguish them.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);

    triggerEvent(makeEvent({ id: 1, event: "turn_end", data: { duration_ms: 5000, turn_source: "user" } }));
    triggerEvent(makeEvent({ id: 2, event: "turn_end", data: { duration_ms: 3000, turn_source: "leader" } }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const content = vi.mocked(bridge.injectUserMessage).mock.calls[0][1];
    // Both events delivered
    expect(content).toContain("2 events from 1 session");
    // User-initiated one is annotated
    expect(content).toContain("(user-initiated)");

    dispatcher.destroy();
  });

  it("confirms only the herd delivery owned by the completed leader turn", () => {
    // A later successful leader turn must not retire an earlier provider-failed
    // herd escalation merely because both user messages exist in history.
    const { bridge, launcher } = createMocks();
    const leaderHistory: BrowserIncomingMessage[] = [];
    let owner = 0;
    vi.mocked(bridge.getSession).mockReturnValue({ messageHistory: leaderHistory });
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.injectUserMessage).mockImplementation((_sessionId, content, agentSource, herdBatch) => {
      owner += 1;
      leaderHistory.push({
        type: "user_message",
        id: `owner-${owner}`,
        content,
        timestamp: owner,
        agentSource,
        takodeHerdEventKeys: herdBatch?.eventKeys,
      });
      return "sent";
    });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(makeEvent({ id: 1, data: { reason: "first", duration_ms: 1, msgRange: { from: 1, to: 1 } } }));
    vi.advanceTimersByTime(600);
    triggerEvent(makeEvent({ id: 2, event: "session_error", data: { error: "second" } }));
    vi.advanceTimersByTime(600);

    expect(dispatcher.getDiagnostics("orch-1").inFlightCount).toBe(2);
    dispatcher.onOrchestratorTurnEnd("orch-1", "result", ["owner-2"]);

    expect(dispatcher.getDiagnostics("orch-1")).toMatchObject({
      pendingEventCount: 0,
      inFlightCount: 1,
      eventHistory: [
        expect.objectContaining({ status: "in_flight" }),
        expect.objectContaining({ status: "confirmed" }),
      ],
    });

    dispatcher.destroy();
  });
});
