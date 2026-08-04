/**
 * Formatting and overflow tests for the push-based herd event dispatcher.
 * Split from herd-event-dispatcher.test.ts to keep staged files below the line guard.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HerdEventDispatcher,
  formatHerdEventBatch,
  type WsBridgeHandle,
  type LauncherHandle,
} from "./herd-event-dispatcher.js";
import type { BrowserIncomingMessage, TakodeEvent } from "./session-types.js";

function makeEvent(overrides: Partial<TakodeEvent> = {}): TakodeEvent {
  return {
    id: 1,
    event: "turn_end",
    sessionId: "worker-1",
    sessionNum: 5,
    sessionName: "auth-module",
    ts: Date.now(),
    data: { duration_ms: 1000, reason: "test" },
    ...overrides,
  } as TakodeEvent;
}

let eventCallback: ((evt: TakodeEvent) => void) | null = null;

function createMocks() {
  eventCallback = null;
  const bridge = {
    subscribeTakodeEvents: vi.fn<WsBridgeHandle["subscribeTakodeEvents"]>((sessions, cb) => {
      eventCallback = (evt) => {
        if (sessions.has(evt.sessionId)) cb(evt);
      };
      return vi.fn();
    }),
    injectUserMessage: vi.fn<WsBridgeHandle["injectUserMessage"]>(() => "sent"),
    isSessionIdle: vi.fn<NonNullable<WsBridgeHandle["isSessionIdle"]>>(() => false),
    wakeIdleKilledSession: vi.fn<NonNullable<WsBridgeHandle["wakeIdleKilledSession"]>>(() => false),
    getSession: vi.fn<WsBridgeHandle["getSession"]>(() => undefined),
    getBoardRow: vi.fn<NonNullable<WsBridgeHandle["getBoardRow"]>>(() => ({ status: "IMPLEMENTING" })),
    getBoardStallSignature: vi.fn<NonNullable<WsBridgeHandle["getBoardStallSignature"]>>(() => "sig-1"),
    getBoardDispatchableSignature: vi.fn<NonNullable<WsBridgeHandle["getBoardDispatchableSignature"]>>(
      () => "dispatchable-sig-1",
    ),
  } satisfies WsBridgeHandle;
  const launcher: LauncherHandle = {
    getHerdedSessions: vi.fn(() => [{ sessionId: "worker-1" }, { sessionId: "worker-2" }]),
    getSession: vi.fn(() => undefined),
  };
  return { bridge, launcher };
}

function triggerEvent(evt: TakodeEvent) {
  eventCallback?.(evt);
}

describe("formatHerdEventBatch", () => {
  it("formats turn_end events with duration and tools", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 12300, tools: { Edit: 3, Bash: 2 }, resultPreview: "Added JWT validation" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("1 event from 1 session");
    expect(result).toContain("#5");
    expect(result).toContain("turn_end");
    expect(result).toContain("12.3s");
    expect(result).toContain("tools: 5");
    expect(result).toContain("Added JWT validation");
  });

  it("formats worker_stream checkpoint events with a distinct label and activity fields", () => {
    const events = [
      makeEvent({
        event: "worker_stream",
        data: {
          reason: "checkpoint",
          duration_ms: 12300,
          tools: { Edit: 3, Bash: 2 },
          resultPreview: "Phase findings are ready",
          msgRange: { from: 169, to: 281 },
          userMsgs: { count: 2, ids: [172, 240] },
          turn_source: "user",
          questChange: { questId: "q-1010", from: "EXPLORING", to: "IMPLEMENTING" },
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("worker_stream");
    expect(result).toContain("checkpoint 12.3s");
    expect(result).toContain("(user-initiated)");
    expect(result).toContain("tools: 5");
    expect(result).toContain("[169]-[281]");
    expect(result).toContain("2 user msgs [172, 240]");
    expect(result).toContain("q-1010: EXPLORING");
    expect(result).toContain("IMPLEMENTING");
    expect(result).toContain("Phase findings are ready");
  });

  it("formats permission_request events", () => {
    const events = [
      makeEvent({
        event: "permission_request",
        data: { tool_name: "Bash", summary: "rm -rf node_modules" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("permission_request");
    expect(result).toContain("Bash: rm -rf node_modules");
    // No msg_index provided -- should not include msg reference
    expect(result).not.toContain("msg [");
  });

  it("formats herd_reassigned events with old and new leader labels", () => {
    // Formatting should preserve both leader labels so the injected herd event
    // is self-contained when reviewed from the old leader session.
    const events = [
      makeEvent({
        event: "herd_reassigned",
        data: {
          fromLeaderSessionId: "orch-1",
          fromLeaderLabel: "#1 Leader One",
          toLeaderSessionId: "orch-2",
          toLeaderLabel: "#2 Leader Two",
          reviewerCount: 2,
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("herd_reassigned");
    expect(result).toContain("#1 Leader One -> #2 Leader Two");
    expect(result).toContain("+2 reviewers");
  });

  it("includes msg [N] reference when msg_index is present in permission_request", () => {
    const events = [
      makeEvent({
        event: "permission_request",
        data: { tool_name: "ExitPlanMode", summary: "ExitPlanMode", msg_index: 42 },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("permission_request");
    expect(result).toContain("ExitPlanMode");
    expect(result).toContain("msg [42]");
  });

  it("includes full plan content inline for ExitPlanMode permission_request", () => {
    // When a worker submits a plan via ExitPlanMode, the herd event should
    // include the full plan text so the leader can review without extra tool calls.
    const planText = "## Plan\n\n1. Add feature X\n2. Update tests";
    const events = [
      makeEvent({
        event: "permission_request",
        data: {
          tool_name: "ExitPlanMode",
          summary: "ExitPlanMode",
          msg_index: 10,
          planContent: planText,
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("ExitPlanMode");
    expect(result).toContain("<plan>");
    expect(result).toContain(planText);
    expect(result).toContain("</plan>");
  });

  it("omits plan block when planContent is not present in permission_request", () => {
    // Regular permission requests (non-ExitPlanMode) should not have plan blocks.
    const events = [
      makeEvent({
        event: "permission_request",
        data: { tool_name: "Bash", summary: "git status" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).not.toContain("<plan>");
    expect(result).not.toContain("</plan>");
  });

  it("formats user-initiated permission_request with (user-initiated) annotation", () => {
    const events = [
      makeEvent({
        event: "permission_request",
        data: { tool_name: "AskUserQuestion", summary: "Which option?", turn_source: "user" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("permission_request (user-initiated)");
    expect(result).toContain("AskUserQuestion");
  });

  it("includes answer hints for AskUserQuestion permission_request events", () => {
    const events = [
      makeEvent({
        event: "permission_request",
        data: {
          tool_name: "AskUserQuestion",
          summary: "Need clarification",
          question: "Which rollout should I use?",
          options: ["Staged", "Immediate"],
          msg_index: 12,
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("Question: Which rollout should I use?");
    expect(result).toContain("1. Staged");
    expect(result).toContain("2. Immediate");
    expect(result).toContain("Answer: takode answer 5 --message 12 <option-number-or-text>");
    expect(result).toContain("Read: takode read 5 12");
  });

  it("includes answer hints for notification_needs_input events", () => {
    const events = [
      makeEvent({
        event: "notification_needs_input",
        data: { summary: "Need decision on rollout", suggestedAnswers: ["ship", "hold"], msg_index: 18 },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("notification_needs_input");
    expect(result).toContain("msg [18]");
    expect(result).toContain("Suggestions: ship, hold");
    expect(result).toContain("Answer: takode answer 5 --message 18 <response>");
    expect(result).toContain("Read: takode read 5 18");
  });

  it("does not annotate leader-initiated permission_request with (user-initiated)", () => {
    const events = [
      makeEvent({
        event: "permission_request",
        data: { tool_name: "Bash", summary: "rm -rf /tmp", turn_source: "leader" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("permission_request |");
    expect(result).not.toContain("(user-initiated)");
  });

  it("formats session_error events", () => {
    const events = [
      makeEvent({
        event: "session_error",
        data: { error: "Test suite failed: 3 assertions" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("session_error");
    expect(result).toContain("Test suite failed");
  });

  it("formats user-initiated session_archived with explicit annotation", () => {
    const events = [
      makeEvent({
        event: "session_archived",
        data: { archive_source: "user" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("session_archived (user-initiated)");
  });

  it("does not annotate non-user session_archived events", () => {
    const events = [
      makeEvent({
        event: "session_archived",
        data: { archive_source: "cascade" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("session_archived");
    expect(result).not.toContain("(user-initiated)");
  });

  it("counts sessions correctly in header", () => {
    const events = [
      makeEvent({ sessionId: "w1", sessionNum: 5, sessionName: "auth" }),
      makeEvent({ sessionId: "w2", sessionNum: 6, sessionName: "api" }),
      makeEvent({ sessionId: "w1", sessionNum: 5, sessionName: "auth" }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("3 events from 2 sessions");
  });

  it("formats interrupted turn_end events with interrupted status marker", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 1600, interrupted: true },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("interrupted 1.6s");
  });

  it("formats interrupted turn_end events with interrupt source attribution", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 1600, interrupted: true, interrupt_source: "leader" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("interrupted (by leader) 1.6s");
  });

  it("formats provisional interrupted turn_end events with recovery-pending attribution", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 1600, interrupted: true, interrupt_source: "system", recovery_pending: true },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("interrupted (by system; recovery pending) 1.6s");
  });

  it("formats turn_end with compacted annotation when context was compacted", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 30000, compacted: true },
      }),
    ];
    const result = formatHerdEventBatch(events);
    // Should show "(compacted)" after the duration so the leader knows the agent was busy compacting
    expect(result).toContain("30.0s (compacted)");
  });

  it("formats user-initiated turn_end with (user-initiated) annotation", () => {
    // User-initiated turns are annotated so the leader can distinguish them
    // from leader-dispatched work without losing visibility.
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 5000, turn_source: "user" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("(user-initiated)");
    expect(result).toContain("5.0s");
  });

  it("does not annotate leader-initiated turn_end with (user-initiated)", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 5000, turn_source: "leader" },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).not.toContain("(user-initiated)");
  });

  it("formats compaction_started event with context percentage", () => {
    const events = [
      makeEvent({
        event: "compaction_started",
        data: { context_used_percent: 89 },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("compaction_started");
    expect(result).toContain("context 89% full");
  });

  it("formats compaction_started event without context percentage", () => {
    const events = [
      makeEvent({
        event: "compaction_started",
        data: {},
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("compaction_started");
    expect(result).not.toContain("context");
  });

  it("appends relative age for recent events", () => {
    const now = 1_700_000_000_000;
    const events = [
      makeEvent({
        event: "user_message",
        ts: now - 45_000,
        data: { content: "ping" },
      }),
    ];
    const result = formatHerdEventBatch(events, { nowTs: now });
    expect(result).toContain("| 45s ago");
  });

  it("formats user_message with message and turn identifiers plus generous text", () => {
    const longContent = "x".repeat(5100);
    const events = [
      makeEvent({
        event: "user_message",
        data: {
          content: longContent,
          msg_index: 77,
          message_id: "user-77",
          turn_target: "current",
          turn_id: "turn-abc",
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("user_message | user sent to [#5](session:5)");
    expect(result).toContain("msg [77]");
    expect(result).toContain("id user-77");
    expect(result).toContain("turn current turn-abc");
    expect(result).toContain(`${"x".repeat(4999)}…`);
    expect(result).toContain("---\nThe worker should be reacting to this user message now.");
  });

  it("keeps injected user_message events on their existing sender labels without the direct-user reminder", () => {
    const events = [
      makeEvent({
        event: "user_message",
        data: {
          content: "leader dispatch",
          agentSource: { sessionId: "leader-1", sessionLabel: "#1 Leader" },
        },
      }),
      makeEvent({
        event: "user_message",
        data: {
          content: "herd event delivery",
          agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
        },
      }),
    ];

    const result = formatHerdEventBatch(events);
    expect(result).toContain('user_message [Agent #1 Leader] | "leader dispatch"');
    expect(result).toContain('user_message [Herd] | "herd event delivery"');
    expect(result).not.toContain("user sent to");
    expect(result).not.toContain("The worker should be reacting to this user message now.");
  });

  it("formats turn_end with user message count and IDs", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 15 * 60 * 1000,
          tools: { Edit: 3 },
          msgRange: { from: 169, to: 281 },
          userMsgs: { count: 3, ids: [172, 195, 240] },
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("15m 0s");
    expect(result).toContain("tools: 3");
    expect(result).toContain("[169]-[281]");
    expect(result).toContain("3 user msgs [172, 195, 240]");
  });

  it("formats turn_end with a compact phase-note pointer when provided", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 5000,
          questId: "q-12",
          phaseNote: { phaseId: "work", index: 3, tldr: "Synced and verified the accepted change." },
        },
      }),
    ];

    const result = formatHerdEventBatch(events);

    expect(result).toContain("q-12");
    expect(result).toContain("phase-note: work #3 Synced and verified");
  });

  it("formats turn_end with single user message (no plural)", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 5000,
          userMsgs: { count: 1, ids: [42] },
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).toContain("1 user msg [42]");
    expect(result).not.toContain("user msgs");
  });

  it("formats turn_end without user messages when none received", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 5000 },
      }),
    ];
    const result = formatHerdEventBatch(events);
    expect(result).not.toContain("user msg");
  });

  it("appends relative age for stale queued events", () => {
    const now = 1_700_000_000_000;
    const events = [
      makeEvent({
        event: "turn_end",
        ts: now - 2 * 60_000,
        data: { duration_ms: 1230 },
      }),
    ];
    const result = formatHerdEventBatch(events, { nowTs: now });
    expect(result).toContain("| 2m ago");
  });
});

// ─── forceFlushPendingEvents ─────────────────────────────────────────────────

describe("forceFlushPendingEvents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers pending events even when leader is not idle (stuck generation)", () => {
    // When a leader's isGenerating flag is stuck, the normal flushInbox
    // path retries forever. forceFlushPendingEvents bypasses the idle
    // check so the stuck-session watchdog can unblock event delivery
    // without clearing the generation state (which could break invariants).
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader is NOT idle (stuck generating)
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    triggerEvent(makeEvent({ event: "turn_end" }));

    // Normal delivery path won't deliver — it retries
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    // Force flush bypasses the idle check
    const flushed = dispatcher.forceFlushPendingEvents("orch-1");
    expect(flushed).toBe(1);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.destroy();
  });

  it("keeps force-flushed events pending and re-arms retry when bridge still queues them locally", () => {
    // q-275 follow-up: the stuck-session watchdog uses forceFlushPendingEvents.
    // If Codex still only accepts the herd event into a local pending queue,
    // the dispatcher must not mark it delivered and must retry again later.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    vi.mocked(bridge.injectUserMessage).mockReturnValueOnce("queued").mockReturnValueOnce("sent");
    triggerEvent(makeEvent({ event: "turn_end" }));

    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    const queuedFlush = dispatcher.forceFlushPendingEvents("orch-1");
    expect(queuedFlush).toBe(0);
    const inboxAfterQueued = dispatcher._getInbox("orch-1");
    expect(inboxAfterQueued?.inFlightUpTo).toBeNull();
    expect(inboxAfterQueued?.deliveryHistory[0]?.status).toBe("pending");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.advanceTimersByTime(2100);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    const inboxAfterSent = dispatcher._getInbox("orch-1");
    expect(inboxAfterSent?.inFlightUpTo).toBe(0);
    expect(inboxAfterSent?.deliveryHistory[0]?.status).toBe("in_flight");

    dispatcher.destroy();
  });

  it("returns 0 when there are no pending events", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    const flushed = dispatcher.forceFlushPendingEvents("orch-1");
    expect(flushed).toBe(0);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();

    dispatcher.destroy();
  });

  it("returns 0 for unknown orchestrator", () => {
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);

    const flushed = dispatcher.forceFlushPendingEvents("nonexistent");
    expect(flushed).toBe(0);

    dispatcher.destroy();
  });
});

// ─── Activity injection in formatHerdEventBatch ──────────────────────────────

describe("formatHerdEventBatch with activity injection", () => {
  it("includes activity summary for turn_end events when getMessages is provided", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: {
          duration_ms: 5000,
          msgRange: { from: 10, to: 12 },
        },
      }),
    ];
    // Simulate a 3-message turn: user → assistant → result
    const mockMessages = [
      { type: "user_message", content: "Fix the bug", timestamp: Date.now() },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "On it" },
            { type: "tool_use", id: "tu1", name: "Edit", input: { file_path: "/src/fix.ts" } },
          ],
        },
        timestamp: Date.now(),
      },
      { type: "result", data: { result: "Bug fixed", is_error: false, duration_ms: 5000 } },
    ];

    const result = formatHerdEventBatch(events, {
      getMessages: (_sid, _from, _to) => mockMessages as any,
    });

    // Should contain the turn_end status line
    expect(result).toContain("turn_end");
    // Should also contain the activity summary
    expect(result).toContain('user: "Fix the bug"');
    expect(result).not.toContain("Tool Calls not shown above");
    expect(result).toContain("Bug fixed");
  });

  it("truncates leader-authored activity entries in automatic herd event batches", () => {
    const leaderInstruction =
      "Address the code-review finding for [q-725](quest:q-725), then stop and report back.\n\n" +
      "Read this phase brief first. ".repeat(20);
    const workerResult = "Worker result detail: ".repeat(120);
    const events = [
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: {
          duration_ms: 5000,
          msgRange: { from: 1091, to: 1092 },
        },
      }),
    ];
    const mockMessages = [
      {
        type: "user_message",
        content: leaderInstruction,
        timestamp: Date.now(),
        agentSource: { sessionId: "leader-1", sessionLabel: "#9 Quest Journey Leader" },
      },
      { type: "result", data: { result: workerResult, is_error: false, duration_ms: 5000 } },
    ];

    const result = formatHerdEventBatch(events, {
      getMessages: () => mockMessages as any,
      leaderSessionId: "leader-1",
    });

    const leaderLine = result.split("\n").find((line) => line.includes("[1091] leader:"));
    const resultLine = result.split("\n").find((line) => line.includes("[1092] ✓"));
    expect(leaderLine).toContain(
      '[1091] leader: "Address the code-review finding for [q-725](quest:q-725), then stop and report back.\\n\\nRead this',
    );
    expect(leaderLine).toContain(" chars");
    expect(leaderLine).not.toContain("Quest Journey Leader");
    expect(resultLine).toContain("Worker result detail:");
    expect(resultLine).not.toContain("+");
  });

  it("does not include activity when getMessages is not provided", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 5000,
          msgRange: { from: 10, to: 15 },
        },
      }),
    ];
    const result = formatHerdEventBatch(events);
    // Should just have the status line, no activity
    expect(result).toContain("turn_end");
    expect(result).not.toContain("user:");
  });

  it("does not include activity when msgRange is missing", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        data: { duration_ms: 5000 },
      }),
    ];
    const result = formatHerdEventBatch(events, {
      getMessages: () => [{ type: "user_message", content: "should not appear" }] as any,
    });
    expect(result).not.toContain("should not appear");
  });

  it("deduplicates range-bearing activity within a single rendered batch", () => {
    // A worker_stream checkpoint and the final turn_end can be delivered in one
    // herd batch. The second event should only surface activity after the first
    // event's range so the leader does not read duplicate content.
    const events = [
      makeEvent({
        event: "worker_stream",
        sessionId: "worker-1",
        data: { reason: "checkpoint", duration_ms: 3000, msgRange: { from: 10, to: 15 } },
      }),
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: { duration_ms: 4000, msgRange: { from: 13, to: 20 } },
      }),
    ];

    // Track which ranges were requested
    const requestedRanges: Array<{ from: number; to: number }> = [];
    const watermarks = new Map<string, number>();

    const result = formatHerdEventBatch(events, {
      getMessages: (_sid, from, to) => {
        requestedRanges.push({ from, to });
        return Array.from({ length: to - from + 1 }, (_value, offset) => ({
          type: "user_message",
          content: `msg ${from + offset}`,
          timestamp: Date.now(),
        })) as any;
      },
      lastEmittedMsgTo: watermarks,
    });

    // The formatter still fetches the full range so indexing stays stable, but
    // the second event only renders activity after the checkpoint range.
    expect(requestedRanges[0]).toEqual({ from: 10, to: 15 });
    expect(requestedRanges[1]).toEqual({ from: 13, to: 20 });
    expect(result).toContain('user: "msg 10"');
    expect(result).toContain('user: "msg 15"');
    expect(result).toContain("... 1 message skipped [16]-[16]");
    expect(result).toContain('user: "msg 20"');
  });

  it("includes activity summary for worker_stream events when getMessages is provided", () => {
    const events = [
      makeEvent({
        event: "worker_stream",
        sessionId: "worker-1",
        data: {
          reason: "checkpoint",
          duration_ms: 5000,
          msgRange: { from: 10, to: 12 },
        },
      }),
    ];
    const mockMessages = [
      { type: "user_message", content: "Prepare the phase finding", timestamp: Date.now() },
      {
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Findings ready" },
            { type: "tool_use", id: "tu1", name: "Bash", input: { command: "bun test" } },
          ],
        },
        timestamp: Date.now(),
      },
      { type: "result", data: { result: "Checkpoint ready", is_error: false, duration_ms: 5000 } },
    ];

    const result = formatHerdEventBatch(events, {
      getMessages: (_sid, _from, _to) => mockMessages as any,
    });

    expect(result).toContain("worker_stream");
    expect(result).toContain('user: "Prepare the phase finding"');
    expect(result).not.toContain("Tool Calls not shown above");
    expect(result).toContain("Checkpoint ready");
  });

  it("fetches the full range and skips activity when no content survives deduplication", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: { duration_ms: 5000, msgRange: { from: 10, to: 15 } },
      }),
    ];
    // Watermark at 15 means [10]-[15] was already emitted in a prior batch
    const watermarks = new Map([["worker-1", 15]]);
    let getMessagesCalled = false;

    const result = formatHerdEventBatch(events, {
      getMessages: () => {
        getMessagesCalled = true;
        return [];
      },
      lastEmittedMsgTo: watermarks,
    });

    // The dispatcher fetches the full range, then the formatter applies the
    // deduplication watermark uniformly to user and non-user messages.
    expect(getMessagesCalled).toBe(true);
    // Should still have the turn_end status line
    expect(result).toContain("turn_end");
    expect(result).not.toContain("user:");
  });

  it("does not force-surface user messages older than the deduplication watermark", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: { duration_ms: 5000, msgRange: { from: 10, to: 16 } },
      }),
    ];
    const watermarks = new Map([["worker-1", 14]]);
    const mockMessages = [
      { type: "assistant", message: { content: [{ type: "text", text: "older assistant" }] }, timestamp: Date.now() },
      { type: "user_message", content: "Unseen user below watermark", timestamp: Date.now() },
      { type: "assistant", message: { content: [{ type: "text", text: "new assistant" }] }, timestamp: Date.now() },
      { type: "result", data: { result: "Done", is_error: false, duration_ms: 1 } },
    ];

    const result = formatHerdEventBatch(events, {
      getMessages: () => mockMessages as any,
      lastEmittedMsgTo: watermarks,
    });

    expect(result).not.toContain('user: "Unseen user below watermark"');
    expect(result).not.toContain("older assistant");
    expect(result).toContain("turn_end");
  });

  it("includes user messages at or above the deduplication watermark like ordinary activity", () => {
    const events = [
      makeEvent({
        event: "turn_end",
        sessionId: "worker-1",
        data: { duration_ms: 5000, msgRange: { from: 20, to: 24 } },
      }),
    ];
    const watermarks = new Map([["worker-1", 21]]);
    const mockMessages = [
      { type: "assistant", message: { content: [{ type: "text", text: "old assistant" }] }, timestamp: Date.now() },
      { type: "user_message", content: "Old user", timestamp: Date.now() },
      { type: "user_message", content: "Fresh unseen user", timestamp: Date.now() },
      { type: "result", data: { result: "Done", is_error: false, duration_ms: 1 } },
    ];

    const result = formatHerdEventBatch(events, {
      getMessages: () => mockMessages as any,
      lastEmittedMsgTo: watermarks,
    });

    expect(result).not.toContain('user: "Old user"');
    expect(result).toContain('user: "Fresh unseen user"');
  });
});

describe("inbox overflow prioritization (q-205)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves permission_request events when non-critical events can be trimmed", () => {
    // When inbox overflows, non-critical events (turn_end, permission_resolved)
    // should be dropped first to protect critical events (permission_request,
    // session_error) that represent workers blocked on human action.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    // Leader is busy — events accumulate without delivery
    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);

    // Fill inbox with 199 turn_end events
    for (let i = 0; i < 199; i++) {
      triggerEvent(makeEvent({ id: i, event: "turn_end" }));
    }

    // Add a critical permission_request event
    triggerEvent(
      makeEvent({
        id: 199,
        event: "permission_request",
        data: { tool_name: "Bash", summary: "run tests" },
      }),
    );

    // Add one more turn_end to trigger overflow (201 > 200 cap)
    triggerEvent(makeEvent({ id: 200, event: "turn_end" }));

    const inbox = dispatcher._getInbox("orch-1");
    // Inbox should be capped at 200
    expect(inbox!.entries.length).toBeLessThanOrEqual(200);
    // The permission_request event should survive
    const hasPermissionRequest = inbox!.entries.some((e) => e.event.event === "permission_request");
    expect(hasPermissionRequest).toBe(true);

    dispatcher.destroy();
  });

  it("logs warning when critical events must be dropped during overflow", () => {
    // When there aren't enough non-critical events to trim, critical events
    // get dropped as a last resort — but with a console.warn for diagnostics.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Fill inbox entirely with permission_request events (all critical)
    for (let i = 0; i < 201; i++) {
      triggerEvent(
        makeEvent({
          id: i,
          event: "permission_request",
          data: { tool_name: "Bash", summary: `request ${i}` },
        }),
      );
    }

    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox!.entries.length).toBeLessThanOrEqual(200);
    // Should have logged a warning about dropping critical events
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("critical event"));

    warnSpy.mockRestore();
    dispatcher.destroy();
  });

  it("preserves session_error events during overflow alongside permission_request", () => {
    // Both permission_request and session_error are critical — both should
    // survive when non-critical events can be trimmed instead.
    const { bridge, launcher } = createMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    vi.mocked(bridge.isSessionIdle).mockReturnValue(false);

    // Fill with 198 turn_end events
    for (let i = 0; i < 198; i++) {
      triggerEvent(makeEvent({ id: i, event: "turn_end" }));
    }

    // Add critical events
    triggerEvent(makeEvent({ id: 198, event: "permission_request", data: { tool_name: "Bash", summary: "test" } }));
    triggerEvent(makeEvent({ id: 199, event: "session_error", data: { error: "CLI crashed" } }));

    // Trigger overflow
    triggerEvent(makeEvent({ id: 200, event: "turn_end" }));

    const inbox = dispatcher._getInbox("orch-1");
    expect(inbox!.entries.length).toBeLessThanOrEqual(200);

    const events = inbox!.entries.map((e) => e.event.event);
    expect(events).toContain("permission_request");
    expect(events).toContain("session_error");

    dispatcher.destroy();
  });
});
