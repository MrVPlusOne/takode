import { describe, expect, it } from "vitest";
import { getTakodeHerdEventBrowserMetadata } from "./herd-event-browser-metadata.js";
import type { TakodeEvent, TakodeHerdBatchSnapshot } from "./session-types.js";

function turnEndEvent(overrides: Partial<Extract<TakodeEvent, { event: "turn_end" }>["data"]> = {}): TakodeEvent {
  return {
    id: 1,
    event: "turn_end",
    sessionId: "worker-1",
    sessionNum: 2444,
    sessionName: "Worker",
    ts: 1,
    data: {
      duration_ms: 1000,
      turn_source: "leader",
      msgRange: { from: 1, to: 2 },
      ...overrides,
    },
  };
}

function batch(events: TakodeEvent[]): TakodeHerdBatchSnapshot {
  return { events, renderedLines: events.map((event) => `#${event.sessionNum} | ${event.event}`) };
}

function boardStalledEvent(): TakodeEvent {
  return {
    id: 2,
    event: "board_stalled",
    sessionId: "worker-1",
    sessionNum: 2444,
    sessionName: "Worker",
    ts: 2,
    data: {
      questId: "q-1799",
      stage: "WORKING",
      stalledForMs: 240_000,
      reason: "worker disconnected",
    },
  };
}

describe("getTakodeHerdEventBrowserMetadata", () => {
  it("marks normal worker turn_end events as routine", () => {
    expect(getTakodeHerdEventBrowserMetadata(batch([turnEndEvent()]))).toEqual([
      { event: "turn_end", sessionId: "worker-1", sessionNum: 2444, ts: 1, routine: true },
    ]);
  });

  it("keeps interrupted and direct-user worker turns actionable", () => {
    const metadata = getTakodeHerdEventBrowserMetadata(
      batch([turnEndEvent({ interrupted: true, interrupt_source: "system" }), turnEndEvent({ turn_source: "user" })]),
    );

    expect(metadata?.map((event) => event.routine)).toEqual([false, false]);
  });

  it("marks board stalled events as routine browser activity", () => {
    expect(getTakodeHerdEventBrowserMetadata(batch([boardStalledEvent()]))).toEqual([
      { event: "board_stalled", sessionId: "worker-1", sessionNum: 2444, ts: 2, routine: true },
    ]);
  });
});
