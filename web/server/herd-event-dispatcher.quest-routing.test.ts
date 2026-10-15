/**
 * Tests for the push-based herd event dispatcher: which quest thread a herd event is
 * routed to, from route metadata and persisted history.
 *
 * Uses mock interfaces for WsBridge and Launcher from the shared test helpers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HerdEventDispatcher } from "./herd-event-dispatcher.js";
import { createMocks, makeEvent, triggerEvent } from "./herd-event-dispatcher.test-helpers.js";

describe("HerdEventDispatcher quest routing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups injected herd batches by quest route metadata", () => {
    // A single debounce flush can contain work from several quests. The leader
    // should receive one injected herd message per quest thread so Main stays
    // reserved for unassociated/global events.
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(launcher.getSession!).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? { claimedQuestId: "q-101" }
        : sessionId === "worker-2"
          ? { claimedQuestId: "q-202" }
          : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(makeEvent({ id: 1, sessionId: "worker-1", sessionNum: 1, sessionName: "worker-one" }));
    triggerEvent(makeEvent({ id: 2, sessionId: "worker-2", sessionNum: 2, sessionName: "worker-two" }));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls.map((call) => call[4]?.threadKey)).toEqual([
      "q-101",
      "q-202",
    ]);

    dispatcher.destroy();
  });

  it("prefers event-time quest metadata over the source session claim for herd routing", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(launcher.getSession!).mockReturnValue({ claimedQuestId: "q-101" });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "board_stalled",
        data: {
          questId: "q-303",
          stage: "IMPLEMENTING",
          stalledForMs: 120_000,
          reason: "No activity",
          signature: "sig-1",
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-303",
      questId: "q-303",
    });

    dispatcher.destroy();
  });

  it("routes turn_end events using active route metadata before source session claim", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(launcher.getSession!).mockReturnValue({ claimedQuestId: "q-101" });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          threadKey: "q-404",
          questId: "q-404",
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-404",
      questId: "q-404",
    });

    dispatcher.destroy();
  });

  it("routes worker_stream events using active route metadata before source session claim", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(launcher.getSession!).mockReturnValue({ claimedQuestId: "q-101" });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "worker_stream",
        data: {
          reason: "checkpoint",
          duration_ms: 1000,
          threadKey: "q-505",
          questId: "q-505",
          msgRange: { from: 10, to: 12 },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-505",
      questId: "q-505",
    });

    dispatcher.destroy();
  });

  it("infers turn_end quest routing from persisted user-message history after restart", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              { type: "user_message", id: "u-main", content: "main", timestamp: 1, threadKey: "main" },
              {
                type: "user_message",
                id: "u-q998",
                content: "review q-998",
                timestamp: 2,
                threadKey: "q-998",
                questId: "q-998",
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          msgRange: { from: 1, to: 1 },
          userMsgs: { count: 1, ids: [1] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-998",
      questId: "q-998",
    });

    dispatcher.destroy();
  });

  it("infers worker_stream quest routing from persisted user-message history after restart", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              { type: "user_message", id: "u-main", content: "main", timestamp: 1, threadKey: "main" },
              {
                type: "user_message",
                id: "u-q606",
                content: "checkpoint q-606",
                timestamp: 2,
                threadKey: "q-606",
                questId: "q-606",
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "worker_stream",
        data: {
          reason: "checkpoint",
          duration_ms: 1000,
          msgRange: { from: 1, to: 1 },
          userMsgs: { count: 1, ids: [1] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-606",
      questId: "q-606",
    });

    dispatcher.destroy();
  });

  it("infers turn_end quest routing from unambiguous agent-sourced quest prompts", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              {
                type: "user_message",
                id: "u-review",
                content: "Review [q-1009](quest:q-1009) in the repeated Mental Simulation phase.",
                timestamp: 1,
                agentSource: { sessionId: "leader-1", sessionLabel: "#1286" },
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          msgRange: { from: 0, to: 0 },
          userMsgs: { count: 1, ids: [0] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-1009",
      questId: "q-1009",
    });

    dispatcher.destroy();
  });

  it("infers turn_end quest routing from a leading target when later context mentions other quests", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              {
                type: "user_message",
                id: "u-port",
                content: "Advance [q-1009](quest:q-1009) to Port.\n\nDo not include [q-1010](quest:q-1010).",
                timestamp: 1,
                agentSource: { sessionId: "leader-1", sessionLabel: "#1286" },
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          msgRange: { from: 0, to: 0 },
          userMsgs: { count: 1, ids: [0] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-1009",
      questId: "q-1009",
    });

    dispatcher.destroy();
  });

  it("infers turn_end quest routing from a transcript leader target before later quest context", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              {
                type: "user_message",
                id: "u-outcome-review",
                content: [
                  "1 event from 1 session",
                  "",
                  "#1323 | turn_end | ✓ 1m 52s | tools: 29 | [350]-[414] | 1 user msg [350]",
                  '[350] leader: "Review [q-1005](quest:q-1005) in the Outcome Review phase.',
                  '[414] "ACCEPT: screenshots show `q-99` inserted after Main for [q-1005](quest:q-1005)."',
                ].join("\n"),
                timestamp: 1,
                agentSource: { sessionId: "leader-1", sessionLabel: "#1286" },
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          msgRange: { from: 0, to: 0 },
          userMsgs: { count: 1, ids: [0] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({
      threadKey: "q-1005",
      questId: "q-1005",
    });

    dispatcher.destroy();
  });

  it("keeps ambiguous multi-quest turn_end prompts in Main", () => {
    const { bridge, launcher } = createMocks();
    vi.mocked(bridge.isSessionIdle).mockReturnValue(true);
    vi.mocked(bridge.getSession).mockImplementation((sessionId) =>
      sessionId === "worker-1"
        ? {
            messageHistory: [
              {
                type: "user_message",
                id: "u-ambiguous",
                content: "Compare [q-1009](quest:q-1009) with [q-1010](quest:q-1010).",
                timestamp: 1,
                agentSource: { sessionId: "leader-1", sessionLabel: "#1286" },
              },
            ] as any,
          }
        : undefined,
    );
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("orch-1");

    triggerEvent(
      makeEvent({
        event: "turn_end",
        data: {
          duration_ms: 1000,
          reason: "result",
          msgRange: { from: 0, to: 0 },
          userMsgs: { count: 1, ids: [0] },
        },
      }),
    );
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0][4]).toMatchObject({ threadKey: "main" });

    dispatcher.destroy();
  });
});
