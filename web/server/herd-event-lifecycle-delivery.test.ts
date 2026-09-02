import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HerdEventDispatcher, type LauncherHandle, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { TakodeEvent } from "./session-types.js";

function createHarness() {
  let eventCallback: ((event: TakodeEvent) => void) | null = null;
  const bridge = {
    subscribeTakodeEvents: vi.fn<WsBridgeHandle["subscribeTakodeEvents"]>((sessions, callback) => {
      eventCallback = (event) => {
        if (sessions.has(event.sessionId)) callback(event);
      };
      return vi.fn();
    }),
    injectUserMessage: vi.fn<WsBridgeHandle["injectUserMessage"]>(() => "sent"),
    isSessionIdle: vi.fn<NonNullable<WsBridgeHandle["isSessionIdle"]>>(() => true),
    wakeIdleKilledSession: vi.fn<NonNullable<WsBridgeHandle["wakeIdleKilledSession"]>>(() => false),
    getSession: vi.fn<WsBridgeHandle["getSession"]>(() => undefined),
  } satisfies WsBridgeHandle;
  const launcher = {
    getHerdedSessions: vi.fn(() => [{ sessionId: "worker-1" }]),
    getSession: vi.fn(() => undefined),
  } satisfies LauncherHandle;
  const dispatcher = new HerdEventDispatcher(bridge, launcher);
  dispatcher.setupForOrchestrator("leader-1");
  const emit = (event: TakodeEvent) => eventCallback?.(event);
  return { bridge, dispatcher, emit };
}

function turnEnd(id: number, lifecycle: "waiting" | "resumed"): TakodeEvent {
  return {
    id,
    event: "turn_end",
    sessionId: "worker-1",
    sessionNum: 10,
    sessionName: "Worker",
    ts: id,
    data: {
      reason: "result",
      duration_ms: 5_000,
      msgRange: { from: 200, to: 210 },
      ...(lifecycle === "waiting" ? { awaiting_decision: true } : { resumed_after_decision: true }),
    },
  };
}

describe("herd lifecycle delivery metadata", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("snapshots lifecycle metadata even when an event has no stable dedupe key", () => {
    const { bridge, dispatcher, emit } = createHarness();
    emit({
      id: 1,
      event: "permission_request",
      sessionId: "worker-1",
      sessionNum: 10,
      sessionName: "Worker",
      ts: 1,
      data: { tool_name: "Bash" },
    });

    vi.advanceTimersByTime(600);

    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0]?.[3]).toMatchObject({
      events: [expect.objectContaining({ event: "permission_request" })],
    });
    dispatcher.destroy();
  });

  it("does not dedupe waiting and resumed labels that share one message range", () => {
    const { bridge, dispatcher, emit } = createHarness();
    emit(turnEnd(1, "waiting"));
    vi.advanceTimersByTime(600);
    dispatcher.onOrchestratorTurnEnd("leader-1");

    emit(turnEnd(2, "resumed"));
    vi.advanceTimersByTime(600);

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(2);
    const waitingKey = vi.mocked(bridge.injectUserMessage).mock.calls[0]?.[3]?.eventKeys?.[0];
    const resumedKey = vi.mocked(bridge.injectUserMessage).mock.calls[1]?.[3]?.eventKeys?.[0];
    expect(waitingKey).toMatch(/\|true\|$/);
    expect(resumedKey).toMatch(/\|\|true$/);
    expect(waitingKey).not.toBe(resumedKey);
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[0]?.[1]).toContain("waiting for decision; Work preserved");
    expect(vi.mocked(bridge.injectUserMessage).mock.calls[1]?.[1]).toContain("same Work resumed after decision wait");
    dispatcher.destroy();
  });

  it("preserves the legacy stable-key shape for ordinary turn completions", () => {
    const { bridge, dispatcher, emit } = createHarness();
    const ordinary = turnEnd(1, "waiting");
    if (ordinary.event === "turn_end") delete ordinary.data.awaiting_decision;
    emit(ordinary);
    vi.advanceTimersByTime(600);

    const key = vi.mocked(bridge.injectUserMessage).mock.calls[0]?.[3]?.eventKeys?.[0];
    expect(key).toMatch(/^turn_end\|worker-1\|result\|5000\|/);
    expect(key?.split("|")).toHaveLength(24);
    dispatcher.destroy();
  });
});
