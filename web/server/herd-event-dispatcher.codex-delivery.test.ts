import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HerdEventDispatcher, type LauncherHandle, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { TakodeEvent } from "./session-types.js";

let eventCallback: ((evt: TakodeEvent) => void) | null = null;

function createCodexLeaderDeliveryMocks() {
  eventCallback = null;
  const bridge = {
    subscribeTakodeEvents: vi.fn<WsBridgeHandle["subscribeTakodeEvents"]>((sessions, cb) => {
      eventCallback = (evt) => {
        if (sessions.has(evt.sessionId)) cb(evt);
      };
      return vi.fn();
    }),
    injectUserMessage: vi.fn<WsBridgeHandle["injectUserMessage"]>(() => "queued"),
    isSessionIdle: vi.fn<NonNullable<WsBridgeHandle["isSessionIdle"]>>(() => false),
    wakeIdleKilledSession: vi.fn<NonNullable<WsBridgeHandle["wakeIdleKilledSession"]>>(() => false),
    wakeUnavailableOrchestratorForPendingEvents: vi.fn<
      NonNullable<WsBridgeHandle["wakeUnavailableOrchestratorForPendingEvents"]>
    >(() => false),
    getSession: vi.fn<WsBridgeHandle["getSession"]>((sessionId: string) =>
      sessionId === "leader-codex" ? ({ backendType: "codex", messageHistory: [] } as any) : undefined,
    ),
    getBoardRow: vi.fn<NonNullable<WsBridgeHandle["getBoardRow"]>>(() => null),
    getBoardStallSignature: vi.fn<NonNullable<WsBridgeHandle["getBoardStallSignature"]>>(() => null),
  } satisfies WsBridgeHandle;
  const launcher: LauncherHandle = {
    getHerdedSessions: vi.fn(() => [{ sessionId: "worker-alignment" }, { sessionId: "worker-stale" }]),
    getSession: vi.fn((sessionId: string) =>
      sessionId === "worker-alignment" ? { claimedQuestId: "q-1175" } : undefined,
    ),
  };
  return { bridge, launcher };
}

function makeAlignmentTurnEnd(overrides: Partial<TakodeEvent> = {}): TakodeEvent {
  const event = {
    id: 1510,
    event: "turn_end",
    sessionId: "worker-alignment",
    sessionNum: 1510,
    sessionName: "Coordinate current GPU datagen push",
    ts: Date.now(),
    data: {
      reason: "result",
      duration_ms: 42_000,
      threadKey: "q-1175",
      questId: "q-1175",
      msgRange: { from: 42, to: 43 },
      userMsgs: { count: 1, ids: [27] },
    },
  } as TakodeEvent;
  return { ...event, ...overrides, data: { ...event.data, ...(overrides.data ?? {}) } } as TakodeEvent;
}

function makeStaleBoardStalled(): TakodeEvent {
  return {
    id: 9,
    event: "board_stalled",
    sessionId: "worker-stale",
    sessionNum: 1905,
    sessionName: "Implement old quest",
    ts: Date.now(),
    data: {
      questId: "q-1429",
      title: "Old parked quest",
      stage: "IMPLEMENTING",
      signature: "q-1429|IMPLEMENTING|disconnected",
      workerStatus: "disconnected",
      reviewerStatus: "missing",
      stalledForMs: 240_000,
      reason: "worker disconnected",
      action: "inspect worker; resume or re-dispatch before review",
    },
  } as TakodeEvent;
}

describe("HerdEventDispatcher Codex leader delivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps a worker turn_end while a Codex leader is busy, then treats queued Codex injection as accepted", () => {
    const { bridge, launcher } = createCodexLeaderDeliveryMocks();
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("leader-codex");

    eventCallback?.(makeAlignmentTurnEnd());

    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(dispatcher.getDiagnostics("leader-codex")).toMatchObject({
      pendingEventCount: 1,
      pendingEventTypes: ["turn_end"],
      inFlightCount: 0,
    });

    bridge.isSessionIdle.mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("leader-codex", "result");

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const injectCall = bridge.injectUserMessage.mock.calls[0];
    expect(injectCall[0]).toBe("leader-codex");
    expect(injectCall[1]).toContain("turn_end");
    expect(injectCall[1]).toContain("#1510");
    expect(injectCall[4]).toMatchObject({ threadKey: "q-1175", questId: "q-1175" });

    const queuedDiagnostics = dispatcher.getDiagnostics("leader-codex");
    expect(queuedDiagnostics).toMatchObject({
      pendingEventCount: 0,
      inFlightCount: 1,
      debounceActive: false,
    });
    expect(queuedDiagnostics.eventHistory).toEqual([expect.objectContaining({ event: "turn_end", status: "queued" })]);

    vi.advanceTimersByTime(5_000);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    dispatcher.onOrchestratorTurnEnd("leader-codex", "result");
    expect(dispatcher.getDiagnostics("leader-codex").eventHistory).toEqual([
      expect.objectContaining({ event: "turn_end", status: "confirmed" }),
    ]);

    dispatcher.destroy();
  });

  it("prunes a stale first board_stalled event and still queues later Codex herd events", () => {
    const { bridge, launcher } = createCodexLeaderDeliveryMocks();
    bridge.getBoardRow.mockImplementation((_sessionId, questId) => {
      if (questId === "q-1429") return { status: "QUEUED" };
      if (questId === "q-1431") return { status: "PLANNING" };
      return null;
    });
    const dispatcher = new HerdEventDispatcher(bridge, launcher);
    dispatcher.setupForOrchestrator("leader-codex");

    eventCallback?.(makeStaleBoardStalled());
    eventCallback?.(
      makeAlignmentTurnEnd({
        id: 19,
        sessionId: "worker-alignment",
        sessionNum: 1909,
        sessionName: "Investigate follow-up",
        data: {
          reason: "result",
          duration_ms: 12_000,
          threadKey: "q-1431",
          questId: "q-1431",
          msgRange: { from: 42, to: 43 },
        },
      } as Partial<TakodeEvent>),
    );

    expect(dispatcher.getDiagnostics("leader-codex")).toMatchObject({
      pendingEventCount: 2,
      pendingEventTypes: ["board_stalled", "turn_end"],
    });

    bridge.isSessionIdle.mockReturnValue(true);
    dispatcher.onOrchestratorTurnEnd("leader-codex", "result");

    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    const injectCall = bridge.injectUserMessage.mock.calls[0];
    expect(injectCall[1]).toContain("turn_end");
    expect(injectCall[4]).toMatchObject({ threadKey: "q-1431", questId: "q-1431" });
    expect(injectCall[1]).not.toContain("board_stalled");
    expect(injectCall[1]).not.toContain("q-1429");
    expect(dispatcher.getDiagnostics("leader-codex").eventHistory).toEqual([
      expect.objectContaining({ event: "board_stalled", status: "suppressed" }),
      expect.objectContaining({ event: "turn_end", status: "queued" }),
    ]);

    dispatcher.destroy();
  });
});
