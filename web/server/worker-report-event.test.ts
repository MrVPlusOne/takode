import { afterEach, describe, expect, it, vi } from "vitest";
import { HerdEventDispatcher, formatHerdEventBatch, type WsBridgeHandle } from "./herd-event-dispatcher.js";
import type { BoardRow, TakodeEvent, TakodeEventFor } from "./session-types.js";

function fixture() {
  const row: BoardRow = {
    questId: "q-1",
    worker: "worker-1",
    status: "WORKING",
    createdAt: 100,
    updatedAt: 100,
    journey: { phaseIds: ["work", "memory"], activePhaseIndex: 0, currentPhaseId: "work" },
  };
  const event: TakodeEventFor<"worker_stream"> = {
    id: 1,
    event: "worker_stream",
    sessionId: "worker-1",
    sessionNum: 1,
    sessionName: "Worker",
    ts: Date.now(),
    data: {
      reason: "report",
      duration_ms: 0,
      questId: "q-1",
      threadKey: "q-1",
      report: {
        id: "report-id",
        leaderSessionId: "leader-1",
        journeyRunId: "run-1",
        phaseOccurrenceId: "occurrence-1",
        phasePosition: 1,
        boardCreatedAt: 100,
        feedbackIndex: 3,
        preview: "A bounded report preview",
      },
    },
  };
  let receive: ((event: TakodeEvent) => void) | undefined;
  const bridge: WsBridgeHandle = {
    subscribeTakodeEvents: (_sessions, callback) => {
      receive = callback;
      return () => {};
    },
    injectUserMessage: vi.fn(() => "sent" as const),
    isSessionIdle: vi.fn(() => true),
    getSession: () => ({ board: new Map([["q-1", row]]), messageHistory: [] }),
  };
  const dispatcher = new HerdEventDispatcher(bridge, { getHerdedSessions: () => [{ sessionId: "worker-1" }] });
  dispatcher.setupForOrchestrator("leader-1");
  return { row, event, bridge, dispatcher, send: (value: TakodeEvent) => receive!(value) };
}

afterEach(() => vi.useRealTimers());

describe("worker report notification", () => {
  it("renders only report context and its source, not surrounding activity", () => {
    const { event, dispatcher } = fixture();
    const getMessages = vi.fn(() => [
      { type: "user_message" as const, content: "unrelated private activity", timestamp: 1 },
    ]);
    const result = formatHerdEventBatch([event], { getMessages });
    expect(result).toContain("quest:q-1:feedback:3");
    expect(result).toContain("informational; no acknowledgment required");
    expect(result).not.toContain("unrelated private activity");
    expect(getMessages).not.toHaveBeenCalled();
    dispatcher.destroy();
  });

  it("delivers once without a worker acknowledgment or turn completion", () => {
    vi.useFakeTimers();
    const { event, send, bridge, dispatcher } = fixture();
    send(event);
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    dispatcher.onOrchestratorTurnEnd("leader-1");
    send({ ...event, id: 2 });
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
    dispatcher.destroy();
  });

  it.each([
    "phase",
    "replacement",
    "worker",
  ])("drops queued reports after a %s change without mutating the new row", (change) => {
    vi.useFakeTimers();
    const { event, send, row, bridge, dispatcher } = fixture();
    vi.mocked(bridge.isSessionIdle!).mockReturnValue(false);
    send(event);
    if (change === "phase") {
      row.status = "MEMORY";
      row.journey!.activePhaseIndex = 1;
    }
    if (change === "replacement") row.createdAt = 200;
    if (change === "worker") row.worker = "replacement-worker";
    const expected = structuredClone(row);
    vi.mocked(bridge.isSessionIdle!).mockReturnValue(true);
    vi.advanceTimersByTime(600);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    expect(row).toEqual(expected);
    dispatcher.destroy();
  });
});
